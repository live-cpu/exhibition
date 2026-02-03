import dotenv from 'dotenv';
import Venue from '../models/Venue.js';
import {
  fetchBraveDescription,
  fetchBraveVenueInfo,
  fetchBraveExhibitionAccessibility
} from './braveSearch.js';
import { fetchNaverVenueInfo } from './naverExhibitionSearch.js';
import { applyVenueAlias, normalizeVenueNameAdvanced } from './venueAlias.js';

dotenv.config();

const CNV_API_KEY = process.env.CNV_API_KEY;
const CNV_API_BASE_URL = 'https://api.kcisa.kr/openapi/CNV_060/request';
const EXTERNAL_ENRICH_ENABLED = String(process.env.EXTERNAL_ENRICH_ENABLED ?? 'true').toLowerCase() !== 'false';
const EXHIBITION_DETAIL_ENRICH_ENABLED = String(process.env.EXHIBITION_DETAIL_ENRICH_ENABLED ?? 'false').toLowerCase() === 'true';
const UPCOMING_WINDOW_DAYS = Number(process.env.UPCOMING_WINDOW_DAYS || 7);
const VENUE_REFRESH_DAYS = Number(process.env.VENUE_REFRESH_DAYS || 7);

const venueCache = new Map();

function parseSimpleXML(xmlText) {
  try {
    const items = [];
    const itemMatches = xmlText.match(/<item>([\s\S]*?)<\/item>/gi);

    if (itemMatches) {
      itemMatches.forEach((itemXml) => {
        const item = {};
        const innerXml = itemXml.replace(/^<item>|<\/item>$/gi, '');
        const tagPattern = /<([^>\/\s]+)>([\s\S]*?)<\/\1>/g;
        let match;

        while ((match = tagPattern.exec(innerXml)) !== null) {
          const tagName = match[1];
          let tagValue = match[2];
          tagValue = tagValue.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
          item[tagName] = tagValue;
        }

        if (Object.keys(item).length > 0) {
          items.push(item);
        }
      });
    }

    return { response: { body: { items } } };
  } catch (err) {
    console.error('Simple XML parse error:', err);
    return { response: { body: { items: [] } } };
  }
}

function parsePeriod(periodStr) {
  if (!periodStr) return { start: null, end: null };
  const raw = String(periodStr).trim();
  if (!raw) return { start: null, end: null };

  const compact = raw.match(/(\d{8})\s*[~\-]\s*(\d{8})/);
  if (compact) {
    const start = `${compact[1].slice(0, 4)}-${compact[1].slice(4, 6)}-${compact[1].slice(6, 8)}`;
    const end = `${compact[2].slice(0, 4)}-${compact[2].slice(4, 6)}-${compact[2].slice(6, 8)}`;
    return { start: new Date(start), end: new Date(end) };
  }

  const normalized = raw.replace(/\./g, '-');
  const match = normalized.match(/(\d{4}-\d{2}-\d{2})\s*[~\-]\s*(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return { start: new Date(match[1]), end: new Date(match[2]) };
  }

  return { start: null, end: null };
}

function parsePrice(priceStr) {
  if (!priceStr) return 0;
  const str = String(priceStr).toLowerCase();
  if (str.includes('무료') || str.includes('free') || str === '0') return 0;
  const numbers = str.replace(/[^0-9]/g, '');
  return parseInt(numbers, 10) || 0;
}

function isPermanentExhibition(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  return text.includes('상설') || text.includes('상설전');
}

function normalizeEventSite(eventSite) {
  const raw = String(eventSite || '').trim();
  if (!raw) return '';

  const generic = [
    '해외', '국외', '국내', '온라인',
    '기획전시실', '기획전시실1', '기획전시실2',
    '상설전시관', '상설전시실', '본관', '별관'
  ];
  if (generic.includes(raw)) return raw;

  // 먼저 고급 정규화 적용
  const advancedNormalized = normalizeVenueNameAdvanced(raw);
  if (advancedNormalized && advancedNormalized !== raw) {
    return advancedNormalized;
  }

  // MMCA 분관 처리
  if (raw.includes('과천')) return '국립현대미술관 (과천)';
  if (raw.includes('덕수궁')) return '국립현대미술관 (덕수궁)';
  if (raw.includes('청주')) return '국립현대미술관 (청주)';
  if (raw.includes('서울') || raw.includes('삼청동')) return '국립현대미술관 (서울)';

  // ACC 처리
  if (raw.includes('문화창조원') || raw.includes('아시아문화박물관') || /acc/i.test(raw)) {
    return '국립아시아문화전당';
  }

  return raw.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

function shouldRefreshVenue(existing) {
  if (!existing?.updatedAt) return true;
  const updated = new Date(existing.updatedAt);
  if (Number.isNaN(updated.getTime())) return true;
  const ageMs = Date.now() - updated.getTime();
  return ageMs > VENUE_REFRESH_DAYS * 24 * 60 * 60 * 1000;
}

function normalizeVenueName(name) {
  if (!name) return '';
  return String(name).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractParenValue(name) {
  const match = String(name || '').match(/\(([^)]+)\)/);
  return match ? match[1].trim() : '';
}

function buildFlexibleRegex(value) {
  if (!value) return null;
  const escaped = String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flexible = escaped.replace(/\s+/g, '\\s*');
  return new RegExp(flexible, 'i');
}

function getVenueNameCandidates(rawName) {
  if (!rawName) return [];
  const base = normalizeVenueName(rawName);
  const paren = extractParenValue(rawName);
  const candidates = new Set();
  if (base) candidates.add(base);
  if (paren && base) {
    candidates.add(`${paren} ${base}`);
    candidates.add(`${base} ${paren}`);
    candidates.add(`${paren}${base}`);
    candidates.add(`${base}${paren}`);
  }
  return Array.from(candidates);
}

async function resolveVenueInfo(eventSite) {
  const aliased = applyVenueAlias(normalizeEventSite(eventSite || ''));
  const key = normalizeVenueName(aliased || eventSite || '');
  if (!key) return null;
  if (venueCache.has(key)) return venueCache.get(key);

  const candidates = getVenueNameCandidates(aliased || eventSite);
  const regexList = candidates.map(buildFlexibleRegex).filter(Boolean);
  const existing = regexList.length
    ? await Venue.findOne({ $or: regexList.map((regex) => ({ name: { $regex: regex } })) }).lean()
    : await Venue.findOne({ name: key }).lean();

  if (existing?.location?.lat && existing?.location?.lng) {
    const cached = {
      address: existing.address,
      location: existing.location,
      barrierFree: {
        wheelchair: !!existing.barrierFree?.wheelchair,
        elevator: !!existing.barrierFree?.elevator,
        braille: !!existing.barrierFree?.braille,
        audioGuide: !!existing.barrierFree?.audioGuide
      }
    };
    venueCache.set(key, cached);
    return cached;
  }

  const needsLocation = !(existing?.location?.lat && existing?.location?.lng);
  if (!EXTERNAL_ENRICH_ENABLED || (!needsLocation && !shouldRefreshVenue(existing))) {
    venueCache.set(key, null);
    return null;
  }

  const naverInfo = await fetchNaverVenueInfo(aliased || eventSite);
  if (naverInfo && existing) {
    const update = {};
    if (!existing.address && naverInfo.address) update.address = naverInfo.address;
    const bf = {};
    if (typeof existing.barrierFree?.wheelchair === 'undefined') bf.wheelchair = !!naverInfo.barrierFree?.wheelchair;
    if (typeof existing.barrierFree?.elevator === 'undefined') bf.elevator = !!naverInfo.barrierFree?.elevator;
    if (typeof existing.barrierFree?.braille === 'undefined') bf.braille = !!naverInfo.barrierFree?.braille;
    if (typeof existing.barrierFree?.audioGuide === 'undefined') bf.audioGuide = !!naverInfo.barrierFree?.audioGuide;
    if (typeof existing.barrierFree?.accessibleToilet === 'undefined') bf.accessibleToilet = !!naverInfo.barrierFree?.accessibleToilet;
    if (typeof existing.barrierFree?.parkingPaid === 'undefined') bf.parkingPaid = !!naverInfo.barrierFree?.parkingPaid;
    if (typeof existing.barrierFree?.parkingFree === 'undefined') bf.parkingFree = !!naverInfo.barrierFree?.parkingFree;
    if (Object.keys(bf).length) update.barrierFree = { ...existing.barrierFree, ...bf };
    if (Object.keys(update).length) {
      update.updatedAt = new Date();
      await Venue.findOneAndUpdate({ _id: existing._id }, { $set: update });
    }
  }

  const info = await fetchBraveVenueInfo(aliased || eventSite);
  if (info?.location) {
    const update = {};
    if (!existing) {
      await Venue.create({
        name: key,
        address: info.address || '',
        location: info.location,
        barrierFree: {
          wheelchair: !!info.barrierFree?.wheelchair,
          elevator: !!info.barrierFree?.elevator,
          braille: !!info.barrierFree?.braille,
          audioGuide: !!info.barrierFree?.audioGuide,
          accessibleToilet: !!info.barrierFree?.accessibleToilet,
          parkingPaid: !!info.barrierFree?.parkingPaid,
          parkingFree: !!info.barrierFree?.parkingFree
        },
        updatedAt: new Date()
      });
    } else {
      if (!existing.address && info.address) update.address = info.address;
      if (!existing.location?.lat || !existing.location?.lng) update.location = info.location;
      const bf = {};
      if (typeof existing.barrierFree?.wheelchair === 'undefined') bf.wheelchair = !!info.barrierFree?.wheelchair;
      if (typeof existing.barrierFree?.elevator === 'undefined') bf.elevator = !!info.barrierFree?.elevator;
      if (typeof existing.barrierFree?.braille === 'undefined') bf.braille = !!info.barrierFree?.braille;
      if (typeof existing.barrierFree?.audioGuide === 'undefined') bf.audioGuide = !!info.barrierFree?.audioGuide;
      if (typeof existing.barrierFree?.accessibleToilet === 'undefined') {
        bf.accessibleToilet = !!info.barrierFree?.accessibleToilet;
      }
      if (typeof existing.barrierFree?.parkingPaid === 'undefined') bf.parkingPaid = !!info.barrierFree?.parkingPaid;
      if (typeof existing.barrierFree?.parkingFree === 'undefined') bf.parkingFree = !!info.barrierFree?.parkingFree;
      if (Object.keys(bf).length) update.barrierFree = { ...existing.barrierFree, ...bf };
      if (Object.keys(update).length) {
        update.updatedAt = new Date();
        await Venue.findOneAndUpdate({ _id: existing._id }, { $set: update });
      }
    }
  }

  venueCache.set(key, info);
  return info;
}

function transformUnifiedItem(item) {
  if (!item || typeof item !== 'object') return null;

  const title = (item.title || item.TITLE || item.Title || '').trim();
  if (!title) return null;

  const eventSite = (item.eventSite || item.EVENT_SITE || item.eventsite || '').trim();
  const period = parsePeriod(item.period || item.PERIOD || item.eventPeriod || item.EVENT_PERIOD || '');

  return {
    base: {
      title,
      type: item.type || item.TYPE || '',
      period,
      eventPeriod: item.eventPeriod || item.EVENT_PERIOD || '',
      eventSite,
      charge: item.charge || item.CHARGE || '',
      contactPoint: item.contactPoint || item.CONTACT_POINT || '',
      url: item.url || item.URL || '',
      imageObject: item.imageObject || item.IMAGE_OBJECT || '',
      description: item.description || item.DESCRIPTION || ''
    }
  };
}

export async function fetchUnifiedCultureExhibitions(params = {}) {
  if (!CNV_API_KEY) {
    throw new Error('Missing CNV_API_KEY');
  }
  const { page = 1, rows = 200, braveLimit = 50 } = params;
  const queryParams = new URLSearchParams({
    serviceKey: CNV_API_KEY,
    pageNo: page.toString(),
    numOfRows: rows.toString()
  });

  const url = `${CNV_API_BASE_URL}?${queryParams.toString()}`;
  console.log(`Fetching from CNV_060 API: ${url}`);

  const response = await fetch(url, {
    headers: { Accept: 'application/json, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  let data;
  if (contentType.includes('xml') || contentType.includes('text')) {
    const xmlText = await response.text();
    data = parseSimpleXML(xmlText);
  } else {
    data = await response.json();
  }

  let items = [];
  if (data.response?.body?.items) {
    const itemsData = data.response.body.items;
    if (Array.isArray(itemsData)) {
      items = itemsData;
    } else if (Array.isArray(itemsData.item)) {
      items = itemsData.item;
    } else if (itemsData.item) {
      items = [itemsData.item];
    } else {
      items = [itemsData];
    }
  } else if (data.items) {
    if (Array.isArray(data.items)) {
      items = data.items;
    } else if (Array.isArray(data.items.item)) {
      items = data.items.item;
    } else if (data.items.item) {
      items = [data.items.item];
    } else {
      items = [data.items];
    }
  } else if (Array.isArray(data)) {
    items = data;
  }

  const normalized = items.map(transformUnifiedItem).filter(Boolean);
  const now = new Date();
  const upcomingLimit = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const ongoingItems = normalized.filter((item) => {
    const start = item.base.period.start;
    const end = item.base.period.end;
    const permanent = isPermanentExhibition(item.base.title, item.base.description);
    if (!start || !end) return permanent;
    if (now >= start && now <= end) return true;
    return start > now && start <= upcomingLimit;
  });

  const results = [];
  let braveCount = 0;
  let missingLocationCount = 0;
  const filteredItems = ongoingItems;

  for (const item of filteredItems) {
    if (braveCount >= braveLimit) {
      break;
    }
    const base = item.base;
    let description = (base.description || '').trim();
    if (!description && EXHIBITION_DETAIL_ENRICH_ENABLED) {
      if (braveCount >= braveLimit) {
        continue;
      }
      const braveDescription = await fetchBraveDescription(
        `${base.title} ${base.eventSite} exhibition description`
      );
      description = braveDescription || '';
      braveCount++;
    }

    const venueInfo = await resolveVenueInfo(base.eventSite);
    if (!venueInfo?.location) {
      missingLocationCount++;
    }

    let exhibitAccessibility = null;
    if (EXHIBITION_DETAIL_ENRICH_ENABLED) {
      if (braveCount >= braveLimit) {
        continue;
      }
      exhibitAccessibility = await fetchBraveExhibitionAccessibility(base.title, base.eventSite);
      braveCount++;
    }
    const finalPrice = parsePrice(base.charge);

    const periodUnknown = !(base.period.start && base.period.end);
    const venueName = base.eventSite || 'Unknown venue';
    results.push({
      title: base.title,
      period: {
        start: base.period.start || new Date(),
        end: base.period.end || new Date()
      },
      periodUnknown,
      openHours: {
        weekday: base.eventPeriod || '',
        weekend: base.eventPeriod || '',
        closed: []
      },
      venue: {
        name: venueName,
        address: venueInfo?.address || base.eventSite || 'Unknown address',
        location: venueInfo?.location,
        barrierFree: {
          wheelchair: !!venueInfo?.barrierFree?.wheelchair,
          elevator: !!venueInfo?.barrierFree?.elevator
        }
      },
      price: {
        adult: finalPrice,
        youth: 0,
        child: 0,
        free: finalPrice === 0
      },
      barrierFree: {
        wheelchair: !!venueInfo?.barrierFree?.wheelchair,
        elevator: !!venueInfo?.barrierFree?.elevator,
        braille: !!exhibitAccessibility?.braille,
        audioGuide: !!exhibitAccessibility?.audioGuide
      },
      website: base.url || '',
      artists: [],
      description,
      images: base.imageObject ? [base.imageObject] : [],
      contact: base.contactPoint || '',
      genre: base.type || 'exhibition',
      stats: { averageRating: 0, reviewCount: 0 },
      _source: 'culture_unified',
      _apiId: `${base.title}-${venueName}-${base.period.start ? base.period.start.toISOString() : ''}`
    });
  }

  console.log(
    `CNV_060 stats: total=${normalized.length}, ongoing=${ongoingItems.length}, ` +
      `selected=${filteredItems.length}, saved=${results.length}, missingLocation=${missingLocationCount}, ` +
      `braveCalls=${braveCount}`
  );

  return results;
}
