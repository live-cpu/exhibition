import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Venue from '../models/Venue.js';
import { enrichVenueWithBarrierFree, isKorWithApiAvailable } from '../services/korWithService.js';

dotenv.config();

// 한국관광공사 API는 429가 잦으므로 기본 배치/지연을 보수적으로 낮춤
const BATCH = Number(process.env.BARRIER_FREE_ENRICH_BATCH || 3);
const DELAY_MS = Number(process.env.BARRIER_FREE_ENRICH_DELAY_MS || 4000);
const COOL_OFF_MS = Number(process.env.BARRIER_FREE_ENRICH_COOLOFF_MS || 60000); // 연속 실패 시 휴식

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runBatch() {
  const venues = await Venue.find({
    'barrierFree._source': { $ne: 'korwith' },
    $or: [
      { 'barrierFree.wheelchair': { $exists: false } },
      { 'barrierFree.wheelchair': false, 'barrierFree.elevator': false, 'barrierFree.accessibleToilet': false }
    ]
  })
    .select('name openHours location barrierFree')
    .limit(BATCH)
    .lean();
  if (!venues.length) return { done: true, updated: 0, skipped: 0 };

  let updated = 0, skipped = 0;
  let consecutiveFail = 0;
  for (const v of venues) {
    try {
      const res = await enrichVenueWithBarrierFree(v.name);
      if (!res) { skipped++; continue; }

      const updates = {};
      if (res.openHours) updates.openHours = res.openHours;
      if (res.location) updates.location = res.location;
      if (res.barrierFree) {
        updates.barrierFree = { ...(v.barrierFree || {}), ...res.barrierFree, _source: 'korwith' };
      }

      if (Object.keys(updates).length > 0) {
        await Venue.updateOne({ _id: v._id }, { $set: updates });
        updated++;
        consecutiveFail = 0;
      } else {
        skipped++;
        consecutiveFail++;
      }
    } catch (e) {
      console.warn(`[korwith] fail ${v.name}: ${e.message}`);
      skipped++;
      consecutiveFail++;
    }
    if (consecutiveFail >= 3) {
      console.warn(`[korwith] ${consecutiveFail} consecutive failures, cooling off ${COOL_OFF_MS}ms`);
      await sleep(COOL_OFF_MS);
      consecutiveFail = 0;
    } else {
      await sleep(DELAY_MS);
    }
  }

  return { done: false, updated, skipped };
}

async function run() {
  if (!isKorWithApiAvailable()) {
    console.log('KOR_WITH_API_KEY not set');
    return;
  }
  await mongoose.connect(process.env.MONGO_URI);
  let totalUpdated = 0, totalSkipped = 0, iterations = 0;
  while (true) {
    const { done, updated, skipped } = await runBatch();
    totalUpdated += updated;
    totalSkipped += skipped;
    iterations++;
    console.log(`batch ${iterations}: updated ${updated}, skipped ${skipped}`);
    if (done) break;
  }
  await mongoose.disconnect();
  console.log(`done. updated ${totalUpdated}, skipped ${totalSkipped}`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
