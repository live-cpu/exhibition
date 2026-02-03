import { canRunJobToday, recordJobRun, getLocalDateKey } from './jobRun.js';

export function startDailyScheduler(options = {}) {
  const {
    syncAllExhibitions,
    repairRecentPeriods
  } = options;

  if (typeof syncAllExhibitions !== 'function' || typeof repairRecentPeriods !== 'function') {
    console.warn('[scheduler] Missing job functions. Scheduler not started.');
    return;
  }

  const intervalMs = Number(process.env.DAILY_JOB_TICK_MS || 10 * 60 * 1000);
  const runHour = Number(process.env.DAILY_JOB_HOUR || 3);
  const runMinute = Number(process.env.DAILY_JOB_MINUTE || 0);

  let lastRunKey = null;
  let isRunning = false;

  const runJobs = async (reason) => {
    if (isRunning) return;
    isRunning = true;
    try {
      const syncGuard = await canRunJobToday('daily-sync', { maxRuns: 1 });
      if (syncGuard.allowed) {
        await syncAllExhibitions();
        await recordJobRun('daily-sync', { meta: { reason } });
      }

      await repairRecentPeriods({ force: false });
    } catch (error) {
      console.error('[scheduler] Daily jobs failed:', error.message);
    } finally {
      isRunning = false;
    }
  };

  const tick = () => {
    const now = new Date();
    const dateKey = getLocalDateKey(now);
    if (lastRunKey === dateKey) return;
    if (now.getHours() < runHour) return;
    if (now.getHours() === runHour && now.getMinutes() < runMinute) return;
    lastRunKey = dateKey;
    runJobs('scheduler');
  };

  setInterval(tick, intervalMs);
  tick();
}
