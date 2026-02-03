/**
 * Daily Scheduler - 통합 자동화 스케줄러
 *
 * 실행 작업:
 * 1. syncAllExhibitions - 공공 API 전시 동기화
 * 2. runPrivateVenueSync - 사설 미술관 동기화
 * 3. updateAllTrendScores - 트렌드 점수 업데이트
 * 4. enrichVenuesBarrierFree - 관광공사 API 기반 무장애 정보 보강
 */

import { canRunJobToday, recordJobRun, getLocalDateKey } from './jobRun.js';
import Exhibition from '../models/Exhibition.js';
import Venue from '../models/Venue.js';
import { ensureTrendScore, isTrendApiAvailable } from './trendService.js';
import { enrichVenueWithBarrierFree, isKorWithApiAvailable } from './korWithService.js';

// 환경변수 설정
const TREND_UPDATE_BATCH = Number(process.env.TREND_UPDATE_BATCH || 20);
const TREND_UPDATE_DELAY_MS = Number(process.env.TREND_UPDATE_DELAY_MS || 1000);
const VENUE_ENRICH_BATCH = Number(process.env.VENUE_ENRICH_BATCH || 10);
const BARRIER_FREE_ENRICH_DELAY_MS = Number(process.env.BARRIER_FREE_ENRICH_DELAY_MS || 500);
const PRIVATE_SYNC_ENABLED = String(process.env.PRIVATE_SYNC_ENABLED ?? 'true').toLowerCase() === 'true';
const TREND_UPDATE_ENABLED = String(process.env.TREND_UPDATE_ENABLED ?? 'true').toLowerCase() === 'true';
const BARRIER_FREE_ENRICH_ENABLED = String(process.env.BARRIER_FREE_ENRICH_ENABLED ?? 'true').toLowerCase() === 'true';

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
 * 관광공사 API로 venue 무장애 정보 보강
 */
async function enrichVenuesBarrierFree() {
  if (!BARRIER_FREE_ENRICH_ENABLED) {
    console.log('[barrier-free] Barrier-free enrichment disabled');
    return { enriched: 0, skipped: 0 };
  }

  if (!isKorWithApiAvailable()) {
    console.log('[barrier-free] KorWithService API key not configured');
    return { enriched: 0, skipped: 0, reason: 'no_api_key' };
  }

  console.log('[barrier-free] Starting venue barrier-free enrichment...');

  // 무장애 정보가 없거나 부족한 venue 찾기
  const dbVenues = await Venue.find({
    $or: [
      { 'barrierFree.wheelchair': { $exists: false } },
      { 'barrierFree.wheelchair': false, 'barrierFree.elevator': false, 'barrierFree.accessibleToilet': false }
    ]
  })
    .select('name openHours location barrierFree')
    .limit(VENUE_ENRICH_BATCH)
    .lean();

  let enriched = 0;
  let skipped = 0;

  for (const dbVenue of dbVenues) {
    try {
      const result = await enrichVenueWithBarrierFree(dbVenue.name);

      if (!result) {
        skipped++;
        continue;
      }

      const updates = {};

      // 운영시간 업데이트 (기존 값이 없을 때만)
      if (!dbVenue.openHours && result.openHours) {
        updates.openHours = result.openHours;
      }

      // 위치 정보 업데이트 (기존 값이 없을 때만)
      if ((!dbVenue.location?.lat || !dbVenue.location?.lng) && result.location) {
        updates.location = result.location;
      }

      // 무장애 정보 병합 (기존 true 값은 유지)
      if (result.barrierFree) {
        const merged = { ...dbVenue.barrierFree };
        for (const [key, value] of Object.entries(result.barrierFree)) {
          // boolean 값: 기존이 false면 새 값으로, 기존이 true면 유지
          if (typeof value === 'boolean') {
            if (!merged[key]) merged[key] = value;
          }
          // string 값 (grade): 기존 값이 없으면 새 값으로
          else if (typeof value === 'string' && !merged[key]) {
            merged[key] = value;
          }
        }
        updates.barrierFree = merged;
      }

      if (Object.keys(updates).length > 0) {
        await Venue.updateOne({ _id: dbVenue._id }, { $set: updates });
        enriched++;
        console.log(`[barrier-free] Updated: ${dbVenue.name}`);
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, BARRIER_FREE_ENRICH_DELAY_MS));
    } catch (err) {
      console.warn(`[barrier-free] Failed for "${dbVenue.name}": ${err.message}`);
      skipped++;
    }
  }

  console.log(`[barrier-free] Enriched: ${enriched}, Skipped: ${skipped}`);
  return { enriched, skipped };
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

      // 5. 관광공사 API로 무장애 정보 보강
      const bfGuard = await canRunJobToday('barrier-free-enrich', { maxRuns: 1 });
      if (bfGuard.allowed) {
        console.log('\n[5/5] Enriching venues with barrier-free info...');
        const enrichResult = await enrichVenuesBarrierFree();
        await recordJobRun('barrier-free-enrich', { meta: { reason, ...enrichResult } });
      } else {
        console.log('[5/5] Barrier-free enrichment already ran today, skipping');
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
export { updateAllTrendScores, enrichVenuesBarrierFree };
