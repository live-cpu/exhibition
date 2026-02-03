import fs from 'fs';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Venue from '../server/models/Venue.js';
import { normalizeVenueNameAdvanced, applyVenueAlias } from '../server/services/venueAlias.js';

dotenv.config();

const FILE_PATH = process.argv[2] || 'KC_DSPSN_CLTUR_ART_TRRSRT_2023-2.csv';

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function yes(val) {
  return String(val || '').trim().toUpperCase() === 'Y';
}

function toNumber(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  if (!fs.existsSync(FILE_PATH)) {
    console.error('CSV file not found:', FILE_PATH);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to Mongo');

  const text = fs.readFileSync(FILE_PATH, 'utf-8');
  const lines = text.split(/\r?\n/);

  let headers = [];
  let count = 0;
  let matched = 0;
  let created = 0;
  let skipped = 0;

  const venueDocs = await Venue.find().lean();
  const venueMap = new Map();
  for (const v of venueDocs) {
    const key = applyVenueAlias(normalizeVenueNameAdvanced(v.name)) || v.name;
    venueMap.set(key, v);
  }

  const bulkOps = [];
  const createDocs = [];

  for (const line of lines) {
    const parsed = parseCsvLine(line).map((h) => h.trim());
    if (!headers.length) {
      if (!parsed.includes('FCLTY_NM')) {
        continue; // skip preamble/header in Korean
      }
      headers = parsed;
      continue;
    }
    if (!line.trim()) continue;
    const cols = parsed;
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx];
    });

    count += 1;

    const rawName = row.FCLTY_NM || row['시설명'] || '';
    const norm = applyVenueAlias(normalizeVenueNameAdvanced(rawName));
    const name = norm || rawName.trim();
    if (!name) {
      skipped += 1;
      continue;
    }

    const lat = toNumber(row.LAT || row.lat || row.Y || row.y);
    const lng = toNumber(row.LOT || row.lon || row.LON || row.X || row.x);
    const location = lat !== null && lng !== null ? { lat, lng } : null;
    const openHours = [row.OPERT_TIME, row.OPER_TIME].filter(Boolean).join(' / ');

    const barrierFree = {
      wheelchair: yes(row.WCHAIR_HOLD_AT),
      parkingFree: yes(row.FRE_PARKNG_AT),
      parkingPaid: yes(row.CHGD_PARKNG_AT),
      accessibleToilet: yes(row.DSPSN_TOILET_AT),
      guideDog: yes(row.GUID_DOG_ACP_POSBL_AT),
      braille: yes(row.BRLL_GUID_AT),
      audioGuide: yes(row.KLANG_VIC_GUID_AT)
    };

    const existing = venueMap.get(name);
    if (!existing) {
      if (!location) {
        skipped += 1;
        continue;
      }
      createDocs.push({
        name,
        region: '',
        address: row.RDNMADR || row.ADRES || name,
        location,
        openHours,
        website: row.HMPG_URL || '',
        barrierFree,
        updatedAt: new Date()
      });
      created += 1;
      continue;
    }

    const update = {};
    if (location && !(existing.location?.lat && existing.location?.lng)) {
      update.location = location;
    }
    if (openHours && !existing.openHours) {
      update.openHours = openHours;
    }
    if (row.HMPG_URL && !existing.website) {
      update.website = row.HMPG_URL;
    }
    const bfMerge = {
      ...existing.barrierFree,
      ...Object.fromEntries(Object.entries(barrierFree).filter(([, v]) => v === true))
    };
    if (JSON.stringify(bfMerge) !== JSON.stringify(existing.barrierFree)) {
      update.barrierFree = bfMerge;
    }
    if (Object.keys(update).length) {
      update.updatedAt = new Date();
      bulkOps.push({
        updateOne: { filter: { _id: existing._id }, update: { $set: update } }
      });
    }
    matched += 1;
  }

  if (createDocs.length) {
    await Venue.insertMany(createDocs);
  }
  if (bulkOps.length) {
    await Venue.bulkWrite(bulkOps, { ordered: false });
  }

  console.log({ totalRows: count, matched, created, skipped, updated: bulkOps.length });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
