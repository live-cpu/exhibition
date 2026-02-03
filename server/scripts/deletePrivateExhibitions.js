import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Exhibition from '../models/Exhibition.js';
import PrivateCandidate from '../models/PrivateCandidate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const deleteCandidates = args.has('--delete-candidates');

const query = {
  $or: [
    { _source: 'private_search' },
    { _apiId: /^priv-/ }
  ]
};

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const count = await Exhibition.countDocuments(query);
  const samples = await Exhibition.find(query)
    .select('_id title venue.name _source _apiId')
    .limit(10)
    .lean();

  console.log('Private exhibitions matched:', count);
  if (samples.length) {
    console.log('Sample:', samples);
  }

  if (dryRun) {
    console.log('Dry run only. No deletions performed.');
    await mongoose.disconnect();
    return;
  }

  const result = await Exhibition.deleteMany(query);
  console.log('Deleted exhibitions:', result.deletedCount);

  if (deleteCandidates) {
    const candResult = await PrivateCandidate.deleteMany({});
    console.log('Deleted private candidates:', candResult.deletedCount);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
