import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Exhibition from '../server/models/Exhibition.js';

dotenv.config();

const mongoUri = process.env.MONGO_URI;

async function resetExhibitions() {
  if (!mongoUri) {
    console.error('MONGO_URI is not set in .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
    const result = await Exhibition.deleteMany({});
    console.log(`Deleted ${result.deletedCount} exhibitions`);
  } catch (err) {
    console.error('Failed to reset exhibitions:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

resetExhibitions();
