import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Exhibition from '../models/Exhibition.js';
import Venue from '../models/Venue.js';
import { applyVenueAlias } from '../services/venueAlias.js';

dotenv.config();

async function reportMissingVenues() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('MongoDB connected');

  const exhibitionVenueNames = await Exhibition.distinct('venue.name');
  const venueNames = await Venue.distinct('name');

  const venueSet = new Set(venueNames.map((name) => applyVenueAlias(name)));
  const missing = new Map();

  for (const rawName of exhibitionVenueNames) {
    const normalized = applyVenueAlias(rawName);
    if (!venueSet.has(normalized)) {
      const count = missing.get(normalized) || { count: 0, examples: new Set() };
      count.count += 1;
      count.examples.add(rawName);
      missing.set(normalized, count);
    }
  }

  const result = Array.from(missing.entries())
    .map(([name, info]) => ({
      name,
      occurrences: info.count,
      examples: Array.from(info.examples).slice(0, 5)
    }))
    .sort((a, b) => b.occurrences - a.occurrences);

  console.log(`Missing venues: ${result.length}`);
  result.forEach((item, idx) => {
    console.log(`${idx + 1}. ${item.name} (${item.occurrences}) -> ${item.examples.join(' | ')}`);
  });

  await mongoose.disconnect();
}

reportMissingVenues().catch((err) => {
  console.error('Report missing venues failed:', err);
  process.exit(1);
});
