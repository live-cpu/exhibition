/**
 * Gemini 기반 전시명 정규화 (REST API 방식)
 * - 기존 geminiSearch.js와 동일한 REST API 사용
 * - 쿼리 크기 최적화
 */
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_NORMALIZE_MODEL || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_ENABLED = String(process.env.GEMINI_ENABLED ?? 'false').toLowerCase() === 'true';
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_NORMALIZE_TIMEOUT || 30000);

// Rate limiting / 배치 크기
const GEMINI_MAX_CALLS_PER_RUN = Number(process.env.GEMINI_NORMALIZE_MAX_CALLS || 30);
const GEMINI_BATCH_SIZE = Number(process.env.GEMINI_NORMALIZE_BATCH_SIZE || 12);
let normalizeCallsUsed = 0;

// Evidence hash cache (in-memory)
const evidenceCache = new Map();

// 최소화된 프롬프트 (배치: venue+title만)
function buildBatchPrompt(batch) {
  const lines = batch.map((c, i) => {
    const parts = [
      `v=${c.venue}`,
      `t=${c.title}`,
      c.count > 1 ? `x${c.count}` : null,
      c.period ? `p=${c.period}` : null
    ].filter(Boolean).join(' | ');
    return `${i + 1}. ${parts}`;
  }).join('\n');

  return `여러 사설 전시관의 전시 제목을 정규화해줘.
입력: 번호별로 venue와 title만 제공됨.

규칙:
1) 같은 전시 변형은 한 canonicalTitle로 묶고 titleKey(소문자, 공백 제거)를 만들어.
2) 후기/데이트/맛집/추천/여행/블로그형 제목은 rejects에 넣어.
3) venue를 유지해서 결과에 venue를 포함시켜.
4) 날짜 정보가 없으면 startDate/endDate는 null, isPermanent는 false로 둬.

JSON 출력:
{
 "exhibitions":[
   {
     "venue":"그라운드시소 성수",
     "canonicalTitle":"룸 포 원더",
     "titleKey":"룸포원더",
     "aliases":["룸 포 원더 전시"],
     "startDate":null,
     "endDate":null,
     "isPermanent":false,
     "confidence":0.9
   }
 ],
 "rejects":[{"venue":"...","raw":"제목","reason":"blog/noise"}]
}`;
}

// 후보를 압축 형식으로 변환 (배치 입력용)
function compressBatchCandidates(batch) {
  return batch.map((c, i) => {
    const parts = [c.title];
    if (c.count > 1) parts.push(`x${c.count}`);
    if (c.period) parts.push(`[${c.period}]`);
    return `${i + 1}. ${parts.join(' ')}`;
  }).join('\n');
}

// Evidence hash 생성 (캐시용)
function computeEvidenceHash(items) {
  const evidences = items
    .slice(0, 30)
    .map(c => `${c.venue}|${c.title}`)
    .sort()
    .join('|');
  return crypto.createHash('md5').update(evidences).digest('hex').slice(0, 12);
}

// JSON 추출
function extractJson(text) {
  if (!text) return null;
  // {} 형태 찾기
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Gemini로 전시 후보 정규화 (REST API)
 */
export async function normalizeWithGemini(venueName, candidates) {
  // 단일 venue용 래퍼: 배치 엔진에 그대로 전달
  return normalizeBatchWithGemini(candidates.map(c => ({
    venue: venueName,
    title: c.title,
    period: c.period,
    count: c.count || 1
  })));
}

// 배치 호출 (여러 venue 섞어서)
export async function normalizeBatchWithGemini(batch) {
  if (!GEMINI_ENABLED || !GEMINI_API_KEY) {
    return { exhibitions: [], rejects: [], error: 'disabled' };
  }
  if (!batch || batch.length === 0) {
    return { exhibitions: [], rejects: [], error: 'no_candidates' };
  }

  if (normalizeCallsUsed >= GEMINI_MAX_CALLS_PER_RUN) {
    console.log('[Gemini Normalize] Rate limit reached');
    return { exhibitions: [], rejects: [], error: 'rate_limit' };
  }

  const evidenceHash = computeEvidenceHash(batch);
  const cacheKey = `batch::${evidenceHash}`;
  if (evidenceCache.has(cacheKey)) {
    console.log('[Gemini Normalize] Cache hit (batch)');
    return { ...evidenceCache.get(cacheKey), cached: true };
  }

  try {
    normalizeCallsUsed++;

    const prompt = buildBatchPrompt(batch);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, topP: 0.2, maxOutputTokens: 1024 }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`[Gemini Normalize] HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      return { exhibitions: [], rejects: [], error: `http_${response.status}` };
    }

    const data = await response.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p?.text || '').join('\n');
    const parsed = extractJson(text);
    if (!parsed) {
      console.error('[Gemini Normalize] JSON parse failed:', text.slice(0, 300));
      return { exhibitions: [], rejects: [], error: 'parse_error', raw: text };
    }

    const output = {
      exhibitions: Array.isArray(parsed.exhibitions) ? parsed.exhibitions.map(e => ({
        venue: e.venue || '',
        canonicalTitle: e.canonicalTitle || e.title || '',
        titleKey: e.titleKey || (e.canonicalTitle || '').toLowerCase().replace(/\s+/g, ''),
        aliases: Array.isArray(e.aliases) ? e.aliases : [],
        artist: e.artist || null,
        startDate: e.startDate || null,
        endDate: e.endDate || null,
        isPermanent: !!e.isPermanent,
        confidence: typeof e.confidence === 'number' ? e.confidence : 0.5
      })) : [],
      rejects: Array.isArray(parsed.rejects) ? parsed.rejects.map(r => ({
        venue: r.venue || '',
        raw: r.raw || '',
        reason: r.reason || ''
      })) : []
    };

    evidenceCache.set(cacheKey, output);
    console.log(`[Gemini Normalize] batch call#${normalizeCallsUsed}: ${output.exhibitions.length} ok, ${output.rejects.length} rejects`);
    return output;
  } catch (err) {
    console.error('[Gemini Normalize] Error:', err.message);
    return { exhibitions: [], rejects: [], error: err.message };
  }
}

/**
 * 여러 venue를 순회하며 정규화
 */
export async function normalizeAllVenues(previewResult) {
  if (!GEMINI_ENABLED || !GEMINI_API_KEY) {
    return { error: 'disabled', results: {} };
  }

  const EXCLUDE_VENUES = new Set(['이이남 스튜디오']);
  const flat = [];

  for (const [venueName, candidates] of Object.entries(previewResult.preview || {})) {
    if (EXCLUDE_VENUES.has(venueName)) continue; // 명시적 제외
    if (!candidates || candidates.length === 0) continue;

    for (const c of candidates) {
      flat.push({
        venue: venueName,
        title: c.title,
        period: c.period || null,
        count: c.count || 1,
        price: c.price || null,
        description: c.description || null
      });
    }
  }

  if (flat.length === 0) {
    return { error: 'no_candidates', results: {} };
  }

  // 배치로 쪼개서 호출 (title 중심)
  const batches = [];
  for (let i = 0; i < flat.length; i += GEMINI_BATCH_SIZE) {
    batches.push(flat.slice(i, i + GEMINI_BATCH_SIZE));
  }

  const perVenue = {};
  let totalExhibitions = 0;
  let totalRejects = 0;

  for (const batch of batches) {
    if (normalizeCallsUsed >= GEMINI_MAX_CALLS_PER_RUN) {
      console.log('[Gemini Normalize] Rate limit, stopping');
      break;
    }

    const res = await normalizeBatchWithGemini(batch);
    if (res.error) {
      // 기록 후 중단
      console.log('[Gemini Normalize] batch error:', res.error);
      break;
    }

    // venue별로 결과 분배
    for (const ex of res.exhibitions || []) {
      const v = ex.venue || 'unknown';
      if (!perVenue[v]) perVenue[v] = { exhibitions: [], rejects: [] };
      // price/description 붙이기: 같은 제목의 원본 대표값
      const original = batch.find(b => b.venue === v && b.title && ex.aliases?.includes(b.title) || b.title === ex.canonicalTitle) ||
        batch.find(b => b.venue === v);
      perVenue[v].exhibitions.push({
        ...ex,
        price: original?.price || null,
        description: original?.description || null
      });
      totalExhibitions += 1;
    }
    for (const r of res.rejects || []) {
      const v = r.venue || 'unknown';
      if (!perVenue[v]) perVenue[v] = { exhibitions: [], rejects: [] };
      perVenue[v].rejects.push(r);
      totalRejects += 1;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // 후보 없던 venue도 결과 표기
  const results = {};
  for (const venueName of Object.keys(previewResult.preview || {})) {
    if (EXCLUDE_VENUES.has(venueName)) {
      results[venueName] = { exhibitions: [], rejects: [], skipped: 'excluded' };
      continue;
    }
    results[venueName] = perVenue[venueName] || { exhibitions: [], rejects: [], skipped: 'no_result' };
  }

  return {
    totalVenues: Object.keys(results).length,
    totalExhibitions,
    totalRejects,
    callsUsed: normalizeCallsUsed,
    results
  };
}

export function resetNormalizeQuota() {
  normalizeCallsUsed = 0;
}

export function clearNormalizeCache() {
  evidenceCache.clear();
}

// CLI 테스트
if (import.meta.url === `file://${process.argv[1]}`) {
  const testCandidates = [
    { title: '필립 파레노 특별전', count: 5, period: { start: '2025-01-01', end: '2025-06-30' } },
    { title: 'Philippe Parreno: Voices', count: 3 },
    { title: '파레노 전시', count: 2 },
    { title: '리움 데이트 코스', count: 1 }
  ];

  normalizeWithGemini('리움미술관', testCandidates)
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => console.error(e));
}
