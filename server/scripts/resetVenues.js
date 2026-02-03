import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Venue from '../models/Venue.js';
import { rawVenues } from '../seedVenues.js';
import { aliasEntries, applyVenueAlias } from '../services/venueAlias.js';

dotenv.config();

function parseGrades(grades) {
  if (!grades) return {};
  const [e, w, b] = String(grades).split('/');
  const isYes = (v) => v === 'O';
  return {
    elevator: isYes(e),
    wheelchair: isYes(w),
    braille: isYes(b)
  };
}

function buildAliasMap() {
  const map = new Map();
  for (const entry of aliasEntries) {
    map.set(entry.name, entry.variants || []);
  }
  return map;
}

async function resetVenues({ wipe = true, addAliases = true } = {}) {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('MongoDB connected');

  if (wipe) {
    await Venue.deleteMany({});
    console.log('Venue collection cleared');
  }

  const aliasMap = buildAliasMap();
  let inserted = 0;
  let updated = 0;

  for (const venue of rawVenues) {
    const canonicalName = applyVenueAlias(venue.name);
    const payload = {
      name: canonicalName,
      region: venue.region || '',
      address: venue.address || '',
      location: { lat: venue.lat, lng: venue.lng },
      openHours: venue.openHours || '',
      website: venue.website || '',
      instagramHandle: venue.instagramHandle || '',
      notes: venue.notes || '',
      barrierFree: {
        ...parseGrades(venue.grades)
      },
      updatedAt: new Date()
    };

    if (addAliases) {
      const aliases = aliasMap.get(canonicalName) || [];
      if (aliases.length) payload.aliases = aliases;
    }

    const existing = await Venue.findOne({ name: canonicalName }).lean();
    if (!existing) {
      await Venue.create(payload);
      inserted++;
    } else {
      await Venue.updateOne({ _id: existing._id }, { $set: payload });
      updated++;
    }
  }

  console.log(`Venues reset: ${inserted} inserted, ${updated} updated`);
  await mongoose.disconnect();
}

const wipe = !process.argv.includes('--no-wipe');
const addAliases = !process.argv.includes('--no-aliases');
resetVenues({ wipe, addAliases }).catch((err) => {
  console.error('Reset venues failed:', err);
  process.exit(1);
});
