/**
 * Venue normalization (private venues)
 */


const GS = '그라운드시소';
const GS_SEOCHON = '그라운드시소 서촌';
const GS_SEONGSU = '그라운드시소 성수';
const GS_CENTRAL = '그라운드시소 센트럴';
const GS_HANNAM = '그라운드시소 한남';
const GS_MYUNDONG = '그라운드시소 이동';

const ART_SONJE = '아트선재센터';
const DAELIM = '대림미술관';
const LEEUM = '리움미술관';
const APMA = '아모레퍼시픽미술관';
const PIKNIC = '피크닉 (piknic)';
const SONGEUN = '송은 (SONGEUN)';
const MUSEUM_SAN = '뮤지엄산 (원주)';
const BONTE = '본태박물관 (제주)';
const JMOA = '제주도립미술관';
const NJP = '백남준아트센터 (용인)';
const LEENAM = '이이남 스튜디오';

const GS_BRANCH_RE = new RegExp(`${GS}\\s*(서촌|센트럴|한남|이동|성수|EAST|이스트)`, 'i');

export const PRIVATE_VENUES = {
  [GS]: {
    type: 'private',
    searchKeys: [`${GS} 전시`, `${GS} 티켓`],
    branches: ['서촌', '센트럴', '한남', '이동', '성수', 'EAST', '이스트'],
    branchPattern: GS_BRANCH_RE,
    aliases: ['Groundseesaw', GS]
  },
  [GS_SEOCHON]: { type: 'private', parent: GS, searchKeys: [`${GS_SEOCHON} 전시`], aliases: [GS_SEOCHON] },
  [GS_CENTRAL]: { type: 'private', parent: GS, searchKeys: [`${GS_CENTRAL} 전시`], aliases: [GS_CENTRAL] },
  [GS_HANNAM]: { type: 'private', parent: GS, searchKeys: [`${GS_HANNAM} 전시`], aliases: [GS_HANNAM] },
  [GS_MYUNDONG]: { type: 'private', parent: GS, searchKeys: [`${GS_MYUNDONG} 전시`], aliases: [GS_MYUNDONG, `${GS} 센트럴`] },
  [GS_SEONGSU]: {
    type: 'private',
    parent: GS,
    searchKeys: [`${GS_SEONGSU} 전시`, `${GS} EAST 전시`],
    aliases: [GS_SEONGSU, `${GS} EAST`, `${GS} 이스트`, 'Groundseesaw EAST']
  },
  [ART_SONJE]: { type: 'private', searchKeys: [`${ART_SONJE} 전시`], aliases: ['아트선재', 'Art Sonje'], useBlogSearch: true },
  [DAELIM]: { type: 'private', searchKeys: [`${DAELIM} 전시`], aliases: ['대림'], useBlogSearch: true },
  [LEEUM]: { type: 'private', searchKeys: [`${LEEUM} 전시`], aliases: ['리움', 'Leeum'], useBlogSearch: true },
  [APMA]: { type: 'private', searchKeys: [`${APMA} 전시`], aliases: ['아모레퍼시픽', 'APMA'], useBlogSearch: true },
  [PIKNIC]: { type: 'private', searchKeys: [`${PIKNIC} 전시`, 'piknic 전시'], aliases: ['피크닉', 'piknic', 'PIKNIC'], useBlogSearch: true },
  [SONGEUN]: { type: 'private', searchKeys: [`${SONGEUN} 전시`, 'SONGEUN 전시'], aliases: ['송은', 'SONGEUN', '송은문화재단'], useBlogSearch: true },
  [MUSEUM_SAN]: { type: 'private', searchKeys: [`${MUSEUM_SAN} 전시`, '뮤지엄산 전시', 'Museum SAN 전시'], aliases: ['뮤지엄산', 'Museum SAN'], useBlogSearch: true },
  [BONTE]: { type: 'private', searchKeys: [`${BONTE} 전시`, '본태박물관 전시'], aliases: ['본태박물관', '본태'], useBlogSearch: true },
  [JMOA]: { type: 'private', searchKeys: [`${JMOA} 전시`], aliases: ['제주도립', '제주도립미술관'], useBlogSearch: true },
  [NJP]: { type: 'private', searchKeys: [`${NJP} 전시`, '백남준아트센터 전시'], aliases: ['백남준아트센터', '백남준', 'NJP'], useBlogSearch: true },
  [LEENAM]: { type: 'exclude', skipSearch: true, searchKeys: [], aliases: ['이이남', '이이남 스튜디오'] }
};
function normalizeGroundseesawBranch(branch) {
  const b = String(branch || '').trim();
  if (!b) return '';
  if (/^EAST$/i.test(b) || b === '이스트') return '성수';
  return b;
}

export function normalizeVenueName(name) {
  const cleaned = String(name || '').trim();

  for (const [officialName, info] of Object.entries(PRIVATE_VENUES)) {
    if (cleaned === officialName) return officialName;
    if (info.aliases?.some(alias => cleaned.toLowerCase() === String(alias).toLowerCase())) return officialName;
    if (info.branchPattern) {
      const match = cleaned.match(info.branchPattern);
      if (match) {
        const branch = normalizeGroundseesawBranch(match[1]);
        return `${GS} ${branch}`;
      }
    }
  }
  return cleaned;
}

export function extractVenueFromText(text) {
  const t = String(text || '');
  const gs = t.match(GS_BRANCH_RE);
  if (gs) return `${GS} ${normalizeGroundseesawBranch(gs[1])}`;

  for (const [name, info] of Object.entries(PRIVATE_VENUES)) {
    if (t.includes(name)) return name;
    if (info.aliases?.some(alias => t.includes(alias))) return name;
  }
  return null;
}

export function getPrivateVenueSearchList() {
  const list = [];
  for (const [name, info] of Object.entries(PRIVATE_VENUES)) {
    if (info.skipSearch) continue;
    if (info.type === 'private' && !info.parent) {
      list.push({
        name,
        searchKeys: info.searchKeys || [name],
        branches: info.branches || null,
        useBlogSearch: info.useBlogSearch || false
      });
    }
  }
  return list;
}

export function isPrivateVenue(name) {
  const normalized = normalizeVenueName(name);
  return PRIVATE_VENUES[normalized]?.type === 'private';
}
