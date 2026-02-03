import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Exhibition from '../models/Exhibition.js';
import Venue from '../models/Venue.js';
import { fetchUnifiedExhibitions } from '../services/unifiedExhibitionApi.js';
import { fetchSeoulCultureExhibitions } from '../services/semaApi.js';
import { fetchUnifiedCultureExhibitions } from '../services/cultureUnifiedApi.js';
import { fetchMocaExhibitions } from '../services/mocaApi.js';
import { fetchDaeguDgfcaExhibitions } from '../services/daeguApi.js';
import { fetchGgCultureExhibitions } from '../services/ggCultureApi.js';

dotenv.config();

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

function sanitizeText(text) {
  return decodeHtmlEntities(stripHtml(text));
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[\s\W]+/g, '')
    .trim();
}

async function syncVenueExhibitions(source, fetchFn, options = {}) {
  const apiExhibitions = await fetchFn();
  let syncedCount = 0;
  let updatedCount = 0;
  let removedCount = 0;
  let skippedCount = 0;

  const now = new Date();
  const skipVenueNames = options.skipVenueNames || new Set();
  const preferredSources = options.preferredSources || new Set();
  const skipIfPreferredMatch = preferredSources.size > 0 && !preferredSources.has(source);

  for (const apiExhibition of apiExhibitions) {
    if (!apiExhibition) continue;

    if (apiExhibition.title) {
      apiExhibition.title = sanitizeText(apiExhibition.title);
    }
    if (apiExhibition.description) {
      apiExhibition.description = sanitizeText(apiExhibition.description);
    }

    const start = apiExhibition.period?.start ? new Date(apiExhibition.period.start) : null;
    const end = apiExhibition.period?.end ? new Date(apiExhibition.period.end) : null;

    const isOngoing = apiExhibition.periodUnknown
      ? true
      : start && end && now >= start && now <= end;

    const existing = await Exhibition.findOne({
      _source: source,
      _apiId: apiExhibition._apiId
    }).lean();

    const venueName = apiExhibition.venue?.name || '';
    const venueKey = normalizeKey(venueName);
    const titleKey = normalizeKey(apiExhibition.title || '');
    if (venueKey && skipVenueNames.has(venueKey)) {
      skippedCount++;
      continue;
    }

    if (skipIfPreferredMatch && apiExhibition.title && venueName) {
      const existingPreferred = await Exhibition.findOne({
        _source: { $in: Array.from(preferredSources) },
        $or: [
          { titleKey, venueKey },
          { title: apiExhibition.title, 'venue.name': venueName }
        ]
      }).lean();
      if (existingPreferred) {
        skippedCount++;
        continue;
      }
    }

    if (!isOngoing) {
      if (existing) {
        await Exhibition.deleteOne({ _id: existing._id });
        removedCount++;
      }
      continue;
    }

    if (apiExhibition.venue?.name) {
      const venue = await Venue.findOne({ name: apiExhibition.venue.name }).lean();
      if (venue?.openHours) {
        apiExhibition.openHours = {
          weekday: venue.openHours,
          weekend: venue.openHours,
          closed: []
        };
      }
    }

    if (existing) {
      await Exhibition.findByIdAndUpdate(existing._id, {
        ...apiExhibition,
        titleKey,
        venueKey,
        stats: existing.stats
      });
      updatedCount++;
    } else {
      await Exhibition.create({
        ...apiExhibition,
        titleKey,
        venueKey
      });
      syncedCount++;
    }
  }

  return { source, syncedCount, updatedCount, removedCount, skippedCount };
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};

  const results = [];
  results.push(await syncVenueExhibitions('unified_exhibition_api', fetchUnifiedExhibitions, {
    preferredSources: new Set(['unified_exhibition_api'])
  }));

  results.push(await syncVenueExhibitions('seoul_api', fetchSeoulCultureExhibitions, {
    preferredSources: new Set(['unified_exhibition_api', 'seoul_api'])
  }));

  const protectedVenueKeys = new Set();
  const protectedSources = await Exhibition.find({ _source: { $in: ['unified_exhibition_api', 'seoul_api'] } })
    .select('venueKey -_id')
    .lean();
  for (const item of protectedSources) {
    if (item.venueKey) protectedVenueKeys.add(item.venueKey);
  }
  results.push(await syncVenueExhibitions('culture_unified', fetchUnifiedCultureExhibitions, {
    skipVenueNames: protectedVenueKeys,
    preferredSources: new Set(['unified_exhibition_api', 'seoul_api'])
  }));

  results.push(await syncVenueExhibitions('moca', fetchMocaExhibitions, {
    preferredSources: new Set(['unified_exhibition_api', 'seoul_api', 'culture_unified'])
  }));

  results.push(await syncVenueExhibitions('daegu_dgfca', fetchDaeguDgfcaExhibitions, {
    preferredSources: new Set(['unified_exhibition_api', 'seoul_api', 'culture_unified', 'moca'])
  }));

  results.push(await syncVenueExhibitions('ggcultur', fetchGgCultureExhibitions, {
    preferredSources: new Set(['unified_exhibition_api', 'seoul_api', 'culture_unified', 'moca', 'daegu_dgfca'])
  }));

  console.log = originalLog;
  console.warn = originalWarn;
  console.log('=== Manual sync complete ===');
  for (const r of results) {
    console.log(`[${r.source}] new=${r.syncedCount}, updated=${r.updatedCount}, removed=${r.removedCount}, skipped=${r.skippedCount}`);
  }
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
