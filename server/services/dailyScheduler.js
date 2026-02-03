/**
 * Daily Scheduler - 통합 자동화 스케줄러
 *
 * 실행 작업:
 * 1. syncAllExhibitions - 공공 API 전시 동기화
 * 2. runPrivateVenueSync - 사설 미술관 동기화
 * 3. updateAllTrendScores - 트렌드 점수 업데이트
 * 4. enrichVenuesFromCsv - CSV 기반 venue 정보 보강
 */

import { canRunJobToday, recordJobRun, getLocalDateKey } from './jobRun.js';
import Exhibition from '../models/Exhibition.js';
import Venue from '../models/Venue.js';
import { ensureTrendScore, isTrendApiAvailable } from './trendService.js';
import { fetchNaverBlogSearch } from './naverApi.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 환경변수 설정
const TREND_UPDATE_BATCH = Number(process.env.TREND_UPDATE_BATCH || 20);
const TREND_UPDATE_DELAY_MS = Number(process.env.TREND_UPDATE_DELAY_MS || 1000);
const VENUE_ENRICH_BATCH = Number(process.env.VENUE_ENRICH_BATCH || 10);
const PRIVATE_SYNC_ENABLED = String(process.env.PRIVATE_SYNC_ENABLED ?? 'true').toLowerCase() === 'true';
const TREND_UPDATE_ENABLED = String(process.env.TREND_UPDATE_ENABLED ?? 'true').toLowerCase() === 'true';
const CSV_ENRICH_ENABLED = String(process.env.CSV_ENRICH_ENABLED ?? 'true').toLowerCase() === 'true';

/**
 * 모든 전시의 트렌드 점수 업데이트
 */
async function updateAllTrendScores() {
  if (!TREND_UPDATE_ENABLED) {
    console.log('[trend] Trend update disabled');
    return { updated: 0, skipped: 0 };
  }

  if (!isTrendApiAvailable()) {
    console.log('[trend] Trend API not available (cooldown)');
    return { updated: 0, skipped: 0, reason: 'cooldown' };
  }

  console.log('[trend] Starting trend score update...');

  const exhibitions = await Exhibition.find({
    $or: [
      { 'trend.updatedAt': { $exists: false } },
      { 'trend.updatedAt': { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
    ]
  })
    .select('_id title trend stats')
    .limit(TREND_UPDATE_BATCH)
    .lean();

  let updated = 0;
  let skipped = 0;

  for (const exh of exhibitions) {
    if (!isTrendApiAvailable()) {
      console.log('[trend] API quota reached, stopping');
      skipped += exhibitions.length - updated;
      break;
    }

    try {
      const trendData = await ensureTrendScore(exh);
      await Exhibition.updateOne(
        { _id: exh._id },
        { $set: { trend: trendData } }
      );
      updated++;

      // Rate limiting
      await new Promise(r => setTimeout(r, TREND_UPDATE_DELAY_MS));
    } catch (err) {
      console.warn(`[trend] Failed for "${exh.title}": ${err.message}`);
      skipped++;
    }
  }

  console.log(`[trend] Updated: ${updated}, Skipped: ${skipped}`);
  return { updated, skipped };
}

/**
 * CSV에서 venue 정보 로드
 */
function loadCsvVenues() {
  const csvPath = path.resolve(__dirname, '../../KC_DSPSN_CLTUR_ART_TRRSRT_2023-2.csv');

  if (!fs.existsSync(csvPath)) {
    console.warn('[csv] CSV file not found:', csvPath);
    return [];
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').slice(2); // Skip header rows

  const venues = [];
  for (const line of lines) {
    if (!line.trim()) continue;

    const cols = line.split(',');
    if (cols.length < 14) continue;

    const [name, category, lat, lng, website, closedDays, hours, freeParking, paidParking, wheelchair, toilet, guideDog, braille, audio] = cols;

    // 전시/공연 카테고리만
    if (!category?.includes('전시')) continue;

    venues.push({
      name: name?.trim(),
      category: category?.trim(),
      location: {
        lat: parseFloat(lat) || null,
        lng: parseFloat(lng) || null
      },
      website: website?.trim() || '',
      openHours: hours?.trim() || '',
      closedDays: closedDays?.trim() || '',
      barrierFree: {
        wheelchair: wheelchair === 'Y',
        parkingFree: freeParking === 'Y',
        parkingPaid: paidParking === 'Y',
        accessibleToilet: toilet === 'Y',
        guideDog: guideDog === 'Y',
        braille: braille === 'Y',
        audioGuide: audio === 'Y'
      }
    });
  }

  return venues;
}

/**
 * 공공 API에서 추가된 새 venue를 CSV와 동기화하고 네이버로 보강
 */
async function enrichVenuesFromCsv() {
  if (!CSV_ENRICH_ENABLED) {
    console.log('[csv-enrich] CSV enrichment disabled');
    return { enriched: 0, naverFilled: 0 };
  }

  console.log('[csv-enrich] Starting venue enrichment from CSV...');

  const csvVenues = loadCsvVenues();
  const csvMap = new Map(csvVenues.map(v => [v.name, v]));

  // 정보가 부족한 venue 찾기
  const dbVenues = await Venue.find({
    $or: [
      { openHours: { $exists: false } },
      { openHours: '' },
      { 'location.lat': { $exists: false } },
      { 'barrierFree.wheelchair': { $exists: false } }
    ]
  })
    .select('name openHours location barrierFree website')
    .limit(VENUE_ENRICH_BATCH)
    .lean();

  let enriched = 0;
  let naverFilled = 0;

  for (const dbVenue of dbVenues) {
    const csvMatch = csvMap.get(dbVenue.name);
    const updates = {};

    if (csvMatch) {
      // CSV에서 정보 채우기
      if (!dbVenue.openHours && csvMatch.openHours) {
        updates.openHours = csvMatch.openHours;
      }
      if ((!dbVenue.location?.lat || !dbVenue.location?.lng) && csvMatch.location.lat && csvMatch.location.lng) {
        updates.location = csvMatch.location;
      }
      if (!dbVenue.website && csvMatch.website) {
        updates.website = csvMatch.website.startsWith('http') ? csvMatch.website : `https://${csvMatch.website}`;
      }
      if (!dbVenue.barrierFree?.wheelchair && csvMatch.barrierFree) {
        updates.barrierFree = { ...dbVenue.barrierFree, ...csvMatch.barrierFree };
      }

      if (Object.keys(updates).length > 0) {
        await Venue.updateOne({ _id: dbVenue._id }, { $set: updates });
        enriched++;
      }
    } else if (isTrendApiAvailable()) {
      // CSV에 없으면 네이버 검색으로 보강 시도
      try {
        const searchQuery = `${dbVenue.name} 미술관 운영시간`;
        const result = await fetchNaverBlogSearch(searchQuery, { display: 3 });

        if (result.items?.length > 0) {
          const descriptions = result.items.map(i => i.description || '').join(' ');

          // 운영시간 패턴 추출
          const hoursMatch = descriptions.match(/(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})/);
          if (hoursMatch && !dbVenue.openHours) {
            updates.openHours = `${hoursMatch[1]} - ${hoursMatch[2]}`;
          }

          // 휴관일 패턴 추출
          const closedMatch = descriptions.match(/(월요일|화요일|수요일|목요일|금요일|토요일|일요일)\s*(휴관|휴무)/);
          if (closedMatch) {
            updates.closedDays = closedMatch[0];
          }

          if (Object.keys(updates).length > 0) {
            await Venue.updateOne({ _id: dbVenue._id }, { $set: updates });
            naverFilled++;
          }
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.warn(`[csv-enrich] Naver search failed for "${dbVenue.name}": ${err.message}`);
      }
    }
  }

  console.log(`[csv-enrich] Enriched from CSV: ${enriched}, Filled from Naver: ${naverFilled}`);
  return { enriched, naverFilled };
}

/**
 * 통합 스케줄러 시작
 */
export function startDailyScheduler(options = {}) {
  const {
    syncAllExhibitions,
    repairRecentPeriods,
    runPrivateVenueSync
  } = options;

  if (typeof syncAllExhibitions !== 'function' || typeof repairRecentPeriods !== 'function') {
    console.warn('[scheduler] Missing required job functions. Scheduler not started.');
    return;
  }

  const intervalMs = Number(process.env.DAILY_JOB_TICK_MS || 10 * 60 * 1000); // 10분마다 체크
  const runHour = Number(process.env.DAILY_JOB_HOUR || 3); // 새벽 3시
  const runMinute = Number(process.env.DAILY_JOB_MINUTE || 0);

  let lastRunKey = null;
  let isRunning = false;

  const runJobs = async (reason) => {
    if (isRunning) {
      console.log('[scheduler] Jobs already running, skipping...');
      return;
    }

    isRunning = true;
    const startTime = Date.now();
    console.log(`\n========== Daily Jobs Started (${reason}) ==========`);

    try {
      // 1. 공공 API 전시 동기화
      const syncGuard = await canRunJobToday('daily-sync', { maxRuns: 1 });
      if (syncGuard.allowed) {
        console.log('\n[1/5] Syncing public API exhibitions...');
        await syncAllExhibitions();
        await recordJobRun('daily-sync', { meta: { reason } });
      } else {
        console.log('[1/5] Daily sync already ran today, skipping');
      }

      // 2. 사설 미술관 동기화
      if (PRIVATE_SYNC_ENABLED && typeof runPrivateVenueSync === 'function') {
        const privateGuard = await canRunJobToday('private-sync', { maxRuns: 1 });
        if (privateGuard.allowed) {
          console.log('\n[2/5] Syncing private venues...');
          const privateResult = await runPrivateVenueSync({ limit: 20 });
          console.log(`[2/5] Private sync: ${privateResult.created} created, ${privateResult.updated} updated`);
          await recordJobRun('private-sync', { meta: { reason, ...privateResult } });
        } else {
          console.log('[2/5] Private sync already ran today, skipping');
        }
      } else {
        console.log('[2/5] Private sync disabled or not available');
      }

      // 3. 기간 복구
      console.log('\n[3/5] Repairing exhibition periods...');
      await repairRecentPeriods({ force: false });

      // 4. 트렌드 점수 업데이트
      const trendGuard = await canRunJobToday('trend-update', { maxRuns: 1 });
      if (trendGuard.allowed) {
        console.log('\n[4/5] Updating trend scores...');
        const trendResult = await updateAllTrendScores();
        await recordJobRun('trend-update', { meta: { reason, ...trendResult } });
      } else {
        console.log('[4/5] Trend update already ran today, skipping');
      }

      // 5. CSV 기반 venue 정보 보강
      const csvGuard = await canRunJobToday('csv-enrich', { maxRuns: 1 });
      if (csvGuard.allowed) {
        console.log('\n[5/5] Enriching venues from CSV...');
        const enrichResult = await enrichVenuesFromCsv();
        await recordJobRun('csv-enrich', { meta: { reason, ...enrichResult } });
      } else {
        console.log('[5/5] CSV enrichment already ran today, skipping');
      }

    } catch (error) {
      console.error('[scheduler] Daily jobs failed:', error.message);
    } finally {
      isRunning = false;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n========== Daily Jobs Completed (${elapsed}s) ==========\n`);
    }
  };

  const tick = () => {
    const now = new Date();
    const dateKey = getLocalDateKey(now);

    // 이미 오늘 실행했으면 스킵
    if (lastRunKey === dateKey) return;

    // 지정된 시간 전이면 스킵
    if (now.getHours() < runHour) return;
    if (now.getHours() === runHour && now.getMinutes() < runMinute) return;

    lastRunKey = dateKey;
    runJobs('scheduler');
  };

  // 10분마다 체크
  setInterval(tick, intervalMs);

  // 즉시 한 번 체크 (서버 시작 시)
  tick();

  console.log(`[scheduler] Daily scheduler started - runs at ${runHour}:${String(runMinute).padStart(2, '0')}`);
}

// 수동 실행용 export
export { updateAllTrendScores, enrichVenuesFromCsv };
