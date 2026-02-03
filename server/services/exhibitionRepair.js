import Exhibition from '../models/Exhibition.js';
import { fetchBraveExhibitionPeriod } from './braveSearch.js';
import { canRunJobToday, recordJobRun } from './jobRun.js';

const DEFAULT_REPAIR_LIMIT = Number(process.env.PERIOD_REPAIR_LIMIT || 5);
const DEFAULT_BRAVE_LIMIT = Number(process.env.PERIOD_REPAIR_BRAVE_LIMIT || 5);
const DEFAULT_DAILY_RUNS = Number(process.env.PERIOD_REPAIR_MAX_PER_DAY || 1);

export async function repairRecentPeriods(options = {}) {
  const {
    sources = ['unified_exhibition_api', 'seoul_api', 'culture_unified'],
    limit = DEFAULT_REPAIR_LIMIT,
    braveLimit = DEFAULT_BRAVE_LIMIT,
    force = false
  } = options;

  const guard = await canRunJobToday('repair-periods', {
    maxRuns: DEFAULT_DAILY_RUNS,
    force
  });
  if (!guard.allowed) {
    return {
      checked: 0,
      updatedCount: 0,
      skippedCount: 0,
      braveCallsUsed: 0,
      updated: [],
      skipped: [],
      skippedReason: guard.reason
    };
  }

  const cappedLimit = Math.min(Number(limit) || DEFAULT_REPAIR_LIMIT, DEFAULT_REPAIR_LIMIT);
  const targets = await Exhibition.find({
    _source: { $in: sources },
    $or: [
      { periodUnknown: true },
      { 'period.start': { $exists: false } },
      { 'period.end': { $exists: false } }
    ]
  })
    .sort({ createdAt: -1 })
    .limit(cappedLimit)
    .lean();

  const updated = [];
  const skipped = [];
  let braveCallsUsed = 0;

  for (const exhibition of targets) {
    if (braveCallsUsed >= braveLimit) {
      skipped.push({ id: exhibition._id, reason: 'brave_limit' });
      continue;
    }
    braveCallsUsed += 1;
    const venueName = exhibition?.venue?.name ? String(exhibition.venue.name).trim() : '';
    const query = venueName
      ? `"${exhibition.title}" "${venueName}" exhibition period`
      : `"${exhibition.title}" exhibition period`;
    const period = await fetchBraveExhibitionPeriod(query);
    if (!period?.start || !period?.end) {
      skipped.push({ id: exhibition._id, title: exhibition.title, reason: 'no_period' });
      continue;
    }

    await Exhibition.updateOne(
      { _id: exhibition._id },
      {
        $set: {
          period: { start: period.start, end: period.end },
          periodUnknown: false
        }
      }
    );
    updated.push({ id: exhibition._id, title: exhibition.title });
  }

  await recordJobRun('repair-periods', {
    meta: {
      checked: targets.length,
      updatedCount: updated.length,
      skippedCount: skipped.length,
      braveCallsUsed
    }
  });

  return {
    checked: targets.length,
    updatedCount: updated.length,
    skippedCount: skipped.length,
    braveCallsUsed,
    updated,
    skipped
  };
}
