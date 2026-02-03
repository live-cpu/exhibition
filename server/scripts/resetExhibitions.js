/**
 * 전시 데이터 초기화 스크립트
 * MongoDB에서 모든 전시 데이터를 삭제합니다.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function resetExhibitions() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;

    // 전시 컬렉션 삭제
    const exhibitionResult = await db.collection('exhibitions').deleteMany({});
    console.log(`Deleted ${exhibitionResult.deletedCount} exhibitions`);

    // JobRun 컬렉션도 초기화 (선택)
    const jobRunResult = await db.collection('jobruns').deleteMany({});
    console.log(`Deleted ${jobRunResult.deletedCount} job runs`);

    console.log('Reset completed!');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

resetExhibitions();
