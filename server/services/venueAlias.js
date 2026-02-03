function normalizeAliasKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()]/g, '')
    .replace(/[-_.]/g, '');
}

// 층수/홀명/관명/전시실 등을 제거하는 정규화 규칙
const VENUE_SUFFIX_PATTERNS = [
  // 층수 패턴: "1층", "2층", "B1층", "지하1층" 등
  /\s*(?:지하)?\s*[B]?\d+\s*층\s*/gi,
  // 홀/관 패턴: "A홀", "B홀", "그랜드홀", "대공연장", "소공연장" 등
  /\s*[A-Za-z]?\s*홀\s*/gi,
  /\s*(?:대|중|소)?\s*(?:공연장|전시장|전시실|강당|세미나실)\s*/gi,
  // 교육실 패턴: "1~4교육실", "교육실" 등
  /\s*\d*~?\d*\s*교육실\s*/gi,
  // 특정 시설명 패턴
  /\s*(?:본관|별관|신관|구관)\s*/gi,
  /\s*(?:기획전시실|상설전시실|상설전시관|특별전시실)\s*\d*\s*/gi,
  // 관 패턴 (미술관, 박물관은 유지)
  /\s*(?:제?\d+)?(?:전시)?관(?!\s*$|박물관|미술관)/gi
];

// 복합 표기에서 선택적으로 사용하는 패턴
const COMPOUND_VENUE_MAPPINGS = [
  // DDP 관련
  { pattern: /ddp\s*동대문\s*디자인\s*플라자/i, canonical: '동대문디자인플라자' },
  { pattern: /동대문\s*디자인\s*플라자\s*\(?ddp\)?/i, canonical: '동대문디자인플라자' },
  // 세종문화회관 관련
  { pattern: /세종문화회관\s*(?:미술관|세종m씨어터|대극장|소극장)/i, canonical: '세종문화회관' },
  { pattern: /세종\s*대극장/i, canonical: '세종문화회관' },
  // 코엑스 관련
  { pattern: /코엑스\s*[A-D]?홀/i, canonical: '코엑스' },
  { pattern: /코엑스\s*(?:컨벤션센터|아쿠아리움|몰)/i, canonical: '코엑스' },
  // KCF 관련 (한국문화진흥원 등)
  { pattern: /kcf\s*\d+층?/i, canonical: 'KCF' },
  // 대구콘서트하우스 관련
  { pattern: /대구콘서트하우스\s*(?:그랜드홀|대공연장|소공연장)/i, canonical: '대구콘서트하우스' },
  // 서울시립과학관 관련
  { pattern: /서울시립과학관\s*\d*~?\d*교육실/i, canonical: '서울시립과학관' },
  // 경기 관련
  { pattern: /경기도\s*,?\s*경기문화재단\s*,?\s*경기도박물관/i, canonical: '경기도박물관' },
  { pattern: /경기문화재단\s*,?\s*경기도\s*,?\s*양평군립미술관/i, canonical: '양평군립미술관' },
  { pattern: /경기문화재단\s*,?\s*경기도\s*,?\s*남한산성역사문화관/i, canonical: '남한산성역사문화관' },
  { pattern: /남한산성역사문화관/i, canonical: '남한산성역사문화관' },
  // 국립중앙박물관 관련
  { pattern: /국립중앙박물관\s*(?:기획전시실|상설전시관|특별전시실)/i, canonical: '국립중앙박물관' }
];

// 지역을 명시해야 하는 분관 체계 미술관
const BRANCH_VENUE_PATTERNS = [
  // 국립현대미술관
  {
    base: '국립현대미술관',
    branches: [
      { pattern: /서울|삼청동/i, name: '국립현대미술관 (서울)' },
      { pattern: /과천/i, name: '국립현대미술관 (과천)' },
      { pattern: /덕수궁/i, name: '국립현대미술관 (덕수궁)' },
      { pattern: /청주/i, name: '국립현대미술관 (청주)' }
    ]
  },
  // 서울시립미술관
  {
    base: '서울시립미술관',
    branches: [
      { pattern: /본관|서소문|덕수궁길/i, name: '서울시립미술관' },
      { pattern: /북서울|노원/i, name: '서울시립 북서울미술관' },
      { pattern: /남서울|사당|관악/i, name: '서울시립 남서울미술관' },
      { pattern: /미술아카이브|평창동/i, name: '서울시립 미술아카이브' },
      { pattern: /벙커|여의도/i, name: 'SeMA 벙커' },
      { pattern: /창고|은평|혁신파크/i, name: 'SeMA 창고' }
    ]
  },
  // 국립아시아문화전당
  {
    base: '국립아시아문화전당',
    branches: [
      { pattern: /문화창조원/i, name: '국립아시아문화전당' },
      { pattern: /어린이문화원/i, name: '국립아시아문화전당' },
      { pattern: /아시아문화박물관/i, name: '국립아시아문화전당' },
      { pattern: /라이브러리파크/i, name: '국립아시아문화전당' },
      { pattern: /미디어큐브/i, name: '국립아시아문화전당' },
      { pattern: /홍보관/i, name: '국립아시아문화전당' }
    ]
  }
];

/**
 * 전시장명 정규화 함수 - 층수, 홀명, 관명 등을 제거하고 표준 명칭으로 변환
 * @param {string} rawName - 원본 전시장명
 * @returns {string} - 정규화된 전시장명
 */
export function normalizeVenueNameAdvanced(rawName) {
  if (!rawName) return '';
  let name = String(rawName).trim();

  // 1. 복합 표기 매핑 처리
  for (const mapping of COMPOUND_VENUE_MAPPINGS) {
    if (mapping.pattern.test(name)) {
      return mapping.canonical;
    }
  }

  // 2. 분관 체계 처리 (MMCA, SeMA, ACC 등)
  for (const branchVenue of BRANCH_VENUE_PATTERNS) {
    const basePattern = new RegExp(branchVenue.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const baseAltPatterns = [
      /mmca/i,
      /sema/i,
      /acc/i,
      /국립현대미술관/i,
      /서울시립미술관/i,
      /국립아시아문화전당/i,
      /아시아문화전당/i
    ];

    const matchesBase = basePattern.test(name) ||
      (branchVenue.base === '국립현대미술관' && /mmca/i.test(name)) ||
      (branchVenue.base === '서울시립미술관' && /sema/i.test(name)) ||
      (branchVenue.base === '국립아시아문화전당' && (/acc/i.test(name) || /아시아\s*문화\s*전당/i.test(name)));

    if (matchesBase) {
      for (const branch of branchVenue.branches) {
        if (branch.pattern.test(name)) {
          return branch.name;
        }
      }
      // 분관 정보가 없으면 기본 명칭 반환
      if (branchVenue.base === '국립현대미술관') return '국립현대미술관 (서울)';
      if (branchVenue.base === '서울시립미술관') return '서울시립미술관';
      if (branchVenue.base === '국립아시아문화전당') return '국립아시아문화전당';
    }
  }

  // 3. 괄호 내용 처리 (위치 정보는 유지, 부가 정보는 제거)
  // 예: "대구콘서트하우스 (대공연장)" → "대구콘서트하우스"
  // 예: "국립현대미술관 (서울)" → 유지
  const locationKeywords = ['서울', '과천', '덕수궁', '청주', '광주', '부산', '대구', '대전', '인천', '울산', '경기', '제주', '원주', '용인'];
  const parenMatch = name.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const parenContent = parenMatch[1];
    const isLocation = locationKeywords.some(loc => parenContent.includes(loc));
    if (!isLocation) {
      name = name.replace(/\s*\([^)]+\)\s*/g, ' ').trim();
    }
  }

  // 4. 접미사 패턴 제거
  for (const pattern of VENUE_SUFFIX_PATTERNS) {
    name = name.replace(pattern, ' ');
  }

  // 5. 정리
  name = name.replace(/\s+/g, ' ').trim();

  return name || rawName;
}

export const aliasEntries = [
  {
    name: '국립아시아문화전당',
    variants: [
      'acc',
      'ACC',
      '국립아시아문화전당',
      '국립 아시아 문화 전당',
      '아시아문화전당',
      '아시아 문화 전당',
      '아시아문화전당acc',
      '아시아문화전당 acc',
      '아시아문화전당(ACC)',
      '아시아문화전당 (ACC)',
      '(ACC) 아시아문화전당',
      'ACC 아시아문화전당',
      'ACC국립아시아문화전당',
      '국립아시아문화전당acc',
      '국립아시아문화전당 acc',
      '국립아시아문화전당ACC',
      '국립아시아문화전당 ACC',
      '국립아시아문화전당(ACC)',
      '국립아시아문화전당 (ACC)',
      '(ACC)국립아시아문화전당',
      '(ACC) 국립아시아문화전당',
      'ACC 국립아시아문화전당',
      '국립아시아문화전당 (광주)',
      '국립아시아문화전당 광주',
      '국립아시아문화전당홍보관',
      '국립아시아문화전당 홍보관',
      '국립아시아문화전당 미디어큐브',
      '국립아시아문화전당 문화창조원',
      '국립아시아문화전당 어린이문화원',
      '국립아시아문화전당 라이브러리파크',
      '문화창조원',
      '아시아문화박물관'
    ]
  },
  {
    name: '동대문디자인플라자',
    variants: [
      'ddp',
      '동대문디자인플라자',
      '동대문 디자인 플라자',
      '동대문디자인플라자(DDP)',
      '동대문디자인플라자DDP',
      '동대문디자인플라자 ddp',
      '동대문디자인플라자 DDP',
      '동대문디자인플라자 디자인랩'
    ]
  },
  {
    name: '서울시립미술관',
    variants: [
      'sema',
      'seoul museum of art',
      'seoulmuseumofart',
      '서울시립미술관',
      '서울시립미술관 본관',
      '서울시립미술관(본관)'
    ]
  },
  {
    name: '예술의전당',
    variants: [
      '예술의전당',
      '예술의 전당',
      '예술의전당(한가람미술관)',
      '예술의전당 한가람미술관',
      '예술의전당sac',
      '예술의전당 sac',
      '예술의전당(SAC)',
      'sac'
    ]
  },
  {
    name: 'K-Arts Space',
    variants: [
      'K-Arts Space',
      'K-Arts space',
      'K-arts Space',
      'K-arts space',
      'K Arts Space',
      'Karts space',
      'K-Arts Space (Korea National University of Arts)',
      '한국예술종합학교 K-Arts Space',
      '한국예술종합학교K-ArtsSpace',
      '한국예술종합학교 K-Arts Space'
    ]
  },
  {
    name: '피크닉 (piknic)',
    variants: [
      '피크닉',
      '피크닉 (piknic)',
      'piknic'
    ]
  },
  {
    name: '송은 (SONGEUN)',
    variants: [
      '송은',
      '송은 (SONGEUN)',
      'songeun'
    ]
  },
  {
    name: '뮤지엄 산 (원주)',
    variants: [
      '뮤지엄 산',
      '뮤지엄 산 (원주)',
      'museum san'
    ]
  },
  {
    name: '본태박물관 (제주)',
    variants: [
      '본태박물관',
      '본태박물관 (제주)',
      '본태 박물관'
    ]
  },
  {
    name: '백남준아트센터 (용인)',
    variants: [
      '백남준아트센터',
      '백남준아트센터 (용인)'
    ]
  },
  {
    name: '그라운드시소 서촌',
    variants: [
      '그라운드시소 서촌',
      '그라운드시소 서촌점',
      '그라운드시소 서촌 지점'
    ]
  },
  {
    name: '그라운드시소 성수',
    variants: [
      '그라운드시소 성수',
      '그라운드시소 성수점',
      '그라운드시소 성수 지점'
    ]
  },
  {
    name: '그라운드시소 센트럴',
    variants: [
      '그라운드시소 센트럴',
      '그라운드시소 센트럴점',
      '그라운드시소 센트럴 지점'
    ]
  },
  {
    name: '경기도박물관',
    variants: [
      '경기도박물관',
      '경기도박물관 (용인)',
      '경기도박물관 용인'
    ]
  },
  {
    name: '국립현대미술관 (서울)',
    variants: [
      '국립현대미술관',
      '국립현대미술관 서울',
      '국립현대미술관(서울)',
      'mmca',
      'mmca seoul',
      'mmcaseoul',
      'mmca서울'
    ]
  },
  {
    name: '국립현대미술관 (과천)',
    variants: [
      '국립현대미술관 과천',
      '국립현대미술관(과천)',
      'mmca 과천',
      'mmcagwacheon',
      'mmca gwacheon'
    ]
  },
  {
    name: '국립현대미술관 (덕수궁)',
    variants: [
      '국립현대미술관 덕수궁',
      '국립현대미술관(덕수궁)',
      'mmca 덕수궁',
      'mmcadeoksugung',
      'mmca deoksugung'
    ]
  },
  {
    name: '국립현대미술관 (청주)',
    variants: [
      '국립현대미술관 청주',
      '국립현대미술관(청주)',
      'mmca 청주',
      'mmcacheongju',
      'mmca cheongju'
    ]
  },
  {
    name: '코엑스',
    variants: [
      '코엑스',
      'coex',
      '코엑스 A홀',
      '코엑스 B홀',
      '코엑스 C홀',
      '코엑스 D홀',
      '코엑스A홀',
      '코엑스B홀',
      '코엑스C홀',
      '코엑스D홀',
      '코엑스 컨벤션센터',
      '코엑스컨벤션센터',
      '코엑스 전시장'
    ]
  },
  {
    name: '세종문화회관',
    variants: [
      '세종문화회관',
      '세종문화회관 미술관',
      '세종문화회관미술관',
      '세종문화회관 세종m씨어터',
      '세종문화회관 대극장',
      '세종문화회관 소극장',
      '세종대극장',
      '세종 대극장',
      '세종소극장',
      '세종M씨어터'
    ]
  },
  {
    name: 'KCF',
    variants: [
      'kcf',
      'KCF',
      'kcf 1층',
      'kcf 2층',
      'kcf 3층',
      'kcf1층',
      'kcf2층',
      'kcf3층',
      'KCF 1층',
      'KCF 2층',
      'KCF 3층'
    ]
  },
  {
    name: '대구콘서트하우스',
    variants: [
      '대구콘서트하우스',
      '대구 콘서트 하우스',
      '대구콘서트하우스 그랜드홀',
      '대구콘서트하우스 대공연장',
      '대구콘서트하우스 소공연장',
      '대구콘서트하우스(대공연장)',
      '대구콘서트하우스(그랜드홀)'
    ]
  },
  {
    name: '국립대구박물관',
    variants: [
      '국립대구박물관',
      '국립대구박물관 강당',
      '국립대구박물관강당',
      '국립대구박물관 전시실',
      '대구국립박물관'
    ]
  },
  {
    name: '국립중앙박물관',
    variants: [
      '국립중앙박물관',
      '국립중앙박물관 기획전시실',
      '국립중앙박물관 상설전시관',
      '국립중앙박물관 특별전시실',
      '국립중앙박물관 어린이박물관',
      '중앙박물관'
    ]
  },
  {
    name: '서울시립과학관',
    variants: [
      '서울시립과학관',
      '서울시립과학관 1교육실',
      '서울시립과학관 2교육실',
      '서울시립과학관 3교육실',
      '서울시립과학관 4교육실',
      '서울시립과학관 1~4교육실',
      '서울시립과학관교육실'
    ]
  },
  {
    name: '경기도박물관',
    variants: [
      '경기도박물관',
      '경기도 박물관',
      '경기도박물관 (용인)',
      '경기도박물관 용인',
      '경기문화재단 경기도박물관'
    ]
  },
  {
    name: '양평군립미술관',
    variants: [
      '양평군립미술관',
      '양평 군립 미술관',
      '경기문화재단 양평군립미술관'
    ]
  },
  {
    name: '국립현대미술관 (서울)',
    variants: [
      '국립현대미술관',
      '국립현대미술관서울',
      'MMCA',
      'mmca'
    ]
  }
];

const aliasMap = new Map();
for (const entry of aliasEntries) {
  for (const variant of entry.variants) {
    aliasMap.set(normalizeAliasKey(variant), entry.name);
  }
}

function matchMmcaBranch(rawKey) {
  if (!rawKey.includes('국립현대미술관') && !rawKey.includes('mmca')) {
    return null;
  }
  if (rawKey.includes('서울')) return '국립현대미술관 (서울)';
  if (rawKey.includes('과천')) return '국립현대미술관 (과천)';
  if (rawKey.includes('덕수궁')) return '국립현대미술관 (덕수궁)';
  if (rawKey.includes('청주')) return '국립현대미술관 (청주)';
  return null;
}

export function applyVenueAlias(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';

  // 1. 먼저 고급 정규화 적용
  const advanced = normalizeVenueNameAdvanced(raw);

  // 2. alias 맵에서 직접 매칭 확인
  const key = normalizeAliasKey(advanced);
  const direct = aliasMap.get(key);
  if (direct) return direct;

  // 3. 원본으로도 alias 매칭 시도
  const rawKey = normalizeAliasKey(raw);
  const rawDirect = aliasMap.get(rawKey);
  if (rawDirect) return rawDirect;

  // 4. MMCA 분관 처리
  const mmca = matchMmcaBranch(key);
  if (mmca) return mmca;

  const mmcaRaw = matchMmcaBranch(rawKey);
  if (mmcaRaw) return mmcaRaw;

  // 5. 정규화된 결과 반환
  return advanced;
}

export function normalizeVenueName(name) {
  if (!name) return '';
  return String(name).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}
