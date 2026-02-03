/**
 * 한국관광공사 무장애 관광정보 API (KorWithService2)
 * - searchKeyword2: 키워드 검색 (전시장명, contentId, 좌표)
 * - detailIntro2: 소개정보 (운영시간, 주차)
 * - detailWithTour2: 무장애 정보 (휠체어, 화장실, 엘리베이터 등)
 */

const BASE_URL = 'http://apis.data.go.kr/B551011/KorWithService2';
const CONTENT_TYPE_ID = '12'; // 12 = 관광지/문화시설(검색 매칭률 개선)

/**
 * API 호출 헬퍼
 */
async function callApi(endpoint, params, { retries = 5, backoffMs = 2000 } = {}) {
  const apiKey = process.env.KOR_WITH_API_KEY;
  if (!apiKey) {
    console.warn('[KorWithService] API key not configured');
    return null;
  }

  const url = new URL(`${BASE_URL}/${endpoint}`);
  url.searchParams.set('serviceKey', apiKey);
  url.searchParams.set('MobileOS', 'ETC');
  url.searchParams.set('MobileApp', 'ExhibitionApp');
  url.searchParams.set('_type', 'json');

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  try {
    let attempt = 0;
    while (attempt <= retries) {
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        return data?.response?.body?.items?.item || null;
      }
      if (res.status === 429 && attempt < retries) {
        const wait = backoffMs * (attempt + 1);
        console.warn(`[KorWithService] 429, retrying in ${wait}ms (${endpoint})`);
        await new Promise(r => setTimeout(r, wait));
        attempt++;
        continue;
      }
      if (res.status >= 500 && attempt < retries) {
        const wait = backoffMs * (attempt + 1);
        console.warn(`[KorWithService] ${res.status}, retrying in ${wait}ms (${endpoint})`);
        await new Promise(r => setTimeout(r, wait));
        attempt++;
        continue;
      }
      console.warn(`[KorWithService] HTTP ${res.status}: ${endpoint}`);
      return null;
    }
    return null;
  } catch (err) {
    console.error(`[KorWithService] ${endpoint} error:`, err.message);
    return null;
  }
}

/**
 * 키워드로 문화시설 검색 (searchKeyword2)
 * @returns { contentid, title, mapx, mapy } 또는 null
 */
export async function searchVenueByKeyword(keyword) {
  const items = await callApi('searchKeyword2', {
    numOfRows: 5,
    pageNo: 1,
    keyword: keyword,
    contentTypeId: CONTENT_TYPE_ID
  });

  if (!items) return null;

  // 배열이면 첫번째, 단일 객체면 그대로
  const item = Array.isArray(items) ? items[0] : items;
  if (!item?.contentid) return null;

  return {
    contentId: item.contentid,
    title: item.title || '',
    mapx: parseFloat(item.mapx) || null, // 경도
    mapy: parseFloat(item.mapy) || null  // 위도
  };
}

/**
 * 소개정보 조회 (detailIntro2) - 운영시간, 주차
 * @returns { usetime, parking } 또는 null
 */
export async function getDetailIntro(contentId) {
  const items = await callApi('detailIntro2', {
    contentId: contentId,
    contentTypeId: CONTENT_TYPE_ID,
    numOfRows: 1,
    pageNo: 1
  });

  if (!items) return null;
  const item = Array.isArray(items) ? items[0] : items;

  return {
    usetime: stripHtml(item.usetime || ''),
    parking: stripHtml(item.parking || '')
  };
}

/**
 * 무장애 정보 조회 (detailWithTour2)
 * @returns { wheelchair, restroom, elevator, audioguide, helpdog, brailepromotion } 또는 null
 */
export async function getBarrierFreeInfo(contentId) {
  const items = await callApi('detailWithTour2', {
    contentId: contentId,
    numOfRows: 1,
    pageNo: 1
  });

  if (!items) return null;
  const item = Array.isArray(items) ? items[0] : items;

  return {
    wheelchair: stripHtml(item.wheelchair || ''),
    restroom: stripHtml(item.restroom || ''),
    elevator: stripHtml(item.elevator || ''),
    audioguide: stripHtml(item.audioguide || ''),
    helpdog: stripHtml(item.helpdog || ''),
    brailepromotion: stripHtml(item.brailepromotion || '')
  };
}

/**
 * HTML 태그 제거
 */
function stripHtml(text) {
  if (!text) return '';
  return String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 텍스트에서 "있음/가능/이용가능/대여가능" 등 긍정 표현 감지
 */
function hasPositiveIndicator(text) {
  if (!text) return false;
  const positive = /(있음|가능|이용|대여|운영|제공|설치|보유)/i;
  const negative = /(없음|불가|미설치|미보유|미운영)/i;
  // 부정 표현이 있으면 false
  if (negative.test(text)) return false;
  // 긍정 표현이 있거나 텍스트가 비어있지 않으면 true
  return positive.test(text) || text.length > 0;
}

/**
 * 주차 정보에서 무료/유료 파싱
 */
function parseParkingInfo(parkingText) {
  if (!parkingText) return { free: false, paid: false };
  const text = parkingText.toLowerCase();
  return {
    free: /(무료|free)/i.test(text),
    paid: /(유료|paid|주차요금)/i.test(text) || (text.length > 0 && !/(무료|free)/i.test(text))
  };
}

/**
 * Venue에 대한 전체 무장애 정보 조회 및 변환
 * @param {string} venueName - 미술관/전시장 이름
 * @returns { openHours, barrierFree, location } 또는 null
 */
export async function enrichVenueWithBarrierFree(venueName) {
  // 1. 키워드 검색으로 contentId 획득
  const searchResult = await searchVenueByKeyword(venueName);
  if (!searchResult?.contentId) {
    console.log(`[KorWithService] Not found: ${venueName}`);
    return null;
  }

  const { contentId, mapy, mapx } = searchResult;
  console.log(`[KorWithService] Found: ${venueName} (contentId: ${contentId})`);

  // 2. 소개정보 (운영시간, 주차)
  const intro = await getDetailIntro(contentId);

  // 3. 무장애 정보
  const bfInfo = await getBarrierFreeInfo(contentId);

  // 4. 결과 변환
  const parking = parseParkingInfo(intro?.parking);

  return {
    contentId,
    location: (mapy && mapx) ? { lat: mapy, lng: mapx } : null,
    openHours: intro?.usetime || '',
    barrierFree: {
      wheelchair: hasPositiveIndicator(bfInfo?.wheelchair),
      accessibleToilet: hasPositiveIndicator(bfInfo?.restroom),
      elevator: hasPositiveIndicator(bfInfo?.elevator),
      audioGuide: hasPositiveIndicator(bfInfo?.audioguide),
      guideDog: hasPositiveIndicator(bfInfo?.helpdog),
      braille: hasPositiveIndicator(bfInfo?.brailepromotion),
      parkingFree: parking.free,
      parkingPaid: parking.paid,
      // 상세 텍스트도 저장 (등급 정보용)
      wheelchairGrade: bfInfo?.wheelchair || null,
      elevatorGrade: bfInfo?.elevator || null,
      brailleGrade: bfInfo?.brailepromotion || null
    }
  };
}

/**
 * API 사용 가능 여부 확인
 */
export function isKorWithApiAvailable() {
  return !!process.env.KOR_WITH_API_KEY;
}
