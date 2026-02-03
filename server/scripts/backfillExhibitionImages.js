import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Exhibition from '../models/Exhibition.js';
import { fetchBraveImageUrls } from '../services/braveSearch.js';
import { fetchNaverSearch } from '../services/naverApi.js';

dotenv.config();

const LIMIT = Number(process.env.BACKFILL_IMAGE_LIMIT || 8);
const noisyRegex = /(추천|가볼만한곳|놀거리|혜택|할인|코스|맛집|카페|여행|핫플|리뷰모음|헤드라인|뉴스|기사|이태원|용산|이재용|음료수|차에서)/i;

function isOngoingOrUpcoming(exh, windowDays = 30) {
  if (exh.periodUnknown) return true;
  if (!exh.period?.start || !exh.period?.end) return true;
  const now = new Date();
  const start = new Date(exh.period.start);
  const end = new Date(exh.period.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return true;
  const upcoming = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  return (now >= start && now <= end) || (start > now && start <= upcoming);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const candidates = await Exhibition.find({
    $or: [ { images: { $exists: false } }, { images: { $size: 0 } } ]
  }).select('title venue.name description period periodUnknown images').lean();

  const filtered = candidates.filter((e) => {
    const text = `${e.title || ''} ${e.description || ''}`;
    if (noisyRegex.test(text)) return false;
    return isOngoingOrUpcoming(e);
  }).slice(0, LIMIT);

  console.log(`Candidates: ${filtered.length}/${candidates.length}`);

  for (const exh of filtered) {
    const query = `${exh.title} ${exh.venue?.name || ''} 전시 포스터`;
    let images = [];
    try {
      const naver = await fetchNaverSearch('image', query, { display: 2, sort: 'sim' });
      images = (naver.items || []).map((item) => item.link).filter(Boolean).slice(0, 2);
    } catch (err) {
      console.warn(`[Backfill] Naver image search failed: ${err.message}`);
    }

    if (images.length === 0) {
      images = await fetchBraveImageUrls(query, 2);
    }
    if (images.length > 0) {
      await Exhibition.updateOne({ _id: exh._id }, { $set: { images } });
      console.log(`Updated: ${exh.title}`);
    }
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
