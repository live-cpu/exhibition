import Exhibition from "../models/Exhibition.js";
import Venue from "../models/Venue.js";
import { fetchUnifiedExhibitions } from "./unifiedExhibitionApi.js";
import { fetchSeoulCultureExhibitions } from "./semaApi.js";
import { fetchUnifiedCultureExhibitions } from "./cultureUnifiedApi.js";
import { fetchDaeguDgfcaExhibitions } from "./daeguApi.js";
import { fetchGgCultureExhibitions } from "./ggCultureApi.js";
import { fetchBraveDescription, fetchBraveImageUrls } from "./braveSearch.js";
import { enrichFromUrl } from "./exhibitionEnrich.js";

function stripHtml(text) {
  if (!text) return "";
  return String(text).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(text) {
  if (!text) return "";
  return String(text)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function sanitizeText(text) {
  return decodeHtmlEntities(stripHtml(text));
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/[\s\W]+/g, "")
    .trim();
}

function isPlaceholderImage(url) {
  if (!url) return false;
  const str = String(url).toLowerCase();
  return str.includes("images.unsplash.com") || str.includes("unsplash.com");
}

export async function syncVenueExhibitions(
  source,
  fetchFn,
  querySuffix,
  options = {}
) {
  try {
    const apiExhibitions = await fetchFn();
    let syncedCount = 0;
    let updatedCount = 0;
    let removedCount = 0;
    let skippedCount = 0;
    let braveDescriptionRemaining = Number(
      process.env.BRAVE_DESCRIPTION_LIMIT || 5
    );
    let braveImageRemaining = Number(process.env.BRAVE_IMAGE_LIMIT || 3);
    const braveDescriptionEnabled =
      String(process.env.BRAVE_ENABLED ?? "true").toLowerCase() === "true";
    let enrichRemaining = Number(
      process.env.ENRICH_MAX_CALLS_PER_RUN || 20
    );
    const maxNewExhibitions = Number(
      options.maxNewExhibitions || process.env.MAX_NEW_EXHIBITIONS || 120
    );

    const now = new Date();
    const skipVenueNames = options.skipVenueNames || new Set();
    const preferredSources = options.preferredSources || new Set();
    const skipIfPreferredMatch =
      preferredSources.size > 0 && !preferredSources.has(source);

    for (const apiExhibition of apiExhibitions) {
      if (!apiExhibition) continue;

      if (syncedCount >= maxNewExhibitions) {
        skippedCount++;
        continue;
      }

      if (apiExhibition.title) {
        apiExhibition.title = sanitizeText(apiExhibition.title);
      }
      if (apiExhibition.description) {
        apiExhibition.description = sanitizeText(apiExhibition.description);
      }

      if (apiExhibition.openHours) {
        delete apiExhibition.openHours;
      }
      const start = apiExhibition.period?.start
        ? new Date(apiExhibition.period.start)
        : null;
      const end = apiExhibition.period?.end
        ? new Date(apiExhibition.period.end)
        : null;

      const isOngoing = apiExhibition.periodUnknown
        ? true
        : start && end && now >= start && now <= end;

      const existing = await Exhibition.findOne({
        _source: source,
        _apiId: apiExhibition._apiId,
      }).lean();
      const existingImages = Array.isArray(existing?.images)
        ? existing.images
        : [];
      const hasExistingRealImage = existingImages.some(
        (url) => url && !isPlaceholderImage(url)
      );

      if (
        !apiExhibition.description &&
        apiExhibition.title &&
        braveDescriptionEnabled &&
        braveDescriptionRemaining > 0
      ) {
        const query = `${apiExhibition.title} ${querySuffix} exhibition description`;
        const braveDescription = await fetchBraveDescription(query);
        if (braveDescription) {
          apiExhibition.description = braveDescription;
        }
        braveDescriptionRemaining -= 1;
      }

      if (
        enrichRemaining > 0 &&
        apiExhibition.website &&
        (!apiExhibition.description ||
          !apiExhibition.price ||
          (apiExhibition.price?.free === false &&
            apiExhibition.price?.adult === 0))
      ) {
        const enriched = await enrichFromUrl(apiExhibition.website);
        if (!apiExhibition.description && enriched.description) {
          apiExhibition.description = enriched.description;
        }
        if (!apiExhibition.price && enriched.price) {
          apiExhibition.price = enriched.price;
        }
        if (apiExhibition.price?.adult === 0 && enriched.price) {
          apiExhibition.price = enriched.price;
        }
        enrichRemaining -= 1;
      }

      const hasApiImages =
        Array.isArray(apiExhibition.images) &&
        apiExhibition.images.length > 0;
      if (
        !hasApiImages &&
        !hasExistingRealImage &&
        apiExhibition.title &&
        braveDescriptionEnabled &&
        braveImageRemaining > 0
      ) {
        const query = `${apiExhibition.title} 전시 포스터`;
        const images = await fetchBraveImageUrls(query, 2);
        if (images.length > 0) {
          apiExhibition.images = images;
        }
        braveImageRemaining -= 1;
      }

      if (apiExhibition.venue?.name) {
        const venue = await Venue.findOne({
          name: apiExhibition.venue.name,
        }).lean();
        if (venue?.openHours) {
          apiExhibition.openHours = {
            weekday: venue.openHours,
            weekend: venue.openHours,
            closed: [],
          };
        }
      }

      const venueName = apiExhibition.venue?.name || "";
      const venueKey = normalizeKey(venueName);
      const titleKey = normalizeKey(apiExhibition.title || "");
      if (venueKey && skipVenueNames.has(venueKey)) {
        skippedCount++;
        continue;
      }

      if (skipIfPreferredMatch && apiExhibition.title && venueName) {
        const existingPreferred = await Exhibition.findOne({
          _source: { $in: Array.from(preferredSources) },
          $or: [
            { titleKey, venueKey },
            { title: apiExhibition.title, "venue.name": venueName },
          ],
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

      if (existing) {
        await Exhibition.findByIdAndUpdate(existing._id, {
          ...apiExhibition,
          titleKey,
          venueKey,
          stats: existing.stats,
        });
        updatedCount++;
      } else {
        await Exhibition.create({
          ...apiExhibition,
          titleKey,
          venueKey,
        });
        syncedCount++;
      }
    }

    console.log(
      `[${source}] Synced: ${syncedCount} new, ${updatedCount} updated, ${removedCount} removed, ${skippedCount} skipped (limit: ${maxNewExhibitions})`
    );
  } catch (err) {
    console.error(`[${source}] Sync failed:`, err.message);
  }
}

export async function syncAllExhibitions(options = {}) {
  const { maxNewExhibitions } = options;
  console.log("=== Auto sync ===");

  console.log("[1/5] Unified Exhibition API...");
  await syncVenueExhibitions(
    "unified_exhibition_api",
    fetchUnifiedExhibitions,
    "exhibition",
    {
      preferredSources: new Set(["unified_exhibition_api"]),
      maxNewExhibitions,
    }
  );

  console.log("[2/5] Seoul Culture API...");
  await syncVenueExhibitions(
    "seoul_api",
    fetchSeoulCultureExhibitions,
    "seoul",
    {
      preferredSources: new Set([
        "unified_exhibition_api",
        "seoul_api",
      ]),
      maxNewExhibitions,
    }
  );

  console.log("[3/5] Culture Portal Unified API...");
  const protectedVenueKeys = new Set();
  const protectedSources = await Exhibition.find({
    _source: { $in: ["unified_exhibition_api", "seoul_api"] },
  })
    .select("venueKey -_id")
    .lean();
  for (const item of protectedSources) {
    if (item.venueKey) protectedVenueKeys.add(item.venueKey);
  }
  await syncVenueExhibitions(
    "culture_unified",
    fetchUnifiedCultureExhibitions,
    "culture",
    {
      skipVenueNames: protectedVenueKeys,
      preferredSources: new Set([
        "unified_exhibition_api",
        "seoul_api",
      ]),
      maxNewExhibitions,
    }
  );

  console.log("[4/5] Daegu DGFCA...");
  await syncVenueExhibitions(
    "daegu_dgfca",
    fetchDaeguDgfcaExhibitions,
    "daegu",
    {
      preferredSources: new Set([
        "unified_exhibition_api",
        "seoul_api",
        "culture_unified",
      ]),
      maxNewExhibitions,
    }
  );

  console.log("[5/5] Gyeonggi culture...");
  await syncVenueExhibitions(
    "ggcultur",
    fetchGgCultureExhibitions,
    "ggcultur",
    {
      preferredSources: new Set([
        "unified_exhibition_api",
        "seoul_api",
        "culture_unified",
        "daegu_dgfca",
      ]),
      maxNewExhibitions,
    }
  );

  console.log("=== Sync completed ===");
}
