import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { repairRecentPeriods } from '../server/services/exhibitionRepair.js';

dotenv.config();

async function run() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('Missing MONGO_URI');
    }
    await mongoose.connect(process.env.MONGO_URI);
    const result = await repairRecentPeriods({ force: true });
    console.log('[repair-periods] result:', {
      checked: result.checked,
      updatedCount: result.updatedCount,
      skippedCount: result.skippedCount,
      braveCallsUsed: result.braveCallsUsed,
      skippedReason: result.skippedReason
    });
    if (result.skipped?.length) {
      console.log('[repair-periods] skipped sample:');
      result.skipped.slice(0, 10).forEach((item) => {
        console.log(`- ${item.title || item.id} (${item.reason || 'unknown'})`);
      });
    }
  } catch (error) {
    console.error('[repair-periods] failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
