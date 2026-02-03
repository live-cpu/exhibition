import dotenv from 'dotenv';
import Exhibition from '../models/Exhibition.js';
import Venue from '../models/Venue.js';
import { fetchNaverSearch } from './naverApi.js';
import { searchCurrentExhibitions } from './naverExhibitionSearch.js';
import { fetchBraveExhibitionPeriod, parsePeriodFromText, consumeBraveQuota } from './braveSearch.js';
import { fetchGeminiExhibitions } from './geminiSearch.js';

dotenv.config();

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const BRAVE_API_BASE_URL = 'https://api.search.brave.com/res/v1/web/search';

const DEFAULT_KEYWORDS = [
  '전시',
  '기획전',
  '특별전',
  '기획',
  '개인전',
  '단체전'
];

const EXCLUDE_KEYWORDS = [
  '안내사항',
  '관람정보',
  '운영정보',
  '오시는길',
  '찾아오는길',
  '주차',
  '시설안내',
  '이용안내',
  '대관',
  '대관안내',
  '대관 신청',
  '공지',
  '공지사항',
  '채용',
  '후원',
  '프로그램',
  '운영시간',
  '휴관',
  '예약'
];

const NOISY_KEYWORDS = [
  '추천',
  '가볼만한곳',
  '놀거리',
  '혜택',
  '할인',
  '코스',
  '맛집',
  '카페',
  '여행',
  '핫플',
  '리뷰모음',
  '헤드라인',
  '뉴스',
  '기사',
  '이태원',
  '용산',
  '이재용',
  '음료수',
  '차에서'
];

const DEFAULT_PREFERRED_DOMAINS = [
  'instagram.com',
  'booking.naver.com',
  'art-map.co.kr',
  'neolook.com',
  'daljin.com',
  'tickets.interpark.com',
  'ticket.interpark.com',
  'ticket.yes24.com',
  'trip.com'
];

function stripHtml(text) {
  if (!text) return '';
  return String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  return String(text)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function normalizeText(text) {
  return decodeHtmlEntities(stripHtml(text));
}

function hasKeyword(text, keywords) {
  const haystack = (text || '').toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}

function hasExcludedKeyword(text) {
  const haystack = (text || '').toLowerCase();
  return EXCLUDE_KEYWORDS.some((k) => haystack.includes(k.toLowerCase())) ||
    NOISY_KEYWORDS.some((k) => haystack.includes(k.toLowerCase()));
}

function normalizeVenueName(venueName) {
  if (!venueName) return '';
  return String(venueName).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildVenueNameVariants(venueName) {
  const raw = String(venueName || '').trim();
  const normalized = normalizeVenueName(raw);
  const noSpace = normalized.replace(/\s+/g, '');
  const variants = [raw, normalized, noSpace].filter(Boolean);
  return Array.from(new Set(variants));
}

function cleanExhibitionTitle(title, venueName) {
  if (!title) return '';
  let value = String(title).trim();
  const variants = buildVenueNameVariants(venueName);
  for (const name of variants) {
    const escaped = name.replace(/[()]/g, '\\$&');
    value = value.replace(new RegExp(escaped, 'gi'), '');
  }
  const separators = [' | ', ' - ', ' |', ' -', '·'];
  for (const sep of separators) {
    if (value.includes(sep)) {
      const parts = value.split(sep).map((p) => p.trim()).filter(Boolean);
      if (parts[0] && parts[0].length >= 3) {
        value = parts[0];
        break;
      }
    }
  }
  return value.replace(/\s+/g, ' ').trim();
}

function isLikelyExhibitionTitle(text, keywords) {
  if (!text) return false;
  const value = String(text).trim();
  if (value.length < 3) return false;
  if (hasExcludedKeyword(value)) return false;
  return hasKeyword(value, keywords);
}

function buildBraveQueries(venueName, instagramHandle = '', preferredDomains = DEFAULT_PREFERRED_DOMAINS, domainOnly = true) {
  const names = buildVenueNameVariants(venueName);
  const baseQueries = [];
  const mainName = names[0] || venueName;
  const altName = names[1] || mainName;

  if (domainOnly) {
    const targetNames = Array.from(new Set([mainName, altName])).filter(Boolean);
    for (const name of targetNames) {
      for (const domain of preferredDomains) {
        baseQueries.push(`site:${domain} \"${name}\" 전시`);
      }
    }
  } else {
    for (const name of names) {
      baseQueries.push(`${name} 전시`, `${name} 기획전`, `${name} 특별전`);
    }
  }

  if (instagramHandle) {
    const handle = String(instagramHandle).replace(/^@/, '').trim();
    if (handle) {
      baseQueries.push(`site:instagram.com/${handle} 전시`);
    }
  }

  return Array.from(new Set(baseQueries));
}

async function searchBraveExhibitions(
  venue,
  count = 10,
  consumeBraveCall = () => true,
  preferredDomains = DEFAULT_PREFERRED_DOMAINS,
  domainOnly = true,
  maxQueriesPerVenue = 1
) {
  const venueName = typeof venue === 'string' ? venue : venue?.name;
  if (!BRAVE_API_KEY || !venueName) return [];

  try {
    const queries = buildBraveQueries(venueName, venue?.instagramHandle || '', preferredDomains, domainOnly);
    const limitedQueries = maxQueriesPerVenue > 0 ? queries.slice(0, maxQueriesPerVenue) : queries;
    const results = [];

    for (const query of limitedQueries) {
      if (results.length >= count) break;
      if (!consumeBraveCall()) break;

      const url = new URL(BRAVE_API_BASE_URL);
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(Math.min(count - results.length, 10)));
      url.searchParams.set('extra_snippets', 'true');
      url.searchParams.set('freshness', 'pm');
      url.searchParams.set('country', 'KR');
      url.searchParams.set('search_lang', 'ko');

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': BRAVE_API_KEY
        },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        console.error(`[brave-search] API error: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const list = data?.web?.results || [];
      results.push(...list);
    }

    return results;
  } catch (err) {
    console.error(`[brave-search] Fetch error: ${err.message}`);
    return [];
  }
}

function extractExhibitionsFromBrave(results, venueName, keywords) {
  const exhibitions = [];

  for (const result of results) {
    const title = normalizeText(result?.title || '');
    const description = normalizeText(result?.description || '');
    const extraSnippets = (result?.extra_snippets || []).map(s => normalizeText(s)).join(' ');
    const fullText = `${title} ${description} ${extraSnippets}`.trim();

    if (!hasKeyword(fullText, keywords)) continue;
    if (hasExcludedKeyword(fullText)) continue;

    const cleanedTitle = cleanExhibitionTitle(title, venueName) || title;
    if (!isLikelyExhibitionTitle(cleanedTitle, keywords)) continue;

    const period = parsePeriodFromText(fullText);

    exhibitions.push({
      title: cleanedTitle,
      fullTitle: title,
      description,
      period,
      image: result?.thumbnail?.src || '',
      link: result?.url || '',
      source: 'brave'
    });
  }

  return exhibitions;
}

function isOngoingOrUpcoming(period, windowDays = 30) {
  if (!period?.start || !period?.end) return false;
  const now = new Date();
  const upcoming = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  return (now >= period.start && now <= period.end) ||
    (period.start > now && period.start <= upcoming);
}

export async function searchVenueExhibitions(options = {}) {
  console.log('[venue-search] options received:', JSON.stringify(options, null, 2));

  const {
    venueNames = [],
    limit = Number(process.env.VENUE_SEARCH_LIMIT || 200),
    perVenue = Number(process.env.VENUE_SEARCH_PER_VENUE || 3),
    serviceIds = ['news', 'webkr'],
    keywords = DEFAULT_KEYWORDS,
    braveLimit = Number(process.env.VENUE_SEARCH_BRAVE_LIMIT || process.env.BRAVE_MAX_CALLS_PER_RUN || 10),
    maxQueriesPerVenue = Number(process.env.VENUE_SEARCH_QUERIES_PER_VENUE || 1),
    naverForTrend = false,
    debug = false,
    allowPeriodUnknown = true,
    geminiEnabled = false,
    preferredDomains = DEFAULT_PREFERRED_DOMAINS,
    domainOnly = true
  } = options;

  const geminiAllowed = geminiEnabled === true &&
    String(process.env.GEMINI_ENABLED ?? 'false').toLowerCase() === 'true';

  const nameFilter = Array.isArray(venueNames) && venueNames.length
    ? { name: { $in: venueNames } }
    : {};

  const venueQuery = Venue.find(nameFilter);
  if (Number.isFinite(limit) && limit > 0) {
    venueQuery.limit(limit);
  }
  const venues = await venueQuery;

  const created = [];
  const skipped = [];
  const errors = [];
  const seen = new Set();
  let braveCallsUsed = 0;
  const debugStats = [];

  for (const venue of venues) {
    const venueStats = {
      venue: venue.name,
      braveResults: 0,
      naverResults: 0,
      geminiResults: 0,
      candidates: 0,
      withPeriod: 0,
      noPeriod: 0,
      notOngoing: 0,
      periodUnknownCreated: 0,
      exists: 0,
      created: 0,
      skipped: 0
    };

    let naverExhibitions = [];
    let braveExhibitions = [];
    const consumeBraveCall = () => {
      if (braveCallsUsed >= braveLimit) return false;
      if (!consumeBraveQuota()) return false;
      braveCallsUsed += 1;
      return true;
    };

    try {
      naverExhibitions = await searchCurrentExhibitions(venue.name);
      venueStats.naverResults = naverExhibitions.length;
    } catch (err) {
      console.error(`[venue-search] Naver primary search error: ${err.message}`);
    }

    if (naverExhibitions.length === 0 && braveCallsUsed < braveLimit) {
      const braveCount = Math.max(10, perVenue);
      const braveResults = await searchBraveExhibitions(
        venue,
        braveCount,
        consumeBraveCall,
        preferredDomains,
        domainOnly,
        maxQueriesPerVenue
      );
      venueStats.braveResults = braveResults.length;
      braveExhibitions = extractExhibitionsFromBrave(braveResults, venue.name, keywords);
    }

    let naverItems = [];
    if (naverForTrend && !domainOnly && naverExhibitions.length === 0) {
      const venueNames = buildVenueNameVariants(venue.name);
      const naverQueries = [];
      for (const name of venueNames) {
        naverQueries.push(`${name} 전시`, `${name} 기획전`, `${name} 특별전`);
      }

      const uniqueQueries = Array.from(new Set(naverQueries));
      for (const serviceId of serviceIds) {
        for (const query of uniqueQueries) {
          try {
            const result = await fetchNaverSearch(serviceId, query, { display: Math.max(3, Math.floor(perVenue / 2)), sort: 'date' });
            const list = Array.isArray(result?.items) ? result.items : [];
            naverItems = naverItems.concat(list);
            venueStats.naverResults += list.length;
          } catch (err) {
            console.error(`[venue-search] Naver API error: ${err.message}`);
          }
        }
      }
    }

    let geminiExhibitions = [];
    if (geminiAllowed && naverExhibitions.length === 0 && braveExhibitions.length === 0 && naverItems.length === 0) {
      const geminiResults = await fetchGeminiExhibitions({ venue, limit: 3 });
      if (Array.isArray(geminiResults) && geminiResults.length > 0) {
        geminiExhibitions = geminiResults;
        venueStats.geminiResults = geminiResults.length;
      }
    }

    for (const exhibition of naverExhibitions) {
      venueStats.candidates += 1;

      const key = `${venue.name}|${exhibition.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = await Exhibition.findOne({
        $or: [
          { title: exhibition.title, 'venue.name': venue.name },
          { title: exhibition.fullTitle, 'venue.name': venue.name }
        ]
      }).lean();

      if (existing) {
        skipped.push({ title: exhibition.title, venue: venue.name, reason: 'exists' });
        venueStats.skipped += 1;
        venueStats.exists += 1;
        continue;
      }

      let period = exhibition.period;
      if (!period) {
        venueStats.noPeriod += 1;
        if (!allowPeriodUnknown) {
          skipped.push({ title: exhibition.title, venue: venue.name, reason: 'no_period' });
          venueStats.skipped += 1;
          continue;
        }
      }

      if (period && !isOngoingOrUpcoming(period)) {
        skipped.push({ title: exhibition.title, venue: venue.name, reason: 'not_ongoing' });
        venueStats.skipped += 1;
        venueStats.notOngoing += 1;
        continue;
      }

      if (period) {
        venueStats.withPeriod += 1;
      }

      const exhibitionData = {
        title: exhibition.title,
        period: period ? { start: period.start, end: period.end } : undefined,
        periodUnknown: !period,
        openHours: venue.openHours
          ? { weekday: venue.openHours, weekend: venue.openHours, closed: [] }
          : undefined,
        venue: {
          name: venue.name,
          address: venue.address || venue.name || '주소 정보 없음',
          location: venue.location || { lat: 0, lng: 0 },
          barrierFree: venue.barrierFree || {}
        },
        barrierFree: venue.barrierFree || {},
        website: exhibition.sourceUrl || '',
        description: exhibition.description,
        images: [],
        _source: 'naver_search',
        _apiId: exhibition.sourceUrl || undefined
      };

      try {
        const createdExhibition = await Exhibition.create(exhibitionData);
        created.push(createdExhibition);
        venueStats.created += 1;
        if (!period) {
          venueStats.periodUnknownCreated += 1;
        }
      } catch (err) {
        errors.push({ venue: venue.name, title: exhibition.title, error: err.message });
      }
    }

    for (const exhibition of braveExhibitions) {
      venueStats.candidates += 1;

      const key = `${venue.name}|${exhibition.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = await Exhibition.findOne({
        $or: [
          { title: exhibition.title, 'venue.name': venue.name },
          { title: exhibition.fullTitle, 'venue.name': venue.name }
        ]
      }).lean();

      if (existing) {
        skipped.push({ title: exhibition.title, venue: venue.name, reason: 'exists' });
        venueStats.skipped += 1;
        venueStats.exists += 1;
        continue;
      }

      let period = exhibition.period;
      if (!period && braveCallsUsed < braveLimit) {
        braveCallsUsed += 1;
        const braveQuery = `"${exhibition.title}" 전시 기간`;
        period = await fetchBraveExhibitionPeriod(braveQuery);
      }

      if (!period) {
        venueStats.noPeriod += 1;
        if (!allowPeriodUnknown) {
          skipped.push({ title: exhibition.title, venue: venue.name, reason: 'no_period' });
          venueStats.skipped += 1;
          continue;
        }
      }

      if (period && !isOngoingOrUpcoming(period)) {
        skipped.push({ title: exhibition.title, venue: venue.name, reason: 'not_ongoing' });
        venueStats.skipped += 1;
        venueStats.notOngoing += 1;
        continue;
      }

      if (period) {
        venueStats.withPeriod += 1;
      }

      const exhibitionData = {
        title: exhibition.title,
        period: period ? { start: period.start, end: period.end } : undefined,
        periodUnknown: !period,
        openHours: venue.openHours
          ? { weekday: venue.openHours, weekend: venue.openHours, closed: [] }
          : undefined,
        venue: {
          name: venue.name,
          address: venue.address || venue.name || '주소 정보 없음',
          location: venue.location || { lat: 0, lng: 0 },
          barrierFree: venue.barrierFree || {}
        },
        barrierFree: venue.barrierFree || {},
        website: exhibition.link || '',
        description: exhibition.description,
        images: exhibition.image ? [exhibition.image] : [],
        _source: 'brave_search',
        _apiId: exhibition.link || undefined
      };

      try {
        const createdExhibition = await Exhibition.create(exhibitionData);
        created.push(createdExhibition);
        venueStats.created += 1;
        if (!period) {
          venueStats.periodUnknownCreated += 1;
        }
      } catch (err) {
        errors.push({ venue: venue.name, title: exhibition.title, error: err.message });
      }
    }

    for (const exhibition of geminiExhibitions) {
      venueStats.candidates += 1;

      const key = `${venue.name}|${exhibition.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = await Exhibition.findOne({
        $or: [
          { title: exhibition.title, 'venue.name': venue.name },
          { title: exhibition.fullTitle, 'venue.name': venue.name }
        ]
      }).lean();

      if (existing) {
        skipped.push({ title: exhibition.title, venue: venue.name, reason: 'exists' });
        venueStats.skipped += 1;
        venueStats.exists += 1;
        continue;
      }

      let period = exhibition.period;
      if (!period) {
        venueStats.noPeriod += 1;
        if (!allowPeriodUnknown) {
          skipped.push({ title: exhibition.title, venue: venue.name, reason: 'no_period' });
          venueStats.skipped += 1;
          continue;
        }
      }

      if (period && !isOngoingOrUpcoming(period)) {
        skipped.push({ title: exhibition.title, venue: venue.name, reason: 'not_ongoing' });
        venueStats.skipped += 1;
        venueStats.notOngoing += 1;
        continue;
      }

      if (period) {
        venueStats.withPeriod += 1;
      }

      const exhibitionData = {
        title: exhibition.title,
        period: period ? { start: period.start, end: period.end } : undefined,
        periodUnknown: !period,
        openHours: venue.openHours
          ? { weekday: venue.openHours, weekend: venue.openHours, closed: [] }
          : undefined,
        venue: {
          name: venue.name,
          address: venue.address || venue.name || '주소 정보 없음',
          location: venue.location || { lat: 0, lng: 0 },
          barrierFree: venue.barrierFree || {}
        },
        barrierFree: venue.barrierFree || {},
        website: exhibition.link || '',
        description: exhibition.description,
        images: [],
        _source: 'gemini_search',
        _apiId: exhibition.link || undefined
      };

      try {
        const createdExhibition = await Exhibition.create(exhibitionData);
        created.push(createdExhibition);
        venueStats.created += 1;
        if (!period) {
          venueStats.periodUnknownCreated += 1;
        }
      } catch (err) {
        errors.push({ venue: venue.name, title: exhibition.title, error: err.message });
      }
    }

    if (debug) {
      debugStats.push(venueStats);
    }
  }

  return {
    createdCount: created.length,
    skippedCount: skipped.length,
    errorCount: errors.length,
    braveCallsUsed,
    braveLimit,
    created,
    skipped,
    errors,
    debug: debug ? debugStats : undefined
  };
}
