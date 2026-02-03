import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Exhibition from '../models/Exhibition.js';

dotenv.config();

const noisyRegex = /(추천|가볼만한곳|놀거리|혜택|할인|코스|맛집|카페|여행|핫플|리뷰모음|헤드라인|뉴스|기사|이태원|용산|이재용|음료수|차에서)/i;

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const matches = await Exhibition.find({
    $or: [
      { title: noisyRegex },
      { description: noisyRegex }
    ]
  }).select('_id title venue.name _source').lean();

  const bySource = matches.reduce((acc, cur) => {
    const key = cur._source || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log('Noisy matches:', matches.length, bySource);
  if (matches.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const ids = matches.map((m) => m._id);
  const result = await Exhibition.deleteMany({ _id: { $in: ids } });
  console.log('Deleted:', result.deletedCount);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
