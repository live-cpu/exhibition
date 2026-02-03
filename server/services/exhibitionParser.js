/**
 * 전시 정보 파싱 모듈 (강화 버전)
 * - 기간 추출 (신뢰도/문맥 점수 기반)
 * - 가격 추출
 * - 전시명/굿즈/노이즈 판별
 */

// 상설/상시/연중 전시 패턴
const PERMANENT_RE = /(상설|상시|연중|항상|permanent|ongoing|常設)/i;

// 긍정/부정 문맥 토큰
const PERIOD_POSITIVE = /(전시기간|기간|일시|전시|특별전|기획전|개인전|사진전|~까지|부터|개막|오픈|종료|연장|입장료|예매|티켓)/i;
const PERIOD_NEGATIVE = /(다녀옴|다녀온|방문|관람(?:함)?|후기|리뷰|기록|일기|내돈내산|데이트|카페|맛집|가볼만한곳|핫플|여행|투어|코스)/i;
const WEEKDAY_RE = /(월|화|수|목|금|토|일)요일/;
const YYMMDD_RE = /\b\d{6}\b/; // 방문일 형태 240308
const VISIT_CONTEXT_RE = /(방문|다녀왔|후기|리뷰|관람기|기록|일기)/i;
const END_GRACE_DAYS = Number(process.env.PRIVATE_PERIOD_END_GRACE_DAYS || 1);

// 등급 가중치
const GRADE_SCORE = { A: 8, B: 5, C: 2 };

function pad(n) { return String(n).padStart(2, '0'); }
function makeDate(y, m, d) {
  const dt = new Date(`${y}-${pad(m)}-${pad(d)}`);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function makePeriod(start, end, raw, partial = false, permanent = false, grade = 'C') {
  return { start, end, raw, partial, permanent, grade };
}

/**
 * 기간 추출 (문맥 점수 기반)
 * @param {string} text
 * @param {Date} today
 * @returns {object|null} {start, end, raw, partial, permanent, grade, score}
 */
export function extractPeriod(text, today = new Date()) {
  if (!text) return null;
  const t = String(text);
  const nowYear = today.getFullYear();
  const todayMid = new Date(today); todayMid.setHours(0,0,0,0);

  // 0) 상설
  if (PERMANENT_RE.test(t)) {
    return { start: null, end: null, raw: '상설', permanent: true, grade: 'PERM', score: 10 };
  }

  const candidates = [];

  // === 패턴 탐색 ===
  const patterns = [
    {
      grade: 'A',
      regex: /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\s*[~\-–—∼]\s*(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/g,
      build: (m) => makePeriod(
        makeDate(m[1], m[2], m[3]),
        makeDate(m[4], m[5], m[6]),
        m[0],
        false,
        false,
        'A'
      )
    },
    {
      grade: 'A',
      regex: /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*[~\-–—∼]\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/g,
      build: (m) => makePeriod(
        makeDate(m[1], m[2], m[3]),
        makeDate(m[4], m[5], m[6]),
        m[0],
        false,
        false,
        'A'
      )
    },
    {
      grade: 'B', // YYYY.MM.DD ~ MM.DD
      regex: /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\s*[~\-–—∼]\s*(\d{1,2})[.\-\/](\d{1,2})/g,
      build: (m) => {
        const sy = parseInt(m[1]);
        const sm = parseInt(m[2]);
        const sd = parseInt(m[3]);
        const em = parseInt(m[4]);
        const ed = parseInt(m[5]);
        let ey = sy;
        if (em < sm || (em === sm && ed < sd)) ey += 1;
        return makePeriod(
          makeDate(sy, sm, sd),
          makeDate(ey, em, ed),
          m[0],
          false,
          false,
          'B'
        );
      }
    },
    {
      grade: 'C', // M월 D일 ~ M월 D일 (연도 없음)
      regex: /(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*[~\-–—∼]\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/g,
      build: (m) => {
        const sm = parseInt(m[1]); const sd = parseInt(m[2]);
        const em = parseInt(m[3]); const ed = parseInt(m[4]);
        let sy = nowYear; let ey = nowYear;
        if (em < sm || (em === sm && ed < sd)) ey += 1;
        return makePeriod(
          makeDate(sy, sm, sd),
          makeDate(ey, em, ed),
          m[0],
          true,
          false,
          'C'
        );
      }
    },
    {
      grade: 'C', // MM/DD ~ MM/DD
      regex: /(\d{1,2})[.\-\/](\d{1,2})\s*[~\-–—∼]\s*(\d{1,2})[.\-\/](\d{1,2})/g,
      build: (m) => {
        const sm = parseInt(m[1]); const sd = parseInt(m[2]);
        const em = parseInt(m[3]); const ed = parseInt(m[4]);
        let sy = nowYear; let ey = nowYear;
        if (em < sm || (em === sm && ed < sd)) ey += 1;
        return makePeriod(
          makeDate(sy, sm, sd),
          makeDate(ey, em, ed),
          m[0],
          true,
          false,
          'C'
        );
      }
    },
    {
      grade: 'B', // YYYY.MM.DD까지
      regex: /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\s*까지/g,
      build: (m) => makePeriod(
        null,
        makeDate(m[1], m[2], m[3]),
        m[0],
        true,
        false,
        'B'
      )
    },
    {
      grade: 'C', // MM.DD까지 (연도 추정)
      regex: /(\d{1,2})[.\-\/](\d{1,2})\s*까지/g,
      build: (m) => {
        let ey = nowYear;
        let end = makeDate(ey, m[1], m[2]);
        if (end && end < todayMid) {
          ey += 1; end = makeDate(ey, m[1], m[2]);
        }
        return makePeriod(null, end, m[0], true, false, 'C');
      }
    },
    {
      grade: 'B', // YYYY.MM.DD ~ MM.DD까지 (마지막에 '까지' 포함)
      regex: /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\s*[~\-–—∼]\s*(\d{1,2})[.\-\/](\d{1,2})\s*까지/g,
      build: (m) => {
        const sy = parseInt(m[1]);
        const sm = parseInt(m[2]);
        const sd = parseInt(m[3]);
        const em = parseInt(m[4]);
        const ed = parseInt(m[5]);
        let ey = sy;
        if (em < sm || (em === sm && ed < sd)) ey += 1;
        return makePeriod(
          makeDate(sy, sm, sd),
          makeDate(ey, em, ed),
          m[0],
          false,
          false,
          'B'
        );
      }
    }
  ];

  for (const p of patterns) {
    let m;
    while ((m = p.regex.exec(t)) !== null) {
      const period = p.build(m);
      if (!period || !period.start && !period.end) continue;

      // 문맥 점수
      const ctxStart = Math.max(0, m.index - 30);
      const ctxEnd = Math.min(t.length, m.index + (m[0]?.length || 0) + 30);
      const ctx = t.slice(ctxStart, ctxEnd);

      let score = GRADE_SCORE[p.grade] || 0;
      if (PERIOD_POSITIVE.test(ctx)) score += 4;
      if (PERIOD_NEGATIVE.test(ctx)) score -= 6;
      if (VISIT_CONTEXT_RE.test(ctx)) score -= 8; // 후기/방문 맥락은 강하게 감점
      if (WEEKDAY_RE.test(ctx)) score -= 3;
      if (YYMMDD_RE.test(m[0])) score -= 6;

      // 강제 탈락
      if (score <= -3) continue;

      period.score = score;
      candidates.push(period);
    }
  }

  if (candidates.length === 0) return null;

  // 최고 점수 선택 (동점이면 종료일이 더 늦은 것 > 기간 길이 긴 것 > 시작이 빠른 것)
  candidates.sort((a, b) => {
    const s = (b.score || 0) - (a.score || 0);
    if (s !== 0) return s;
    const aEnd = a.end ? a.end.getTime() : 0;
    const bEnd = b.end ? b.end.getTime() : 0;
    if (aEnd !== bEnd) return bEnd - aEnd;
    const aLen = (a.start && a.end) ? (a.end - a.start) : 0;
    const bLen = (b.start && b.end) ? (b.end - b.start) : 0;
    if (aLen !== bLen) return bLen - aLen;
    const aStart = a.start ? a.start.getTime() : 0;
    const bStart = b.start ? b.start.getTime() : 0;
    return aStart - bStart;
  });

  const best = candidates[0];

  // 안전창: 너무 과거(오늘-7일 이전 종료)나 너무 먼 미래(오늘+365 이후 시작)는 무효
  const end = best.end;
  const start = best.start;
  const todayMinus7 = new Date(todayMid); todayMinus7.setDate(todayMinus7.getDate() - 7);
  const todayPlus365 = new Date(todayMid); todayPlus365.setDate(todayPlus365.getDate() + 365);
  const minEnd = new Date(todayMid); minEnd.setDate(minEnd.getDate() + END_GRACE_DAYS);

  if (end && end < todayMinus7) return null;
  // 종료일이 오늘(또는 유예 이전)이면 제외
  if (end && end < minEnd) return null;
  if (start && start > todayPlus365) return null;

  // 문자열로 반환 (기존 사용처 호환)
  return {
    start: start ? start.toISOString().slice(0, 10) : null,
    end: end ? end.toISOString().slice(0, 10) : null,
    raw: best.raw,
    partial: best.partial,
    permanent: best.permanent,
    grade: best.grade,
    score: best.score
  };
}

/**
 * 현재 진행중인지 확인
 */
export function isOngoing(period, now = new Date()) {
  if (!period || !period.start || !period.end) return null;
  return now >= new Date(period.start) && now <= new Date(period.end);
}

/**
 * 기간 상태 반환
 */
export function getPeriodStatus(period, now = new Date()) {
  if (!period) return 'unknown';
  if (!period.start && period.end) return now <= new Date(period.end) ? 'ongoing' : 'ended';
  if (!period.start || !period.end) return 'unknown';
  if (now < new Date(period.start)) return 'upcoming';
  if (now > new Date(period.end)) return 'ended';
  return 'ongoing';
}

/**
 * 텍스트에서 가격 추출
 */
export function extractPrice(text) {
  if (!text) return null;
  const t = String(text);

  // 무료 체크
  if (/무료(전시|입장)?|입장\s*무료|관람료\s*:\s*무료|무료\s*\(예약|free/i.test(t)) {
    return { adult: 0, free: true };
  }

  // 가격 패턴
  const pricePatterns = [
    /(?:성인|일반|관람료)[:\s]*([\d,]+)\s*원/,
    /([\d,]+)\s*원/,
    /(\d+)만\s*원/
  ];

  for (const pattern of pricePatterns) {
    const match = t.match(pattern);
    if (match) {
      let price;
      if (match[0].includes('만')) {
        price = parseInt(match[1]) * 10000;
      } else {
        price = parseInt(match[1].replace(/,/g, ''));
      }
      return { adult: price, free: price === 0 };
    }
  }

  return null;
}

/**
 * 쇼핑 결과에서 전시명 추출
 */
export function extractExhibitionTitle(shopTitle, venueName) {
  const cleaned = String(shopTitle || '').replace(/<[^>]*>/g, '').trim();

  // [전시장명] 전시명 패턴
  const bracketPattern = new RegExp(`\\[${venueName}[^\\]]*\\]\\s*(.+)`, 'i');
  const bracketMatch = cleaned.match(bracketPattern);
  if (bracketMatch) {
    let title = bracketMatch[1].trim();
    title = title.replace(/^\[[^\]]*\]\s*/, '');
    return title;
  }

  // 전시장명 뒤의 내용
  if (cleaned.includes(venueName)) {
    const parts = cleaned.split(venueName);
    if (parts[1]) {
      let title = parts[1].trim();
      title = title.replace(/^[\s\-:]+/, '');
      return title;
    }
  }

  return cleaned;
}

/**
 * 굿즈/상품인지 확인
 */
export function isGoods(title) {
  const GOODS_KEYWORDS = [
    '굿즈', '포스터', '엽서', '도록', '책', '티셔츠', '에코백', '머그컵',
    '액자', '인테리어', '조명', '쇼케이스', '차단봉', '조각상', '로프', '벨트',
    '마그넷', '스티커', '미러', '마우스패드', '카드지갑', '뱃지', '키링',
    '민화', 'DIY', '도안', '물감', '페인팅', '컬러링',
    '판화', '프린트', '아크릴피규어', 'L홀더', '장패드', '북클립', '연필', '볼펜', '우산',
    '후드티', '목걸이', '케이스',
    '식물', '화분', '몬스테라', '필로덴드론', '고사리', '이끼', '비바리움', '테라리움',
    '플랜테리어', '공기정화', '양치', '베고니아', '안스리움', '싱고니움', '브로멜리아',
    '렌탈', '대여', '임대', '파레트', '부스', '펜스', '테이블', '의자', '게이트',
    '화환', '꽃배달', '축하화환',
    '컵', '볼', '양식기', '커틀러리', '포크', '나이프', '스푼',
    '화판장', '화판', '이젤'
  ];

  const t = String(title || '').toLowerCase();
  return GOODS_KEYWORDS.some(k => t.includes(k.toLowerCase()));
}

/**
 * 노이즈 텍스트인지 확인
 */
export function isNoisy(text) {
  const NOISY_PATTERNS = [
    /도쿄|라스베이거스|브뤼헤|히스토리움|후지산|산토리/i,
    /추천|가볼만한곳|핫플|맛집|카페/i,
    /호텔|숙박|캠핑|풀장|물놀이|리조트/i,
    /당일\s*투어|일일\s*투어|버스\s*투어|원데이|1박2일|기차여행/i,
    /출렁다리|양떼목장|정동진|알파카|루지/i,
    /\[렌탈|대여\]|렌탈\/대여/i,
    /셀프투어|셀프 투어/i,
    /쿠팡\s*트래블/i,
    /^\)\s/,
    /^#[^\s]+(\s+#[^\s]+)*$/,
    /^(후기|관람|정보|방문|예약|예매|방법|할인|무료|입장료|관람료|티켓|안내|소개)$/i,
    /\.{2,}$/,
    /^\d+[.\/\-]/,
  ];

  const t = String(text || '');
  return NOISY_PATTERNS.some(p => p.test(t));
}

/**
 * 유효한 전시명인지 확인
 */
export function isValidExhibitionTitle(title) {
  const t = String(title || '').trim();

  if (t.length < 4 || t.length > 60) return false;
  if (isGoods(t) || isNoisy(t)) return false;

  const specialCount = (t.match(/[^가-힣a-zA-Z0-9\s]/g) || []).length;
  if (specialCount > 0 && specialCount / Math.max(t.length, 1) > 0.35) return false;

  const REGION_ONLY = ['용산', '한남동', '강남', '홍대', '서촌', '성수', '제주', '여수', '부산', '대구', '광주', '원주', '용인', '경주', '청주'];
  if (REGION_ONLY.includes(t)) return false;
  if (/(travel|package|course|투어|여행)/i.test(t)) return false;
  if (/^[^가-힣a-zA-Z0-9]+$/.test(t)) return false;

  const GENERIC_WORDS = ['전시', '관람', '후기', '정보', '안내', '예약', '예매', '방문', '입장권', '티켓'];
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 2 && words.every(w => GENERIC_WORDS.some(g => w.includes(g)))) {
    return false;
  }

  return true;
}

/**
 * 블로그 텍스트에서 반복되는 전시명 추출
 */
export function extractRepeatedTitle(texts) {
  const titleCounts = new Map();

  for (const text of texts) {
    const quoted = text.match(/[<>《》「」『』""'']([^<>《》「」『』""'']{3,30})[<>《》「」『』""'']/g) || [];
    for (const q of quoted) {
      const title = q.replace(/^[<>《》「」『』""'']|[<>《》「」『』""'']$/g, '');
      titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    }

    const afterColon = text.match(/전시(?:명)?[:\s]+([^,.\\n]{3,30})/g) || [];
    for (const ac of afterColon) {
      const title = ac.replace(/^전시(?:명)?[:\s]+/, '').trim();
      titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    }
  }

  let maxCount = 0;
  let maxTitle = null;
  for (const [title, count] of titleCounts) {
    if (count >= 2 && count > maxCount && !isGoods(title) && !isNoisy(title)) {
      maxCount = count;
      maxTitle = title;
    }
  }

  return maxTitle;
}
