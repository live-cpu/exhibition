import JobRun from '../models/JobRun.js';

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function canRunJobToday(job, options = {}) {
  const { maxRuns = 1, force = false } = options;
  if (force) return { allowed: true, reason: 'force' };
  const dateKey = getLocalDateKey();
  const record = await JobRun.findOne({ job, dateKey }).lean();
  if (record && record.runs >= maxRuns) {
    return { allowed: false, reason: 'daily_limit', record };
  }
  return { allowed: true, reason: 'ok', record };
}

export async function recordJobRun(job, meta = {}) {
  const dateKey = getLocalDateKey();
  const now = new Date();
  return await JobRun.findOneAndUpdate(
    { job, dateKey },
    {
      $set: { lastRunAt: now, ...meta },
      $inc: { runs: 1 },
      $setOnInsert: { job, dateKey, createdAt: now }
    },
    { new: true, upsert: true }
  );
}
