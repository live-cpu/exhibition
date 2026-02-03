import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Venue from "../server/models/Venue.js";
import Exhibition from "../server/models/Exhibition.js";
import { syncAllExhibitions } from "../server/services/syncAll.js";

dotenv.config();

const MASTER_FILE = path.resolve("master_venue_list.txt");
let cachedMaster = null;

const manualVenues = [
  { name: "국립중앙박물관", openHours: "10:00 - 18:00 (수,토 ~21:00)", wheelchair: true, parking: "Y / N", accessibleToilet: true, brailleAudio: "N / Y", website: "", location: "37.524, 126.980" },
  { name: "예술의전당 (SAC)", openHours: "10:00 - 18:00 (시설별 상이)", wheelchair: true, parking: "Y / Y", accessibleToilet: true, brailleAudio: "Y / N", website: "", location: "37.483, 127.014" },
  { name: "국립아시아문화전당 (ACC)", openHours: "10:00 - 18:00 (수,토 ~20:00)", wheelchair: true, parking: "Y / N", accessibleToilet: true, brailleAudio: "Y / N", website: "", location: "35.147, 126.920" },
  { name: "국립경주박물관", openHours: "10:00 - 18:00 (토,공 ~19:00)", wheelchair: true, parking: "Y / N", accessibleToilet: true, brailleAudio: "Y / N", website: "", location: "35.829, 129.228" },
  { name: "국립광주박물관", openHours: "10:00 - 18:00", wheelchair: false, parking: "Y / N", accessibleToilet: true, brailleAudio: "N / N", website: "", location: "35.189, 126.883" },
  { name: "국립대구박물관", openHours: "09:00 - 18:00", wheelchair: true, parking: "Y / N", accessibleToilet: true, brailleAudio: "Y / Y", website: "", location: "35.845, 128.638" },
  { name: "국립김해박물관", openHours: "09:00 - 18:00", wheelchair: true, parking: "Y / N", accessibleToilet: true, brailleAudio: "Y / Y", website: "", location: "35.243, 128.872" },
  { name: "국립부여박물관", openHours: "09:00 - 18:00", wheelchair: true, parking: "Y / N", accessibleToilet: true, brailleAudio: "Y / Y", website: "", location: "36.275, 126.917" },
  { name: "국립익산박물관", openHours: "09:00 - 18:00", wheelchair: true, parking: "Y / N", accessibleToilet: true, brailleAudio: "N / N", website: "", location: "36.011, 127.028" },
  { name: "국립춘천박물관", openHours: "09:00 - 18:00", wheelchair: true, parking: "Y / N", accessibleToilet: true, brailleAudio: "Y / Y", website: "", location: "37.863, 127.752" },
  { name: "국립청주박물관", openHours: "09:00 - 18:00", wheelchair: true, parking: "Y / N", accessibleToilet: true, brailleAudio: "Y / Y", website: "", location: "36.650, 127.502" },
  { name: "대한민국역사박물관", openHours: "10:00 - 18:00 (수,토 ~21:00)", wheelchair: true, parking: "N / N", accessibleToilet: true, brailleAudio: "Y / Y", website: "", location: "37.575, 126.978" },
  { name: "국립한글박물관", openHours: "10:00 - 18:00", wheelchair: true, parking: "N / Y", accessibleToilet: true, brailleAudio: "Y / Y", website: "", location: "37.521, 126.981" },
  { name: "한국영상자료원", openHours: "10:00 - 19:00 (시네마테크)", wheelchair: true, parking: "N / Y", accessibleToilet: true, brailleAudio: "Y / N", website: "", location: "37.578, 126.890" },
  { name: "한국예술종합학교", openHours: "(공연/전시별 상이)", wheelchair: false, parking: "N / Y", accessibleToilet: false, brailleAudio: "N / N", website: "", location: "37.606, 127.054" },
  { name: "태권도진흥재단 (원원)", openHours: "10:00 - 18:00", wheelchair: true, parking: "Y / N", accessibleToilet: true, brailleAudio: "Y / Y", website: "", location: "35.938, 127.818" },
];

function parseYes(val) {
  return String(val || "").trim().toUpperCase() === "Y";
}

function parsePair(val) {
  const parts = String(val || "")
    .split("/")
    .map((p) => p.trim().toUpperCase());
  return [parts[0] === "Y", parts[1] === "Y"];
}

function extractUrl(raw) {
  if (!raw || raw === "정보없음") return "";
  const markdownMatch = /\(([^)]+)\)/.exec(raw);
  const candidate = markdownMatch ? markdownMatch[1] : raw;
  if (!candidate) return "";
  if (/^https?:\/\//i.test(candidate)) return candidate;
  return `http://${candidate}`;
}

function normalizeKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/\s+/g, "");
}

function parseLocation(raw) {
  if (!raw) return null;
  const [lat, lng] = String(raw)
    .split(",")
    .map((v) => Number(v.trim()));
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

function parseMasterFile() {
  if (cachedMaster) return cachedMaster;
  if (!fs.existsSync(MASTER_FILE)) return [];
  const lines = fs.readFileSync(MASTER_FILE, "utf-8").split(/\r?\n/).filter(Boolean);
  const [, ...rows] = lines; // drop header
  cachedMaster = rows
    .map((line) => {
      const cols = line.split("\t");
      if (cols.length < 8) return null;
      const [name, openHours, website, wheelchair, parking, toilet, brailleAudio, loc] = cols;
      const [parkingFree, parkingPaid] = parsePair(parking);
      const [braille, audioGuide] = parsePair(brailleAudio);
      return {
        name: name?.trim(),
        openHours: openHours?.trim(),
        website: extractUrl(website),
        wheelchair: parseYes(wheelchair),
        parkingFree,
        parkingPaid,
        accessibleToilet: parseYes(toilet),
        braille,
        audioGuide,
        location: parseLocation(loc),
      };
    })
    .filter(Boolean);
  return cachedMaster;
}

function buildVenueDocs() {
  const merged = new Map();
  const master = parseMasterFile();
  console.log(`Parsed venues -> manual: ${manualVenues.length}, master: ${master.length}`);
  const datasets = [manualVenues, master];
  for (const list of datasets) {
    for (const entry of list) {
      const key = normalizeKey(entry.name);
      if (merged.has(key)) continue;
      const location = parseLocation(entry.location) || entry.location || null;
      merged.set(key, {
        name: entry.name,
        region: "",
        address: "",
        location: location || { lat: 0, lng: 0 },
        openHours: entry.openHours || "",
        website: extractUrl(entry.website),
        barrierFree: {
          wheelchair: !!entry.wheelchair,
          elevator: !!entry.elevator,
          braille: !!entry.braille,
          audioGuide: !!entry.audioGuide,
          accessibleToilet: !!entry.accessibleToilet,
          parkingFree: !!entry.parkingFree,
          parkingPaid: !!entry.parkingPaid,
        },
        status: { hasCurrentExhibition: false, updatedAt: null },
        updatedAt: new Date(),
      });
    }
  }
  return Array.from(merged.values()).filter((v) => v.location?.lat && v.location?.lng);
}

async function resetAndResync() {
  await mongoose.connect(process.env.MONGO_URI);
  const dbName = mongoose.connection.db.databaseName;
  console.log(`Connected to MongoDB: ${dbName}`);

  await Exhibition.deleteMany({});
  await Venue.deleteMany({});
  console.log("Cleared exhibitions and venues");

  const docs = buildVenueDocs();
  console.log(`Venue docs to insert: ${docs.length}`);
  if (docs.length === 0) {
    throw new Error("No venue documents parsed");
  }
  await Venue.insertMany(docs);
  console.log(`Inserted venues: ${docs.length}`);

  await syncAllExhibitions({ maxNewExhibitions: Number(process.env.MAX_NEW_EXHIBITIONS || 120) });

  console.log("Resync complete");
  await mongoose.connection.close();
}

resetAndResync().catch((err) => {
  console.error(err);
  process.exit(1);
});
