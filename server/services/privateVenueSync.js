import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Exhibition from '../models/Exhibition.js';
import Venue from '../models/Venue.js';
import { fetchNaverSearch } from './naverApi.js';
import { getPrivateVenueSearchList, extractVenueFromText, normalizeVenueName, PRIVATE_VENUES as NORMALIZER_PRIVATE } from './venueNormalizer.js';
import { extractPeriod, extractPrice } from './exhibitionParser.js';
import { normalizeWithGemini, normalizeAllVenues, resetNormalizeQuota } from './geminiNormalize.js';

dotenv.config();

// 최종 결과 제한 (전시 과다 노출 방지)
const FINAL_PER_VENUE_MAX = Number(process.env.PRIVATE_FINAL_PER_VENUE_MAX || 30);
const FINAL_GLOBAL_MAX = Number(process.env.PRIVATE_FINAL_GLOBAL_MAX || 30);
const END_GRACE_DAYS = Number(process.env.PRIVATE_END_GRACE_DAYS || 1);
const retryQueue = [];

// 지점 분배 시 사용할 기본 그라운드시소 키
const GS_BASE = '그라운드시소';

export const PRIVATE_VENUES = [
  { name: '그라운드시소', hours: '10:00-19:00', wheelchair: true, parking: 'N/N', toilet: true, brailleAudio: 'N/N', lat: 37.56, lng: 127.0 },
  { name: '아트선재센터', hours: '12:00-19:00 (월휴무)', wheelchair: true, parking: 'N/N', toilet: true, brailleAudio: 'N/N', lat: 37.579, lng: 126.981 },
  { name: '대림미술관', hours: '11:00-20:00 (월휴무)', wheelchair: true, parking: 'N/N', toilet: true, brailleAudio: 'Y/N', lat: 37.578, lng: 126.973 },
  { name: '그라운드시소 서촌', hours: '10:00-19:00', wheelchair: false, parking: 'N/N', toilet: true, brailleAudio: 'N/N', lat: 37.577, lng: 126.972 },
  { name: '그라운드시소 성수', hours: '10:00-19:00', wheelchair: true, parking: 'N/Y', toilet: true, brailleAudio: 'N/N', lat: 37.546, lng: 127.065, aliases: ['그라운드시소 EAST', '그라운드시소 이스트'] },
  { name: '그라운드시소 센트럴', hours: '11:00-20:00', wheelchair: true, parking: 'N/Y', toilet: true, brailleAudio: 'Y/N', lat: 37.564, lng: 126.981 },
  { name: '그라운드시소 한남', hours: '10:00-19:00', wheelchair: true, parking: 'N/Y', toilet: true, brailleAudio: 'N/N', lat: 37.536, lng: 127.001 },
  { name: '그라운드시소 이동', hours: '10:30-19:00', wheelchair: true, parking: 'N/Y', toilet: true, brailleAudio: 'Y/N', lat: 37.555, lng: 126.973 },
  { name: '리움미술관', hours: '10:00-18:00 (월휴무)', wheelchair: true, parking: 'Y/N', toilet: true, brailleAudio: 'Y/Y', lat: 37.539, lng: 126.999 },
  { name: '아모레퍼시픽미술관', hours: '10:00-18:00 (월휴무)', wheelchair: true, parking: 'Y/Y', toilet: true, brailleAudio: 'Y/Y', lat: 37.528, lng: 126.968 },
  { name: '피크닉 (piknic)', hours: '10:00-18:00 (월휴무)', wheelchair: false, parking: 'N/Y', toilet: false, brailleAudio: 'N/N', lat: 37.556, lng: 126.978 },
  { name: '송은 (SONGEUN)', hours: '11:00-18:30 (월휴무)', wheelchair: true, parking: 'N/Y', toilet: true, brailleAudio: 'N/N', lat: 37.524, lng: 127.044 },
  { name: '뮤지엄산 (원주)', hours: '10:00-18:00 (월휴무)', wheelchair: true, parking: 'Y/N', toilet: true, brailleAudio: 'Y/Y', lat: 37.415, lng: 127.823 },
  { name: '본태박물관 (제주)', hours: '10:00-18:00', wheelchair: true, parking: 'Y/N', toilet: true, brailleAudio: 'N/Y', lat: 33.303, lng: 126.392 },
  { name: '제주도립미술관', hours: '09:00-18:00 (월휴무)', wheelchair: true, parking: 'Y/N', toilet: true, brailleAudio: 'Y/N', lat: 33.452, lng: 126.489 },
  { name: '백남준아트센터 (용인)', hours: '10:00-18:00 (월휴무)', wheelchair: true, parking: 'Y/N', toilet: true, brailleAudio: 'Y/Y', lat: 37.269, lng: 127.110 },
  { name: '이이남 스튜디오', hours: '11:00-21:00', wheelchair: false, parking: 'Y/N', toilet: true, brailleAudio: 'N/N', lat: 35.139, lng: 126.913 }
];



const OFFICIAL_URLS = {
  '아트선재센터': 'https://artsonje.org',
  '대림미술관': 'https://www.daelimmuseum.org',
  '그라운드시소': 'https://groundseesaw.co.kr',
  '그라운드시소 서촌': 'https://groundseesaw.co.kr',
  '그라운드시소 성수': 'https://groundseesaw.co.kr',
  '그라운드시소 센트럴': 'https://groundseesaw.co.kr',
  '그라운드시소 한남': 'https://groundseesaw.co.kr',
  '그라운드시소 이동': 'https://groundseesaw.co.kr',
  '리움미술관': 'https://www.leeum.org',
  '아모레퍼시픽미술관': 'https://apma.amorepacific.com',
  '피크닉 (piknic)': 'https://piknic.kr',
  '송은 (SONGEUN)': 'https://songeun.or.kr',
  '뮤지엄산 (원주)': 'https://www.museumsan.org',
  '본태박물관 (제주)': 'http://www.bontemuseum.com',
  '제주도립미술관': 'https://jmoa.jeju.go.kr',
  '백남준아트센터 (용인)': 'https://njp.ggcf.kr',
  '이이남 스튜디오': 'http://www.leenamlee.com'
};

// 그라운드시소 전시명 → 공홈 상세 URL 매핑 (이미지/설명 우선 보강용)
const GS_OFFICIAL_PAGE_MAP = {
  '워너 브롱크호스트': 'https://groundseesaw.co.kr/en/product/%EC%9B%8C%EB%84%88-%EB%B8%8C%EB%A1%B1%ED%81%AC%ED%98%B8%EC%8A%A4%ED%8A%B8-%EC%98%A8-%EC%84%B8%EC%83%81%EC%9D%B4-%EC%BA%94%EB%B2%84%EC%8A%A4/1299/',
  '요시고 사진전 2': 'https://groundseesaw.co.kr/product/%EC%9A%94%EC%8B%9C%EA%B3%A0-%EC%82%AC%EC%A7%84%EC%A0%84-2/1313/',
  '히무로 유리': 'https://groundseesaw.co.kr/en/product/%ED%9E%88%EB%AC%B4%EB%A1%9C-%EC%9C%A0%EB%A6%AC-%EC%98%A4%EB%8A%98%EC%9D%98-%EA%B8%B0%EC%81%A8/1302/'
};



function getOfficialHost(venueName) {
  const url = OFFICIAL_URLS[venueName];
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

function isOfficialUrl(url, venueName) {
  if (!url) return false;
  const official = getOfficialHost(venueName);
  if (!official) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === official;
  } catch {
    return false;
  }
}

function extractOgMeta(html) {
  if (!html) return {};
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  return {
    description: (ogDesc?.[1] || metaDesc?.[1] || '').trim(),
    image: (ogImg?.[1] || '').trim()
  };
}

async function fetchPageOg(url) {
  if (!url) return {};
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ExhibitionBot/1.0)' },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return {};
    const html = await res.text();
    return { ...extractOgMeta(html), sourceUrl: url };
  } catch {
    return {};
  }
}

async function fetchOfficialMeta(url) {
  return await fetchPageOg(url);
}

async function fetchOfficialMetaForTitle(venueName, title) {
  // 1) 전시명 기반 그라운드시소 매핑
  if (venueName === GS_BASE) {
    for (const [key, url] of Object.entries(GS_OFFICIAL_PAGE_MAP)) {
      if (title.includes(key)) {
        const meta = await fetchOfficialMeta(url);
        if (meta.description || meta.image) return meta;
      }
    }
  }
  // 2) venue 공홈 루트
  const officialUrl = OFFICIAL_URLS[venueName];
  if (officialUrl) {
    return await fetchOfficialMeta(officialUrl);
  }
  return {};
}

async function fetchNewsMetaForTitle(title, venueName) {
  const query = `${venueName} ${title} 전시`;
  const res = await fetchNaverSearch('news', query, { display: 3, sort: 'date' }).catch(() => ({ items: [] }));
  for (const item of res.items || []) {
    const url = item.link || item.originallink;
    const meta = await fetchPageOg(url);
    if (meta.description || meta.image) {
      return { ...meta, sourceUrl: meta.sourceUrl || url };
    }
  }
  return {};
}

async function fetchBlogMetaForTitle(title, venueName) {
  const query = `${venueName} ${title}`;
  const res = await fetchNaverSearch('blog', query, { display: 3, sort: 'sim' }).catch(() => ({ items: [] }));
  for (const item of res.items || []) {
    const url = item.link;
    const meta = await fetchPageOg(url);
    if (meta.description || meta.image) {
      return { ...meta, sourceUrl: meta.sourceUrl || url };
    }
  }
  return {};
}

const PRIVATE_META = new Map(PRIVATE_VENUES.map((v) => [v.name, v]));
const KNOWN_VENUE_NAMES = Object.keys(NORMALIZER_PRIVATE || {});

// ============ 정규식 패턴들 ============
const BAD_DOMAIN_RE = /smartstore|gmarket|11st|coupang|auction/i;

// 여행/추천형 노이즈 (강한 컷)
const TRAVEL_NOISE_RE = /(가볼만한곳|가볼만한|볼거리|놀거리|투어|여행코스|데이트코스|꿀팁|맛집|핫플|명소추천)/i;

// 안내형/후기형 (감점 또는 컷)
const GUIDE_NOISE_RE = /(후기|리뷰|방문기|관람기|다녀왔|다녀온|주차|예매|예약|가격|할인|일정|료금|소요시간|오시는길|라인업|가이드|정리|블로그|입장권)/i;

// 전시명 suffix (살림)
const EXHIBITION_SUFFIX_RE = /(전시|전시회|특별전|기획전|개인전|초대전|사진전|공모전|회고전|소장품전|award|exhibition)$/i;

// 지역 단독
const REGION_ONLY = new Set([
  "용산", "한남", "경기", "용인", "명동", "성수", "서촌", "강남", "종로",
  "제주", "원주", "서귀포", "압구정", "로데오", "이태원", "경기/용인", "회현", "안국"
]);

// 마케팅 꼬리 토큰 (제거 대상)
const MARKETING_TAIL_RE = /(,\s*)?(도슨트|해석|추천|가볼만한곳|데이트|맛집|꿀팁|멤버십|주차|오시는길|필수|솔직|at\)|feat\.|@|l\s|_\s).*$/i;

// 지역/일상 접두 (제거 대상)
const LEADING_LOCATION_RE = /^(서울|제주|원주|용인|경기|강남|한남|성수|서촌|명동|회현|압구정|로데오|이태원|강원|부산|대구|인천|광주|대전|울산)\s*(데이트|여행|나들이)?\s*[>,.\-|/]?\s*/i;

// 전시 2개 구분자
const MULTI_EXHIBITION_RE = /\s*[+&]\s*|\s+및\s+|\s+그리고\s+/;

// 방문일 패턴 (기간에서 제외)
const VISIT_DATE_CONTEXT_RE = /(방문|다녀|관람|후기|기록|일기)/i;

// 티켓 필터

// 잘린 단어 복원
const TRUNCATED_WORD_DICT = {
  "자서": "자서전",
  "특별": "특별전",
  "기획": "기획전",
  "개인": "개인전",
  "사진": "사진전"
};

// 다른 venue 이름들 (cross-venue 체크용)
const OTHER_VENUE_NAMES = [
  "국립현대미술관", "서울시립미술관", "예술의전당", "세종문화회관",
  "DDP", "K현대미술관", "호암미술관", "삼성미술관",
  "전남도립미술관", "광주시립미술관", "부산시립미술관", "대구미술관",
  "밀양아리랑아트센터", "경기도미술관", "제주현대미술관",
  "국립중앙박물관", "국립민속박물관", "전쟁기념관"
];

// ============ 일반 제목 필터 패턴 ============
// 지역 + 전시만 있는 경우
const GENERIC_TITLE_RE = /^(서울|제주|용산|경기|강남|한남|성수|서촌|명동|원주|용인)?\s*(전시|전시회|기획전|특별전|미술전|현대미술)$/i;

// 시간 접두 필터 (어제/오늘/이번달/N월 + 전시)
const TIME_PREFIX_RE = /^(어제|오늘|이번|이번달|지난|지난달|1월|2월|3월|4월|5월|6월|7월|8월|9월|10월|11월|12월|올해|작년|금주|이번주|주말)\s*(에|의|에서)?\s*(볼|본|보는|보러|갈|간|가는|가야할)?\s*(만한)?\s*(미술|서울|무료|용산)?\s*(전시|전시회)/i;

// 시간 언급 포함 (중간에도)
const TIME_MENTION_RE = /(이번달|이번\s*주|금주|다음\s*주|올해|작년)\s*(에|의)?\s*(가야\s*할|봐야\s*할|갈|볼)/i;

// 수식어 + 전시 필터
const MODIFIER_ONLY_RE = /^(무료|유료|실내|야외|대형|소형|인기|추천|필수|핫한|새로운|최신|주목|이머시브|체험형)\s*(전시|전시회|기획전)$/i;

// 블로그 제목 노이즈 (리스트형/추천형)
const BLOG_LIST_NOISE_RE = /(전시\s*(모음|추천|리스트|정보|소식|일정)|가볼\s*만한|보고\s*싶은|가고\s*싶은|봐야\s*(하는|할)|갈\s*만한|덕후|꼭\s*봐야)/i;

// 티켓 필터 (POS는 완화, NEG는 굿즈 컷)
const SHOP_TICKET_POS_RE = /(입장권|티켓|예매|예약|관람권|패스|전시)/i;
const SHOP_TICKET_NEG_RE = /(스티커|펜|패드|앨범|보관|파일|포토|굿즈|북|엽서|포스터|마그넷|키링|스노우볼|컵|머그|도안|DIY|패치|데스크)/i;
const SHOP_STOPWORDS = ['입장권', '티켓', '예매', '예약', '관람권', '패스', '기본가', '무료배송', '단체', '온라인'];

// 짧은 일반 전시명
const SHORT_GENERIC_RE = /^(사진전|기획전|특별전|전시|전시회|현대미술전|미술전|개인전|컬렉션|소장품전|상설전|상설전시|실내|동\s*전시|실내\s*전시|무료\s*전시)$/i;

// 지역 + 전시/일반어
const LOCATION_GENERIC_RE = /^(한남동?|성수동?|서촌|명동|용산|종로|강남|이태원|신용산)\s*(실내|전시|전시회|미술관|나들이)?$/i;

// 날짜만 있는 제목
const DATE_ONLY_RE = /^\d{4}[.\-/]?\d{0,2}[.\-/]?\d{0,2}$/;

// 블로그 넘버링 패턴
const BLOG_NUMBERING_RE = /^\d+\.\s*\[|^\[\d+\]|^\d+\s*[.:]|^#\d+/;

// venue명만 남은 제목 필터용
const VENUE_NAMES_FOR_FILTER = [
  '아트선재', '아트선재센터', '대림', '대림미술관', '리움', '리움미술관',
  '아모레퍼시픽', '아모레퍼시픽미술관', '피크닉', 'piknic', '송은', 'SONGEUN',
  '뮤지엄 산', 'Museum SAN', '본태', '본태박물관', '제주도립', '백남준',
  '백남준아트센터', '이이남', '그라운드시소', '이스트', 'EAST'
];

// Venue 고유 키워드 (다른 venue에서 이 키워드 나오면 제외)
const VENUE_EXCLUSIVE_KEYWORDS = {
  '백남준아트센터 (용인)': ['백남준', '굿모닝 미스터 오웰', 'NJP'],
  '이이남 스튜디오': ['이이남']
};

// ============ 유틸 함수들 ============
function cleanHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function normalizeSpaces(text) {
  return String(text || '').replace(/\s{2,}/g, ' ').trim();
}

function normalizeForCompare(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\-_/()\[\]{}.,:;'"""''!@#$%^&*+=?<>《》「」『』]+/g, '')
    .trim();
}

// ============ 전시명 salvage 규칙 ============

// 전시명 점수 계산 (높을수록 전시명일 가능성 높음)
function calculateTitleScore(title) {
  let score = 0;
  const t = String(title || '').trim();
  if (!t) return -100;

  // 전시 suffix가 있으면 +5
  if (EXHIBITION_SUFFIX_RE.test(t)) score += 5;

  // 콜론이 있으면 (작가: 제목 형태) +3
  if (/:/.test(t) && t.split(':').length === 2) score += 3;

  // 따옴표/괄호 안 제목 +2
  if (/[《「『<\[]/.test(t)) score += 2;

  // 한글 4자 이상 +1
  const koreanChars = (t.match(/[가-힣]/g) || []).length;
  if (koreanChars >= 4) score += 1;

  // 영문 대문자 단어 2개 이상 +2
  const upperWords = (t.match(/[A-Z][a-zA-Z]+/g) || []).length;
  if (upperWords >= 2) score += 2;

  // 노이즈 패턴이 있으면 감점
  if (TRAVEL_NOISE_RE.test(t)) score -= 10;
  if (GUIDE_NOISE_RE.test(t)) score -= 5;
  if (/데이트|맛집|핫플/.test(t)) score -= 5;

  // 너무 짧거나 길면 감점
  if (t.length < 3) score -= 5;
  if (t.length > 50) score -= 3;

  return score;
}

// 블로그 제목에서 전시명만 추출 (salvage)
function salvageExhibitionTitle(blogTitle, venueName) {
  let t = cleanHtml(blogTitle);
  if (!t) return '';

  // 1) 따옴표/괄호 안에 있는 제목 추출 시도
  const quotedMatch = t.match(/[《「『<\['""]([^》」』>\]'""]{3,40})[》」』>\]'""]/);
  if (quotedMatch) {
    const inner = quotedMatch[1].trim();
    if (calculateTitleScore(inner) >= 3) {
      return inner;
    }
  }

  // 2) 구분자로 분리해서 가장 전시명스러운 조각 선택
  const separators = /[,>|/\-]|\s+at\)|\s+@|\s+feat\./i;
  const parts = t.split(separators).map(p => p.trim()).filter(p => p.length >= 3);

  if (parts.length > 1) {
    let bestPart = null;
    let bestScore = -100;
    for (const part of parts) {
      const score = calculateTitleScore(part);
      if (score > bestScore) {
        bestScore = score;
        bestPart = part;
      }
    }
    if (bestPart && bestScore >= 2) {
      t = bestPart;
    }
  }

  // 3) 마케팅 꼬리 제거
  t = t.replace(MARKETING_TAIL_RE, '').trim();

  // 4) 지역/일상 접두 제거
  t = t.replace(LEADING_LOCATION_RE, '').trim();

  // 5) venue 이름 제거
  t = removeVenueTokens(t, venueName);

  // 6) 날짜 꼬리 제거 (예: "fangirl 2월 15일까지")
  t = t.replace(/\s*\d{1,2}월\s*\d{1,2}일까지\s*$/, '').trim();
  t = t.replace(/\s*~?\s*\d{1,2}\.\d{1,2}\s*$/, '').trim();

  // 7) 잘린 단어 복원
  t = repairTruncatedWord(t);

  // 8) 앞뒤 정리
  t = t.replace(/^[\s\-:~\[\]_@,.>|]+|[\s\-:~\[\]_@,.>|]+$/g, '').trim();
  t = normalizeSpaces(t);

  return t;
}

// 작가: 전시명 형태 분리
function splitArtistTitle(title) {
  const t = String(title || '').trim();
  if (!t.includes(':')) return { artist: null, title: t };

  const parts = t.split(':').map(p => p.trim());
  if (parts.length !== 2) return { artist: null, title: t };

  const [before, after] = parts;

  // before가 작가명처럼 보이는지 (2~15자, 노이즈 없음)
  const isLikelyArtist = before.length >= 2 && before.length <= 20 &&
    !TRAVEL_NOISE_RE.test(before) && !GUIDE_NOISE_RE.test(before) &&
    !/미술관|박물관|센터|갤러리|전시/.test(before);

  if (isLikelyArtist && after.length >= 2) {
    return { artist: before, title: after };
  }

  return { artist: null, title: t };
}

function removeVenueTokens(title, venueName) {
  let t = String(title || '').trim();
  if (!t) return t;

  const normVenue = normalizeVenueName(venueName);
  const nameVariants = new Set([normVenue, venueName]);
  const info = NORMALIZER_PRIVATE?.[normVenue];
  if (info?.aliases) {
    for (const a of info.aliases) nameVariants.add(String(a));
  }

  for (const name of nameVariants) {
    if (!name) continue;
    const rx = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    t = t.replace(rx, ' ').trim();
  }

  // 일반 기관명도 제거
  t = t.replace(/^(미술관|박물관|아트센터|스튜디오|Art Center|Art Space)\s*[:/\-]?\s*/i, '');

  return normalizeSpaces(t);
}

function repairTruncatedWord(title) {
  const tokens = String(title || '').trim().split(/\s+/);
  if (!tokens.length) return title;
  const last = tokens[tokens.length - 1];
  if (TRUNCATED_WORD_DICT[last]) {
    tokens[tokens.length - 1] = TRUNCATED_WORD_DICT[last];
  }
  return tokens.join(' ');
}

// ============ 기간 파싱 ============
function extractPeriodFromText(text) {
  return extractPeriod(text);
}

// 블로그 작성일 최근 n개월 이내만 통과 (포스트 날짜 YYYYMMDD)
function isRecentBlog(item, months = 3) {
  const pd = item?.postdate;
  if (!pd || pd.length !== 8) return true; // 정보 없으면 통과
  const y = pd.slice(0, 4);
  const m = pd.slice(4, 6);
  const d = pd.slice(6, 8);
  const postDate = new Date(`${y}-${m}-${d}`);
  if (!Number.isFinite(postDate.getTime())) return true;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return postDate >= cutoff;
}

// ============ 가격 파싱 ============
function extractPriceFromText(text) {
  const t = String(text || '');

  // 멤버십/연간권은 제외
  if (/(멤버십|연간|패스|구독)/i.test(t)) return null;

  // 무료
  if (/(무료|free|입장료\s*없)/i.test(t)) {
    return { adult: 0, free: true };
  }

  // 금액 추출: 숫자 + "원" 근접
  const priceMatch = t.match(/(\d{1,3}(?:,\d{3})*|\d{1,6})\s*원/);
  if (priceMatch) {
    const amount = parseInt(priceMatch[1].replace(/,/g, ''));
    // sanity check: 0 < fee <= 100000 (10만원 이하)
    if (amount > 0 && amount <= 100000) {
      return { adult: amount, free: false };
    }
  }

  return null;
}

// 브랜치 확장 (그라운드시소 등)
function expandVenueTargets(venues) {
  const targets = [];
  let gsAdded = false;
  for (const v of venues) {
    const norm = normalizeVenueName(v.name);
    // 그라운드시소는 분점 합쳐 단일 타깃으로 검색
    if (norm.startsWith('그라운드시소')) {
      if (!gsAdded) {
        targets.push({ ...v, name: '그라운드시소', branches: null });
        gsAdded = true;
      }
      continue;
    }

    if (Array.isArray(v.branches) && v.branches.length > 0) {
      for (const branch of v.branches) {
        const name = normalizeVenueName(`${v.name} ${branch}`);
        targets.push({ ...v, name, branches: null });
      }
    } else {
      targets.push({ ...v });
    }
  }
  return targets;
}

async function fetchNewsSnippet(query) {
  const res = await fetchNaverSearch('news', query, { display: 1, sort: 'date' }).catch(() => ({ items: [] }));
  const item = res.items?.[0];
  if (!item) return null;
  return cleanHtml(item.description || item.title || '');
}

function detectGroundSeesawBranch(candidate) {
  if (candidate.branchHint && normalizeVenueName(candidate.branchHint).startsWith(GS_BASE)) {
    return normalizeVenueName(candidate.branchHint);
  }
  const hint = [
    candidate.title,
    candidate.description,
    candidate.website,
    ...(candidate.sourceLinks || [])
  ].filter(Boolean).join(' ');
  const detected = extractVenueFromText(hint);
  if (detected && normalizeVenueName(detected).startsWith(GS_BASE)) {
    return normalizeVenueName(detected);
  }
  // 지점 키워드가 없으면 기본값 유지
  return GS_BASE;
}

async function enrichMetaWithPriority(candidate, venueName) {
  const title = candidate.title || '';
  let description = candidate.description || '';
  let image = Array.isArray(candidate.image) ? candidate.image[0] : (candidate.image || '');
  let descriptionSource = '';

  // 1) 공홈 메타로 강제 덮어쓰기
  const officialMeta = await fetchOfficialMetaForTitle(venueName, title);
  if (officialMeta.description) {
    description = officialMeta.description.slice(0, 220);
    descriptionSource = officialMeta.sourceUrl || descriptionSource;
  }
  if (officialMeta.image) {
    image = officialMeta.image;
  }

  // 2) 뉴스 메타 (부족분 보완)
  if (!description || !image) {
    const newsMeta = await fetchNewsMetaForTitle(title, venueName);
    if (newsMeta.description && !description) {
      description = newsMeta.description.slice(0, 220);
      descriptionSource = descriptionSource || newsMeta.sourceUrl;
    }
    if (newsMeta.image && !image) {
      image = newsMeta.image;
    }
  }

  // 3) 블로그 메타 (최후 보완)
  if (!description || !image) {
    const blogMeta = await fetchBlogMetaForTitle(title, venueName);
    if (blogMeta.description && !description) {
      description = blogMeta.description.slice(0, 220);
      descriptionSource = descriptionSource || blogMeta.sourceUrl;
    }
    if (blogMeta.image && !image) {
      image = blogMeta.image;
    }
  }

  if (!descriptionSource && candidate.website) descriptionSource = candidate.website;
  const needsRetry = !description || !image;
  if (needsRetry) {
    retryQueue.push({ venue: venueName, title, missing: { description: !description, image: !image } });
  }

  return {
    ...candidate,
    description,
    image: image ? [image] : [],
    descriptionSource
  };
}

// ============ 중복 병합 ============
function canonicalKey(title, venueName) {
  let key = String(title || '').toLowerCase();
  // 괄호/따옴표 제거
  key = key.replace(/[()\[\]{}<>《》「」『』"'""'']/g, '');
  // 전시 suffix 제거 (비교용)
  key = key.replace(/(전시|전시회|특별전|기획전|개인전|초대전|사진전)$/i, '');
  // 공백 정규화
  key = key.replace(/\s+/g, '');
  return `${normalizeForCompare(venueName)}::${key}`;
}

function isSimilarTitle(a, b) {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return false;
  // 포함 관계
  if (na.includes(nb) || nb.includes(na)) return true;
  // 짧은 쪽 길이의 80% 이상 겹치면 유사
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length >= nb.length ? na : nb;
  if (shorter.length >= 3 && longer.includes(shorter)) return true;
  return false;
}

// ============ 일반 제목 필터 ============
function isGenericTitle(title, venueName) {
  const t = String(title || '').trim();
  if (!t) return true;

  // 1. 지역/시간 + 전시만 있는 경우
  if (GENERIC_TITLE_RE.test(t)) return true;
  if (TIME_PREFIX_RE.test(t)) return true;
  if (MODIFIER_ONLY_RE.test(t)) return true;

  // 2. 블로그 리스트형/추천형 노이즈
  if (BLOG_LIST_NOISE_RE.test(t)) return true;

  // 3. 짧은 일반 전시명
  if (SHORT_GENERIC_RE.test(t)) return true;

  // 3.5. 지역 + 일반어
  if (LOCATION_GENERIC_RE.test(t)) return true;

  // 3.6. 날짜만 있는 제목
  if (DATE_ONLY_RE.test(t)) return true;

  // 3.7. 블로그 넘버링 패턴
  if (BLOG_NUMBERING_RE.test(t)) return true;

  // 4. venue명 + 전시만 남은 경우
  const venueOnlyRe = new RegExp(
    `^(${VENUE_NAMES_FOR_FILTER.join('|')})\\s*(전시|전시회|기획전|특별전)?$`, 'i'
  );
  if (venueOnlyRe.test(t)) return true;

  // 5. "[지역]" 또는 "지역]" 으로 시작하는 블로그 형식
  if (/^\[?[가-힣]{2,4}\]/.test(t)) return true;

  // 6. 너무 짧은 제목 (한글 2자 이하)
  const koreanOnly = t.replace(/[^가-힣]/g, '');
  if (koreanOnly.length > 0 && koreanOnly.length <= 2) return true;

  // 7. "N월 N일" 만 있는 경우
  if (/^\d{1,2}월\s*\d{1,2}일/.test(t) && t.length < 15) return true;

  // 8. 너무 긴 제목 (블로그 스타일)
  if (t.length > 40) return true;

  // 9. 여러 venue 언급 (블로그 요약)
  const venueCount = VENUE_NAMES_FOR_FILTER.filter(v => t.includes(v)).length;
  if (venueCount >= 2) return true;

  // 10. 블로그 스타일 마커
  if (/[#️⃣🎨🖼️📷]|piiin\]|전시\s*\d+\s*\||Culture\s*Note/i.test(t)) return true;

  // 11. 잘린 제목 (끝에 ... 또는 ..)
  if (/\.{2,}$/.test(t)) return true;

  // 12. "점 전시", "동 전시" 같은 불완전 제목
  if (/^.{1,2}\s*(전시|전시회)$/.test(t)) return true;

  // 13. 년도만 있는 제목 (2024, 2025 등)
  if (/^(20\d{2})\s*(년|\.)?$/.test(t)) return true;

  // 14. 전시공간, 문화재단 같은 기관명
  if (/^(전시공간|문화재단|전시관|미술관)/.test(t)) return true;

  // 15. 시간 언급 포함
  if (TIME_MENTION_RE.test(t)) return true;

  // 16. N월 N월 패턴 (11월 12월 전시회)
  if (/\d{1,2}월\s*\d{1,2}월/.test(t)) return true;

  // 17. 가격/예약 정보 포함
  if (/(통합권|원\s*$|\d+원|예약|신청|모집)/.test(t)) return true;

  // 18. 한글 1자 + 공백 + 무언가 (불완전 제목: "동 이불 전시")
  if (/^[가-힣]\s+/.test(t)) return true;

  // 19. "N. " 로 시작 (블로그 목록)
  if (/^\d+\.\s+/.test(t)) return true;

  // 20. 특수문자로 시작
  if (/^[■●○★☆▶▷◆◇→←↑↓※]/.test(t)) return true;

  // 21. 팝업/카페/맛집 (전시 아님)
  if (/(팝업|카페|맛집|레스토랑|커피)/.test(t)) return true;

  // 22. 불완전 제목 (느낌표로 시작하거나 괄호로 끝남)
  if (/^!|[(\[{]$/.test(t)) return true;

  // 23. "후기" 만 있는 제목
  if (/^.{0,5}(후기|리뷰)\s*(\/|$)/.test(t)) return true;

  // 24. 감탄형 시작
  if (/^(너무|정말|진짜|완전|역시|오|와|꺄)\s/.test(t)) return true;

  // 25. 영문 "for" 로 시작 (불완전)
  if (/^for\s/i.test(t)) return true;

  // 26. "]" 로 시작 (잘린 태그)
  if (/^\]/.test(t)) return true;

  // 27. "후기", "관람후기", "리뷰" 로 끝남
  if (/(후기|관람후기|리뷰|관람기)$/.test(t)) return true;

  // 28. "전시 계획", "라인업 공개" 등 발표/예고형
  if (/(계획\s*발표|라인업\s*공개|일정|프로그램\s*일정)/.test(t)) return true;

  // 29. "N월에 가 볼 만한" 추천형 (예: "12월에 가볼 만한 전시")
  if (/\b\d{1,2}\s*월에?\s*(가|볼|봐야|가야)/.test(t)) return true;

  // 30. "전시 서울 전시회" 같은 일반형
  if (/^전시\s+(서울|제주|경기|용산)\s*전시(회)?$/.test(t)) return true;

  // 31. "N년 N월 서울 무료 전시회" 연도 포함 추천형
  if (/20\d{2}년?\s*\d{1,2}월/.test(t)) return true;

  // 32. venue 이름 + "외 N곳" 패턴
  if (/외\s*\d+\s*곳/.test(t)) return true;

  // 33. "전시 복합문화공간" 같은 일반형
  if (/^전시\s*(복합문화공간|공간)/.test(t)) return true;

  // 34. "왓츠인마이블로그" 등 블로그 이벤트
  if (/(왓츠인마이블로그|블챌|주간일기)/.test(t)) return true;

  // 35. 날짜 괄호 패턴 ('21.10.21.)
  if (/\('\d{2}\.\d{1,2}\.\d{1,2}\.\)/.test(t)) return true;

  return false;
}

// ============ 핵심 제목 추출 ============
function extractCoreTitle(title) {
  let t = String(title || '').trim();

  // 0. venue 관련 접두사 제거
  t = t.replace(/^(이스트|EAST|서촌|한남|명동|성수|센트럴)\s*[:\]>|\-]?\s*/i, '');
  t = t.replace(/^(그라운드시소|리움|대림|아트선재|아모레퍼시픽|피크닉|송은)\s*[:\]>|\-]?\s*/i, '');

  // 1. 작가명 분리 (콜론 뒤만 사용)
  if (t.includes(':')) {
    const parts = t.split(':');
    if (parts.length === 2 && parts[1].trim().length >= 2) {
      t = parts[1].trim();
    }
  }

  // 2. 괄호 내용 추출 (괄호 안이 핵심일 수 있음)
  const parenMatch = t.match(/[《「『<\[]([\s\S]+?)[》」』>\]]/);
  if (parenMatch && parenMatch[1].length >= 3) {
    t = parenMatch[1].trim();
  } else {
    // 괄호 제거
    t = t.replace(/[()\[\]{}<>《》「」『』"'""'']/g, '');
  }

  // 3. 전시 suffix 제거
  t = t.replace(/(전시|전시회|특별전|기획전|개인전|초대전|사진전|관람후기|후기|예약|할인)$/i, '');

  // 4. 날짜/숫자 패턴 제거
  t = t.replace(/\d{4}[.\-/]\d{1,2}[.\-/]?\d{0,2}/g, '');
  t = t.replace(/\d{1,2}월\s*\d{1,2}일?/g, '');

  // 5. 공백/특수문자 제거 후 소문자화
  t = t.replace(/[\s\-_,.;:!?@#$%^&*+=~|/]+/g, '').toLowerCase();

  return t;
}

// ============ 문자열 유사도 ============
function levenshteinDistance(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i-1] === a[j-1]
        ? matrix[i-1][j-1]
        : Math.min(matrix[i-1][j-1]+1, matrix[i][j-1]+1, matrix[i-1][j]+1);
    }
  }
  return matrix[b.length][a.length];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// ============ 병합 판단 ============
function shouldMerge(titleA, titleB) {
  const coreA = extractCoreTitle(titleA);
  const coreB = extractCoreTitle(titleB);

  if (!coreA || !coreB) return false;
  if (coreA.length < 2 || coreB.length < 2) return false;

  // 1. 핵심어 완전 동일
  if (coreA === coreB) return true;

  // 2. 포함관계 (2자 이상)
  if (coreA.length >= 2 && coreB.length >= 2) {
    if (coreA.includes(coreB) || coreB.includes(coreA)) return true;
  }

  // 3. 유사도 60% 이상 (더 공격적으로)
  if (similarity(coreA, coreB) >= 0.6) return true;

  // 4. 공통 부분문자열이 4자 이상이면 병합
  const shorter = coreA.length < coreB.length ? coreA : coreB;
  const longer = coreA.length >= coreB.length ? coreA : coreB;
  for (let len = Math.min(shorter.length, 6); len >= 4; len--) {
    for (let i = 0; i <= shorter.length - len; i++) {
      const sub = shorter.slice(i, i + len);
      if (longer.includes(sub)) return true;
    }
  }

  return false;
}

// ============ Cross-venue 체크 ============
function isExclusiveToOtherVenue(text, currentVenue) {
  for (const [venue, keywords] of Object.entries(VENUE_EXCLUSIVE_KEYWORDS)) {
    if (venue === currentVenue) continue;
    if (keywords.some(kw => text.includes(kw))) return venue;
  }
  return null;
}

function containsOtherVenue(text, currentVenue) {
  const t = String(text || '');
  const current = normalizeVenueName(currentVenue);

  // 현재 venue의 alias 목록
  const currentAliases = new Set([current]);
  const info = NORMALIZER_PRIVATE?.[current];
  if (info?.aliases) {
    for (const a of info.aliases) currentAliases.add(String(a).toLowerCase());
  }

  // 다른 private venue 체크
  for (const name of KNOWN_VENUE_NAMES) {
    if (!name || name === current) continue;
    if (currentAliases.has(name.toLowerCase())) continue;
    if (t.includes(name)) return name;
  }

  // 다른 유명 venue 체크
  for (const name of OTHER_VENUE_NAMES) {
    if (t.includes(name)) return name;
  }

  return null;
}

// ============ 전시 후보 필터 ============
function isValidExhibitionCandidate(title, venueName, desc, { allowGuideNoise = false } = {}) {
  const t = String(title || '').trim();
  if (!t) return false;
  if (t.length < 3 || t.length > 60) return false;

  // 일반적 제목 필터 (서울 전시, 12월 전시회 등)
  if (isGenericTitle(t, venueName)) return false;

  // 지역 단독
  if (REGION_ONLY.has(t)) return false;

  // 숫자만
  if (/^[\d\s.\-/~]+$/.test(t)) return false;

  // 노이즈 패턴
  if (TRAVEL_NOISE_RE.test(t)) return false;

  // 기관명만
  if (/^(미술관|박물관|아트센터|갤러리|스튜디오)$/i.test(t)) return false;

  // cross-venue 체크 (다른 venue 이름이 있으면 제외)
  const text = `${t} ${desc || ''}`;

  // venue 고유 키워드 체크 (백남준/이이남 등)
  const exclusiveVenue = isExclusiveToOtherVenue(text, venueName);
  if (exclusiveVenue) return false;

  const otherVenue = containsOtherVenue(text, venueName);
  if (otherVenue) {
    // console.log(`[SKIP] cross-venue: "${t}" contains "${otherVenue}"`);
    return false;
  }

  // 안내/후기 노이즈
  if (!allowGuideNoise) {
    const hasTicketContext = /(티켓|입장권|예매|예약)/i.test(t);
    const guideHit = GUIDE_NOISE_RE.test(t) || GUIDE_NOISE_RE.test(desc || '');
    if (guideHit && !hasTicketContext) return false;
  }

  return true;
}

// ============ 검색 및 수집 ============
function buildQueries(venue) {
  const queries = new Set();
  const baseKeys = Array.isArray(venue.searchKeys) && venue.searchKeys.length > 0 ? venue.searchKeys : [venue.name];
  for (const key of baseKeys) {
    const trimmed = String(key || '').trim();
    if (!trimmed) continue;
    if (/전시/.test(trimmed)) {
      queries.add(trimmed);
      queries.add(trimmed.replace(/전시/g, '특별전'));
      queries.add(trimmed.replace(/전시/g, '기획전'));
    } else {
      queries.add(`${trimmed} 전시`);
      queries.add(`${trimmed} 기획전`);
      queries.add(`${trimmed} 특별전`);
    }
  }
  return Array.from(queries);
}

function isGroundSeesaw(name) {
  const n = normalizeVenueName(name);
  return n.startsWith('그라운드시소');
}

async function searchVenue(venue) {
  const queries = buildQueries(venue);
  const candidates = [];
  const isGS = isGroundSeesaw(venue.name);

  for (const query of queries) {
    const blogRes = await fetchNaverSearch('blog', query, { display: 20, sort: 'sim' }).catch(() => ({ items: [] }));

    for (const item of blogRes.items || []) {
      if (!isRecentBlog(item)) continue;

      const blogTitle = cleanHtml(item.title);
      const desc = cleanHtml(item.description);
      const text = `${blogTitle} ${desc}`;
      const branchHint = extractVenueFromText(text);

      // venue 토큰 확인
      const normVenue = normalizeVenueName(venue.name);
      const info = NORMALIZER_PRIVATE?.[normVenue];
      const aliases = info?.aliases || [];
      const hasVenue = text.includes(normVenue) || text.includes(venue.name) || aliases.some(a => text.includes(a));
      if (!hasVenue) continue;

      // cross-venue 체크
      const otherVenue = containsOtherVenue(text, venue.name);
      if (otherVenue) continue;

      // 여행/노이즈 체크
      if (TRAVEL_NOISE_RE.test(text)) continue;

      // 전시명 추출 (salvage)
      const salvaged = salvageExhibitionTitle(blogTitle, venue.name);
      if (!salvaged || salvaged.length < 2) continue;

      // 유효성 검사
      if (!isValidExhibitionCandidate(salvaged, venue.name, desc)) continue;

      // 작가: 전시명 분리
      const { artist, title } = splitArtistTitle(salvaged);

      // 기간/가격 추출
      const period = extractPeriodFromText(text);
      const price = extractPriceFromText(text);

      candidates.push({
        title,
        artist,
        period,
        price,
        description: desc.slice(0, 200),
        website: item.link || '',
        source: 'blog',
        branchHint: branchHint && branchHint.startsWith(GS_BASE) ? branchHint : null,
        score: calculateTitleScore(title) - (isGS ? 3 : 0) // 그라운드시소는 블로그 우선도 낮춤
      });
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  // 그라운드시소 계열: 네이버 쇼핑 티켓을 추가로 수집 (통합 쿼리, 불필요 토큰 제거)
  if (isGroundSeesaw(venue.name)) {
    // 지점 구분 없이 통합 검색
    const shopQueries = new Set([
      '그라운드시소 전시',
      '요시고 전시 티켓',
      '요시고 사진전 티켓',
      '히무로 유리 전시 티켓',
      '워너 브롱크호스트 전시 티켓'
    ]);
    const shopItems = [];
    for (const q of shopQueries) {
      const res = await fetchNaverSearch('shop', q, { display: 40, sort: 'date' }).catch(() => ({ items: [] }));
      if (res?.items) shopItems.push(...res.items);
      await new Promise(r => setTimeout(r, 200));
    }
    for (const item of shopItems) {
      const titleRaw = cleanHtml(item.title);
      const desc = cleanHtml(item.subtitle || item.brand || '');
      const text = `${titleRaw} ${desc}`;
      const branchHint = extractVenueFromText(text);

      // 굿즈/문구류만 제외 (POS 키워드 없이도 허용)
      if (SHOP_TICKET_NEG_RE.test(text)) continue;

      // 전시명이 섞인 불필요 토큰을 제거
      const cleaned = titleRaw
        .replace(/워너디스\s*스티커.*$/gi, '')
        .replace(/\b입장권\]?\s*/gi, '')
        .replace(/\b기본가\b/gi, '')
        .replace(/\b무료배송\b/gi, '')
        .replace(/\b티켓\b/gi, '')
        .replace(/\b패키지\b/gi, '')
        .replace(/\b기본\s*입장\b/gi, '')
        .replace(/\b1인\s*입장\b/gi, '')
        .replace(new RegExp(`\\b(${SHOP_STOPWORDS.join('|')})\\b`, 'gi'), ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

      const baseVenue = '그라운드시소';
      let salvaged = salvageExhibitionTitle(cleaned || titleRaw, baseVenue);
      if (!salvaged || salvaged.length < 2) continue;
      if (!isValidExhibitionCandidate(salvaged, baseVenue, desc, { allowGuideNoise: true })) continue;

      const { artist, title } = splitArtistTitle(salvaged);
      const period = extractPeriodFromText(text);
      const price = item.lprice ? { adult: Number(item.lprice), free: false } : null;
      const newsDesc = await fetchNewsSnippet(`${title} 전시`);

      let description = (newsDesc || desc || '').slice(0, 200);
      let image = item.image || '';
      const officialHit = isOfficialUrl(item.link || '', baseVenue);
      const officialMetaFromLink = officialHit ? await fetchOfficialMeta(item.link) : {};
      // 공홈/매핑 보강 (shop 링크가 공홈이 아니거나 이미지/설명이 비었을 때)
      const officialMetaByTitle = await fetchOfficialMetaForTitle(baseVenue, title);
      const prioritizedMeta = officialMetaFromLink.description || officialMetaFromLink.image ? officialMetaFromLink : officialMetaByTitle;
      if (prioritizedMeta.description) description = prioritizedMeta.description.slice(0, 200);
      if (prioritizedMeta.image) image = prioritizedMeta.image;
      if (!prioritizedMeta.description && officialMetaByTitle.description && !description) {
        description = officialMetaByTitle.description.slice(0, 200);
      }
      if (!prioritizedMeta.image && officialMetaByTitle.image && !image) {
        image = officialMetaByTitle.image;
      }

      candidates.push({
        title,
        artist,
        period,
        price,
        description,
        image,
        isOfficial: officialHit,
        website: item.link || '',
        branchHint: branchHint && branchHint.startsWith(baseVenue) ? branchHint : null,
        source: 'shop',
        score: calculateTitleScore(title) + 5 // 티켓 → 현재 전시 가중치 대폭 상향
      });
    }
  }

  // 그라운드시소: shop 결과가 하나라도 있으면 shop만 남기기 (블로그는 보조)
  if (isGS) {
    const hasShop = candidates.some(c => c.source === 'shop');
    if (hasShop) {
      const shops = candidates.filter(c => c.source === 'shop');
      const blogs = candidates.filter(c => c.source === 'blog');
      // shop 우선, shop 부족하면 블로그도 포함
      return shops.length >= 1 ? shops.concat(blogs.slice(0, Math.max(0, 3 - shops.length))) : blogs;
    }
  }

  return candidates;
}

// ============ 후보 병합 (그룹 기반) ============
function mergeCandidates(candidates, venueName) {
  // Pass 1: shouldMerge()로 그룹핑
  const groups = [];

  for (const cand of candidates) {
    let merged = false;
    for (const group of groups) {
      // 그룹 대표와 비교
      if (shouldMerge(cand.title, group[0].title)) {
        group.push(cand);
        merged = true;
        break;
      }
    }
    if (!merged) {
      groups.push([cand]);
    }
  }

  // Pass 2: 각 그룹에서 대표 선정 (완전성 점수 기반)
  const results = [];
  for (const group of groups) {
    // 완전성 점수 계산
    const scored = group.map(c => ({
      ...c,
      completeness:
        (c.period ? 3 : 0) +
        (c.price ? 2 : 0) +
        (c.artist ? 2 : 0) +
        (EXHIBITION_SUFFIX_RE.test(c.title) ? 1 : 0) +
        (c.title.length >= 10 && c.title.length <= 30 ? 1 : 0)
    }));

    // 완전성 높은 순 정렬
    scored.sort((a, b) => b.completeness - a.completeness);

    const best = scored[0];

    // 그룹 내에서 가장 좋은 기간/가격 찾기
    let bestPeriod = best.period;
    let bestPrice = best.price;
    for (const c of scored) {
      if (!bestPeriod && c.period) bestPeriod = c.period;
      if (bestPeriod && !bestPeriod.start && c.period?.start) bestPeriod = c.period;
      if (!bestPrice && c.price) bestPrice = c.price;
    }

    // 설명/이미지 선택: 공홈 > 뉴스 > 블로그
    const officialDesc = group.find(c => c.isOfficial && c.description)?.description;
    const newsDesc = group.find(c => c.source === 'news' && c.description)?.description;
    const descriptions = group.map(c => c.description).filter(Boolean);
    const bestDesc = officialDesc || newsDesc || descriptions.sort((a, b) => b.length - a.length)[0] || '';
    const officialImage = group.find(c => c.isOfficial && c.image)?.image;
    const newsImage = group.find(c => c.source === 'news' && c.image)?.image;
    const bestImage = officialImage || newsImage || group.find(c => c.image)?.image || '';
    const officialUrl = group.find(c => isOfficialUrl(c.website, venueName))?.website || group.find(c => c.isOfficial && c.website)?.website || '';
    const sourceLinks = [...new Set(group.map(c => c.website).filter(Boolean))];

    // 모든 alias 수집
    const aliases = new Set();
    for (const c of group) {
      if (c.title !== best.title) aliases.add(c.title);
    }
    const branchHint = group.map(c => c.branchHint).find(Boolean) || null;

    results.push({
      title: best.artist ? `${best.artist}: ${best.title}` : best.title,
      artist: best.artist,
      period: bestPeriod,
      price: bestPrice,
      description: bestDesc,
      image: bestImage ? [bestImage] : [],
      website: officialUrl || sourceLinks[0] || '',
      branchHint,
      sourceLinks,
      aliases: Array.from(aliases),
      sources: [...new Set(group.map(c => c.source))],
      count: group.length,
      score: best.score
    });
  }

  // 출현 횟수 2회 이상만 유지 (노이즈 제거)
  const minCount = isGroundSeesaw(venueName) ? 1 : 2;
  const filtered = results.filter(r => r.count >= minCount);

  // 점수순 정렬
  filtered.sort((a, b) => b.score - a.score);

  return filtered;
}

async function enrichMergedResults(merged, venueName) {
  const normalizedVenue = normalizeVenueName(venueName);
  const tasks = merged.map(async (item) => {
    const resolvedVenue = normalizedVenue === GS_BASE ? detectGroundSeesawBranch(item) : normalizedVenue;
    const enriched = await enrichMetaWithPriority(item, resolvedVenue);
    return { ...enriched, venueName: resolvedVenue };
  });
  return Promise.all(tasks);
}

// ============ 결과 상한 및 우선순위 헬퍼 ============
function parseISODateSafe(d) {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t) : null;
}

function extractDatesFromExhibition(ex) {
  const startRaw = ex.startDate || ex.period?.start || (typeof ex.period === 'string' ? ex.period.split('~')[0]?.trim() : null);
  const endRaw = ex.endDate || ex.period?.end || (typeof ex.period === 'string' ? ex.period.split('~')[1]?.trim() : null);
  return {
    start: parseISODateSafe(startRaw),
    end: parseISODateSafe(endRaw)
  };
}

function exhibitionScore(ex) {
  const today = new Date();
  const { start, end } = extractDatesFromExhibition(ex);
  let current = false;
  let future = false;
  if (start && end) {
    current = start <= today && today <= end;
    future = start > today;
  } else if (start && !end) {
    current = start <= today;
    future = start > today;
  }

  let score = 0;
  if (current) score += 3;
  else if (future) score += 1.5;
  if (typeof ex.confidence === 'number') score += ex.confidence;
  if (typeof ex.count === 'number') score += 0.1 * ex.count;
  // 블로그 단계(score 필드) 대비
  if (typeof ex.score === 'number') score += ex.score * 0.1;
  return score;
}

function capPerVenue(exhibitions) {
  const sorted = [...exhibitions]
    // 종료일이 오늘 이전이면 제외
    .filter((ex) => {
      const { end } = extractDatesFromExhibition(ex);
      if (!end) return true; // 종료일 없으면 포함
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      today.setDate(today.getDate() + END_GRACE_DAYS);
      return end >= today; // 오늘+유예 이후만
    })
    .sort((a, b) => exhibitionScore(b) - exhibitionScore(a));
  return sorted.slice(0, FINAL_PER_VENUE_MAX);
}

function capGlobal(preview) {
  const flat = [];
  for (const [venue, data] of Object.entries(preview)) {
    for (const ex of data.exhibitions || []) {
      flat.push({ venue, ex, score: exhibitionScore(ex) });
    }
  }
  const top = flat.sort((a, b) => b.score - a.score).slice(0, FINAL_GLOBAL_MAX);
  const keep = new Map();
  for (const item of top) {
    if (!keep.has(item.venue)) keep.set(item.venue, []);
    keep.get(item.venue).push(item.ex);
  }

  const capped = {};
  for (const [venue, data] of Object.entries(preview)) {
    if (keep.has(venue)) {
      capped[venue] = { ...data, exhibitions: keep.get(venue) };
    } else {
      capped[venue] = { ...data, exhibitions: [] };
    }
  }
  return capped;
}

// ============ Preview 함수 (DB 저장 없이) ============
export async function runPrivateVenuePreview({ limit = 20 } = {}) {
  const venues = getPrivateVenueSearchList();
  const expandedTargets = expandVenueTargets(venues);
  const targets = Number.isFinite(limit) && limit > 0 ? expandedTargets.slice(0, limit) : expandedTargets;

  const preview = {};
  let totalCandidates = 0;
  let totalMerged = 0;

  for (const venue of targets) {
    console.log(`[검색 중] ${venue.name}...`);

    const candidates = await searchVenue(venue);
    totalCandidates += candidates.length;

    const merged = mergeCandidates(candidates, venue.name);
    totalMerged += merged.length;

    const venueName = normalizeVenueName(venue.name);
    preview[venueName] = merged.map(m => ({
      title: m.title,
      period: m.period ? (m.period.permanent ? '상설' : `${m.period.start || '?'} ~ ${m.period.end || '?'}`) : null,
      price: m.price ? (m.price.free ? '무료' : `${m.price.adult?.toLocaleString()}원`) : null,
      count: m.count || 1,
      score: m.score,
      aliases: m.aliases?.length > 0 ? m.aliases : undefined
    }));
  }

  // 상한 적용 (blog-only 프리뷰도 동일 정책)
  const cappedPerVenue = {};
  for (const [venue, items] of Object.entries(preview)) {
    cappedPerVenue[venue] = capPerVenue(items);
  }
  const cappedPreview = capGlobal(Object.fromEntries(Object.entries(cappedPerVenue).map(([v, ex]) => [v, { exhibitions: ex }])));

  return {
    scanned: targets.length,
    totalCandidates,
    totalMerged,
    preview: cappedPreview
  };
}

// ============ Preview + Gemini 정규화 ============
export async function runPrivateVenuePreviewWithGemini({ limit = 20 } = {}) {
  // 1단계: 기존 블로그 기반 수집
  console.log('[Phase 1] Blog-based candidate extraction...');
  const blogPreview = await runPrivateVenuePreview({ limit });

  console.log(`[Phase 1 완료] 후보 ${blogPreview.totalCandidates} → 병합 ${blogPreview.totalMerged}`);

  // 2단계: Gemini 정규화
  console.log('\n[Phase 2] Gemini normalization...');
  resetNormalizeQuota();

  const geminiResults = await normalizeAllVenues(blogPreview);

  if (geminiResults.error) {
    console.log(`[Phase 2] Gemini disabled or error: ${geminiResults.error}`);
    return {
      ...blogPreview,
      gemini: { error: geminiResults.error }
    };
  }

  console.log(`[Phase 2 완료] ${geminiResults.totalExhibitions} exhibitions, ${geminiResults.totalRejects} rejects`);

  // 3단계: 결과 정리
  const finalPreview = {};
  let totalFinal = 0;

  for (const [venueName, geminiResult] of Object.entries(geminiResults.results)) {
    if (geminiResult.error || geminiResult.skipped) {
      // Gemini 실패 시 기존 결과 사용
      finalPreview[venueName] = {
        source: 'blog_only',
        exhibitions: blogPreview.preview[venueName] || []
      };
    } else {
      // Gemini 성공 시 정규화 결과 사용
      finalPreview[venueName] = {
        source: 'gemini',
        exhibitions: geminiResult.exhibitions.map(e => ({
          title: e.canonicalTitle,
          titleKey: e.titleKey,
          artist: e.artist || null,
          period: e.startDate && e.endDate ? `${e.startDate} ~ ${e.endDate}` : (e.isPermanent ? '상설' : null),
          isPermanent: e.isPermanent,
          confidence: e.confidence,
          aliases: e.aliases,
          evidenceUrls: e.evidenceUrls
        })),
        rejects: geminiResult.rejects
      };
      totalFinal += geminiResult.exhibitions.length;
    }
  }

  // per-venue 상한 적용
  for (const [venue, data] of Object.entries(finalPreview)) {
    finalPreview[venue] = { ...data, exhibitions: capPerVenue(data.exhibitions || []) };
  }
  // global 상한 적용
  const cappedPreview = capGlobal(finalPreview);
  totalFinal = Object.values(cappedPreview).reduce((sum, v) => sum + (v.exhibitions?.length || 0), 0);

  return {
    phase1: {
      scanned: blogPreview.scanned,
      totalCandidates: blogPreview.totalCandidates,
      totalMerged: blogPreview.totalMerged
    },
    phase2: {
      callsUsed: geminiResults.callsUsed,
      totalExhibitions: geminiResults.totalExhibitions,
      totalRejects: geminiResults.totalRejects
    },
    totalFinal,
    preview: cappedPreview
  };
}

// ============ 단일 venue Gemini 테스트 ============
export async function testGeminiNormalizeVenue(venueName, { runSearch = true } = {}) {
  let candidates;

  if (runSearch) {
    // 실제 검색 수행
    const venues = getPrivateVenueSearchList();
    const venue = venues.find(v => normalizeVenueName(v.name) === normalizeVenueName(venueName));
    if (!venue) {
      return { error: `Venue not found: ${venueName}` };
    }

    console.log(`[검색 중] ${venue.name}...`);
    const rawCandidates = await searchVenue(venue);
    candidates = mergeCandidates(rawCandidates, venue.name);
    console.log(`[검색 완료] ${rawCandidates.length} raw → ${candidates.length} merged`);
  } else {
    // 테스트용 더미 데이터
    candidates = [
      { title: '테스트 전시 1', count: 3, period: { start: '2025-01-01', end: '2025-06-30' } },
      { title: '테스트 전시 2', count: 2 }
    ];
  }

  // Gemini 정규화
  console.log('\n[Gemini 정규화 중]...');
  resetNormalizeQuota();
  const result = await normalizeWithGemini(venueName, candidates);

  return {
    venueName,
    inputCandidates: candidates.length,
    geminiResult: result
  };
}

// ============ DB 저장 함수 (기존) ============
async function upsertVenue(meta) {
  if (!meta) return null;
  const barrier = {
    wheelchair: !!meta.wheelchair,
    parkingFree: meta.parking?.startsWith('Y') || meta.parking?.includes('Y/'),
    parkingPaid: meta.parking?.endsWith('/Y') || false,
    accessibleToilet: !!meta.toilet,
    braille: meta.brailleAudio?.startsWith('Y') || meta.brailleAudio?.includes('Y/'),
    audioGuide: meta.brailleAudio?.endsWith('/Y') || false
  };

  const existing = await Venue.findOne({ name: meta.name });
  if (existing) {
    await Venue.updateOne({ _id: existing._id }, {
      $set: {
        openHours: meta.hours,
        barrierFree: { ...existing.barrierFree, ...barrier },
        location: { lat: meta.lat, lng: meta.lng },
        notes: 'private'
      }
    });
    return existing._id;
  }

  const created = await Venue.create({
    name: meta.name,
    region: '',
    address: meta.name,
    openHours: meta.hours,
    location: { lat: meta.lat, lng: meta.lng },
    website: meta.website || '',
    barrierFree: barrier,
    notes: 'private'
  });
  return created._id;
}

export async function runPrivateVenueSync({ limit = 20 } = {}) {
  await mongoose.connect(process.env.MONGO_URI);
  retryQueue.length = 0;

  const venues = getPrivateVenueSearchList();
  const targets = Number.isFinite(limit) && limit > 0 ? venues.slice(0, limit) : venues;

  let created = 0, updated = 0, skipped = 0;

  for (const venue of targets) {
    const meta = PRIVATE_META.get(venue.name);
    await upsertVenue(meta);

    const candidates = await searchVenue(venue);
    const merged = mergeCandidates(candidates, venue.name);
    const enrichedMerged = await enrichMergedResults(merged, venue.name);
    const limitedMerged = capPerVenue(enrichedMerged);

    for (const m of limitedMerged) {
      const venueName = normalizeVenueName(m.venueName || venue.name);
      let venueDoc = await Venue.findOne({ name: venueName });
      if (!venueDoc) {
        const meta = PRIVATE_META.get(venueName);
        if (meta) {
          await upsertVenue(meta);
          venueDoc = await Venue.findOne({ name: venueName });
        }
      }
      if (!venueDoc) { skipped++; continue; }

      const titleKey = normalizeForCompare(m.title);
      const existing = await Exhibition.findOne({ 'venue.name': venueName, titleKey });

      const descText = m.description || '';
      const descSource = m.descriptionSource || '';
      const finalDescription = descSource
        ? `${descText}${descText ? '\n' : ''}출처: ${descSource}`
        : descText;

      const doc = {
        title: m.artist ? `${m.artist}: ${m.title}` : m.title,
        titleKey,
        period: m.period || undefined,
        periodUnknown: !m.period,
        price: m.price || undefined,
        venue: {
          name: venueDoc.name,
          address: venueDoc.address || venueDoc.name,
          location: venueDoc.location
        },
        website: (() => {
          const officialUrl = OFFICIAL_URLS[venueName] || '';
          const sourceUrl = m.descriptionSource || '';
          if (officialUrl && sourceUrl && officialUrl !== sourceUrl) {
            return `${officialUrl}\n${sourceUrl}`;
          }
          return officialUrl || sourceUrl || m.website || '';
        })(),
        description: finalDescription,
        descriptionSource: m.descriptionSource || undefined,
        images: Array.isArray(m.image) ? m.image : [],
        _source: 'private_search',
        _apiId: `priv-${titleKey}-${normalizeForCompare(venueName)}`,
        permanent: !!m.period?.permanent
      };

      if (existing) {
        await Exhibition.updateOne({ _id: existing._id }, { $set: doc });
        updated++;
      } else {
        await Exhibition.create(doc);
        created++;
      }
    }
  }

  await mongoose.disconnect();
  return { created, updated, skipped, scanned: targets.length, retryQueue };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const command = args[0] || 'sync';

  async function main() {
    switch (command) {
      case 'sync':
        return runPrivateVenueSync();

      case 'preview':
        return runPrivateVenuePreview({ limit: Number(args[1]) || 20 });

      case 'gemini':
        // 전체 Gemini 정규화 테스트
        return runPrivateVenuePreviewWithGemini({ limit: Number(args[1]) || 5 });

      case 'test-venue':
        // 단일 venue Gemini 테스트
        const venueName = args[1] || '리움미술관';
        return testGeminiNormalizeVenue(venueName, { runSearch: true });

      default:
        console.log('Usage:');
        console.log('  node privateVenueSync.js sync         - DB에 저장');
        console.log('  node privateVenueSync.js preview [N]  - 블로그 기반 미리보기 (N개 venue)');
        console.log('  node privateVenueSync.js gemini [N]   - Gemini 정규화 테스트 (N개 venue)');
        console.log('  node privateVenueSync.js test-venue [이름] - 단일 venue 테스트');
        return { help: true };
    }
  }

  main().then((r) => {
    console.log('\n=== 결과 ===');
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
