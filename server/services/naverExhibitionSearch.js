/**
 * Naver 검색 기반 전시 정보 수집 (보수적)
 */

import dotenv from 'dotenv';
import { fetchNaverSearch } from './naverApi.js';
import Venue from '../models/Venue.js';
import { extractPeriod } from './exhibitionParser.js';

dotenv.config();

const NAVER_MAX_CALLS_PER_SYNC = parseInt(process.env.NAVER_MAX_CALLS_PER_SYNC || '8', 10);
const NAVER_EXHIBITION_ENABLED = String(process.env.NAVER_EXHIBITION_ENABLED ?? 'true').toLowerCase() === 'true';
let callCountThisSync = 0;

const EXCLUDE_KEYWORDS = [
  '안내', '관람', '오시는길', '주차', '시설', '대관', '공지', '채용', '후원', '프로그램', '휴관', '예약'
];

const NOISY_REGEX = /(추천|가볼만한곳|놀거리|혜택|할인|코스|맛집|카페|여행|핫플|리뷰모음|헤드라인|뉴스|기사|이태원|용산|이재용|음료수|차에서)/i;
const EXHIBITION_REGEX = /(전시|기획전|특별전|개인전|단체전|초대전)/i;

function extractAddress(text) {
  if (!text) return '';
  const value = String(text);
  const patterns = [
    /([가-힣]{2,}(?:시|도)\s*[가-힣]{1,}(?:구|군)?\s*[가-힣0-9\-]+(?:로|길)\s*\d+(?:-\d+)?)/,
    /([가-힣]{2,}(?:시|도)\s*[가-힣]{1,}(?:구|군)?\s*[가-힣0-9\-]+(?:읍|면)\s*[가-힣0-9\-]+)/,
    /([가-힣]{2,}(?:구|군)\s*[가-힣0-9\-]+(?:로|길)\s*\d+(?:-\d+)?)/,
    /([가-힣0-9\-]+(?:로|길)\s*\d+(?:-\d+)?)/
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1].trim();
  }
  return '';
}

function extractOpenHours(text) {
  if (!text) return '';
  const value = String(text);
  const timeMatch = value.match(/(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})/);
  const closedMatch = value.match(/(월|화|수|목|금|토|일)\s*휴관|휴관\s*:\s*(월|화|수|목|금|토|일)/);
  if (!timeMatch && !closedMatch) return '';
  let result = '';
  if (timeMatch) {
    result = `${timeMatch[1]}~${timeMatch[2]}`;
  }
  if (closedMatch) {
    const day = closedMatch[1] || closedMatch[2];
    result = result ? `${result} (${day} 휴관)` : `${day} 휴관`;
  }
  return result;
}

function detectBarrierFree(text) {
  const t = String(text || '').toLowerCase();
  const hasWheelchair = /휠체어|wheelchair|장애인/.test(t);
  const hasElevator = /엘리베이터|승강기|elevator/.test(t);
  const hasBraille = /점자|braille/.test(t);
  const hasAudio = /오디오|음성안내|audio/.test(t);
  const hasAccessibleToilet = /장애인\s*화장실|화장실\s*장애인/.test(t);
  const hasParkingPaid = /유료\s*주차|주차\s*유료|주차요금/.test(t);
  const hasParkingFree = /무료\s*주차|주차\s*무료/.test(t);
  return {
    wheelchair: hasWheelchair,
    elevator: hasElevator,
    braille: hasBraille,
    audioGuide: hasAudio,
    accessibleToilet: hasAccessibleToilet,
    parkingPaid: hasParkingPaid,
    parkingFree: hasParkingFree
  };
}

export async function searchCurrentExhibitions(venueName) {
  if (!NAVER_EXHIBITION_ENABLED) return [];
  if (callCountThisSync >= NAVER_MAX_CALLS_PER_SYNC) return [];

  const query = `${venueName} 전시`;

  try {
    callCountThisSync += 1;
    const shopResult = await fetchNaverSearch('shop', query, { display: 10, sort: 'sim' });

    const exhibitions = [];
    const seenTitles = new Set();

    const items = Array.isArray(shopResult.items) ? shopResult.items : [];
    const smartStoreItems = items.filter((item) => {
      const mallName = String(item?.mallName || '').toLowerCase();
      const link = String(item?.link || '').toLowerCase();
      return mallName.includes('스마트스토어') || link.includes('smartstore');
    });
    const orderedItems = smartStoreItems.length > 0
      ? [...smartStoreItems, ...items.filter((item) => !smartStoreItems.includes(item))]
      : items;

    for (const item of orderedItems) {
      const extracted = extractExhibitionInfo(item, venueName);
      if (extracted && !seenTitles.has(extracted.title)) {
        seenTitles.add(extracted.title);
        exhibitions.push(extracted);
      }
    }

    return exhibitions;
  } catch (err) {
    console.error(`[NaverExhibition] Search error for "${venueName}":`, err.message);
    return [];
  }
}

function extractExhibitionInfo(item, venueName) {
  if (!item || !item.title) return null;

  const cleanTitle = String(item.title).replace(/<[^>]*>/g, '').trim();
  const cleanDescription = String(item.description || '').replace(/<[^>]*>/g, '').trim();

  if (!EXHIBITION_REGEX.test(`${cleanTitle} ${cleanDescription}`)) return null;
  if (NOISY_REGEX.test(`${cleanTitle} ${cleanDescription}`)) return null;

  for (const keyword of EXCLUDE_KEYWORDS) {
    if (cleanTitle.includes(keyword) || cleanDescription.includes(keyword)) {
      return null;
    }
  }

  const period = extractPeriodFromText(cleanDescription);
  if (period.start && period.end) {
    const now = new Date();
    if (now < period.start || now > period.end) return null;
  }

  let exhibitionTitle = cleanTitle
    .replace(new RegExp(venueName, 'gi'), '')
    .replace(/[\[\]<>"']/g, '')
    .replace(/전시/g, '')
    .trim();

  if (exhibitionTitle.length < 2 || exhibitionTitle.length > 50) {
    exhibitionTitle = cleanTitle;
  }

  return {
    title: exhibitionTitle,
    venueName,
    period,
    description: cleanDescription.slice(0, 300),
    sourceUrl: item.link || '',
    sourceType: 'naver_search'
  };
}

function extractPeriodFromText(text) {
  const p = extractPeriod(text);
  if (!p) return { start: null, end: null };
  return {
    start: p.start ? new Date(p.start) : null,
    end: p.end ? new Date(p.end) : null,
    raw: p.raw
  };
}

export async function searchExhibitionsForVenues(venueNames, options = {}) {
  if (!NAVER_EXHIBITION_ENABLED || !Array.isArray(venueNames)) return [];

  const { maxVenues = 3 } = options;
  const limitedVenues = venueNames.slice(0, maxVenues);
  const allExhibitions = [];
  const seenTitles = new Set();

  for (const venueName of limitedVenues) {
    if (callCountThisSync >= NAVER_MAX_CALLS_PER_SYNC) break;
    const exhibitions = await searchCurrentExhibitions(venueName);
    for (const exhibition of exhibitions) {
      if (!seenTitles.has(exhibition.title)) {
        seenTitles.add(exhibition.title);
        allExhibitions.push(exhibition);
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }

  return allExhibitions;
}

export async function enrichVenueInfo(venueName) {
  if (!NAVER_EXHIBITION_ENABLED || callCountThisSync >= NAVER_MAX_CALLS_PER_SYNC) return null;

  try {
    callCountThisSync += 1;
    const query = `${venueName} 미술관 정보`;
    const result = await fetchNaverSearch('webkr', query, { display: 3 });

    if (!result.items || result.items.length === 0) return null;

    let officialUrl = null;
    for (const item of result.items) {
      const link = item.link || '';
      if (link.includes('.go.kr') || link.includes('.or.kr') || link.includes('museum') || link.includes('gallery')) {
        officialUrl = link;
        break;
      }
    }

    return { website: officialUrl };
  } catch (err) {
    console.error(`[NaverExhibition] Enrich error for "${venueName}":`, err.message);
    return null;
  }
}

export async function fetchNaverVenueInfo(venueName) {
  if (!NAVER_EXHIBITION_ENABLED || callCountThisSync >= NAVER_MAX_CALLS_PER_SYNC) return null;

  try {
    callCountThisSync += 1;
    const query = `${venueName} 주소 운영시간 주차 장애인 화장실`;
    const result = await fetchNaverSearch('webkr', query, { display: 5, sort: 'sim' });
    const items = Array.isArray(result?.items) ? result.items : [];
    if (!items.length) return null;

    let combined = items
      .map((item) => `${item.title || ''} ${item.description || ''}`)
      .join(' ');

    let address = extractAddress(combined);
    let openHours = extractOpenHours(combined);
    let barrierFree = detectBarrierFree(combined);

    if (!address && !openHours && callCountThisSync < NAVER_MAX_CALLS_PER_SYNC) {
      callCountThisSync += 1;
      const blogResult = await fetchNaverSearch('blog', query, { display: 3, sort: 'sim' });
      const blogItems = Array.isArray(blogResult?.items) ? blogResult.items : [];
      if (blogItems.length) {
        combined = `${combined} ${blogItems.map((item) => `${item.title || ''} ${item.description || ''}`).join(' ')}`;
        address = extractAddress(combined);
        openHours = extractOpenHours(combined);
        barrierFree = detectBarrierFree(combined);
      }
    }

    let website = '';
    for (const item of items) {
      const link = item.link || '';
      if (link && !website) {
        website = link;
      }
    }

    return {
      address,
      openHours,
      barrierFree,
      website
    };
  } catch (err) {
    console.error(`[NaverExhibition] Venue info error for "${venueName}":`, err.message);
    return null;
  }
}

export async function syncNewVenues(exhibitions) {
  if (!Array.isArray(exhibitions)) return 0;

  let addedCount = 0;
  const processedVenues = new Set();

  for (const exhibition of exhibitions) {
    const venueName = exhibition.venueName || exhibition.venue?.name;
    if (!venueName || processedVenues.has(venueName)) continue;
    processedVenues.add(venueName);

    const existing = await Venue.findOne({ name: venueName });
    if (existing) continue;

    const enrichedInfo = await enrichVenueInfo(venueName);

    try {
      await Venue.create({
        name: venueName,
        region: '',
        address: '',
        location: { lat: 0, lng: 0 },
        website: enrichedInfo?.website || '',
        barrierFree: {
          wheelchair: false,
          elevator: false,
          braille: false,
          audioGuide: false,
          accessibleToilet: false,
          parkingFree: false,
          parkingPaid: false
        },
        updatedAt: new Date()
      });
      addedCount += 1;
    } catch (err) {
      if (err.code !== 11000) {
        console.error(`[NaverExhibition] Failed to add venue "${venueName}":`, err.message);
      }
    }
  }

  return addedCount;
}

export function resetCallCount() {
  callCountThisSync = 0;
}

export function getCallCount() {
  return {
    current: callCountThisSync,
    max: NAVER_MAX_CALLS_PER_SYNC,
    enabled: NAVER_EXHIBITION_ENABLED
  };
}
