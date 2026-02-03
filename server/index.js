import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import exhibitionsRouter from "./routes/exhibitions.js";
import reviewsRouter from "./routes/reviews.js";
import naverRouter from "./routes/naver.js";
import venuesRouter from "./routes/venues.js";
import sacRouter from "./routes/sac.js";
import Exhibition from "./models/Exhibition.js";
import Venue from "./models/Venue.js";
// 臾명솕泥댁쑁愿愿묐? ?꾩떆?뺣낫(?듯빀) API - 27媛?湲곌? (ACC, MOCA, SAC ???ы븿)
import { searchExhibitionsForVenues, syncNewVenues, resetCallCount as resetNaverCallCount } from "./services/naverExhibitionSearch.js";
import { repairRecentPeriods } from "./services/exhibitionRepair.js";
import { recordJobRun } from "./services/jobRun.js";
import { startDailyScheduler } from "./services/dailyScheduler.js";
import { syncAllExhibitions } from "./services/syncAll.js";
import { runPrivateVenueSync } from "./services/privateVenueSync.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// 1. ?뺤쟻 ?뚯씪 ?쒕튃: src ?대뜑 ?꾩껜瑜?猷⑦듃濡??≪뒿?덈떎.
app.use(express.static(path.join(__dirname, '../src')));

// MongoDB ?곌껐
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    const dbName = mongoose.connection.db.databaseName;
    console.log("??MongoDB connected");
    console.log(`?벀 Database: ${dbName}`);
    if (String(process.env.AUTO_SYNC_ON_START || "true").toLowerCase() === "true") {
      await syncAllExhibitions();
      await recordJobRun('daily-sync', { meta: { reason: 'startup' } });
    }
    startDailyScheduler({ syncAllExhibitions, repairRecentPeriods, runPrivateVenueSync });
  })
  .catch((err) => console.error("??MongoDB error:", err));

// API ?쇱슦??
app.use('/api/exhibitions', exhibitionsRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/naver', naverRouter);
app.use('/api/venues', venuesRouter);
app.use('/api/sac', sacRouter);

// 지도 API 키 제공 (클라이언트 측 지도용 - 도메인 제한 필수)
app.get('/api/config/map', (req, res) => {
  res.json({
    kakaoKey: process.env.KAKAO_MAP_KEY || '',
    googleKey: process.env.GOOGLE_MAP_KEY || ''
  });
});

// 吏꾨떒???붾뱶?ъ씤??
app.get('/api/debug/status', async (req, res) => {
  try {
    const dbName = mongoose.connection.db?.databaseName || 'not connected';
    const venueCount = await Venue.countDocuments();
    const exhibitionCount = await Exhibition.countDocuments();
    const venueNames = await Venue.find().select('name -_id').limit(10).lean();
    res.json({
      database: dbName,
      venueCount,
      exhibitionCount,
      sampleVenues: venueNames.map(v => v.name),
      mongoUri: process.env.MONGO_URI?.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') // 鍮꾨?踰덊샇 ?④?
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. 猷⑦듃 寃쎈줈 ?묒냽 ??index.html ?뚯씪 ?꾩넚
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, '../src/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`??Server: http://localhost:${PORT}`);
});

/**
 * Naver 寃??湲곕컲 ?꾩떆 ?숆린??
 * - 怨듦났?곗씠??API蹂대떎 ?곗꽑?쒖쐞 ??쓬
 * - Brave蹂대떎 ?곗꽑?쒖쐞 ?믪쓬
 * - ?몄텧 ?쒗븳 ?곸슜
 */
async function syncNaverExhibitions() {
  try {
    resetNaverCallCount();

    // DB?먯꽌 ?꾩옱 ?꾩떆媛 ?녿뒗 venue 紐⑸줉 媛?몄삤湲?
    const venuesWithoutExhibitions = await Venue.find({
      'status.hasCurrentExhibition': { $ne: true }
    }).select('name').limit(10).lean();

    if (venuesWithoutExhibitions.length === 0) {
      console.log("[NaverSync] All venues have exhibitions, skipping...");
      return;
    }

    const venueNames = venuesWithoutExhibitions.map(v => v.name);
    console.log(`[NaverSync] Searching for ${venueNames.length} venues...`);

    // Naver 寃?됱쑝濡??꾩떆 ?뺣낫 ?섏쭛
    const exhibitions = await searchExhibitionsForVenues(venueNames, { maxVenues: 3 });

    if (exhibitions.length === 0) {
      console.log("[NaverSync] No exhibitions found");
      return;
    }

    // ?덈줈??venue 異붽?
    const addedVenues = await syncNewVenues(exhibitions);
    console.log(`[NaverSync] Added ${addedVenues} new venues`);

    // 寃?됰맂 ?꾩떆瑜?DB?????(?꾩튂 ?뺣낫媛 ?덈뒗 寃껊쭔)
    let savedCount = 0;
    const now = new Date();

    const noisyRegex = /(추천|가볼만한곳|놀거리|혜택|할인|코스|맛집|카페|여행|핫플|리뷰모음|헤드라인|뉴스|기사|이태원|용산|이재용|음료수|차에서)/i;

    for (const exhibition of exhibitions) {
      const noisyText = `${exhibition.title || ''} ${exhibition.description || ''}`;
      if (noisyRegex.test(noisyText)) {
        continue;
      }
      // venue ?뺣낫 ?뺤씤
      const venue = await Venue.findOne({ name: exhibition.venueName }).lean();
      if (!venue?.location?.lat || !venue?.location?.lng) {
        continue; // ?꾩튂 ?뺣낫 ?놁쑝硫??ㅽ궢
      }

      // 湲곌컙 誘몄젙?대㈃ periodUnknown ?ㅼ젙
      const hasPeriod = exhibition.period?.start && exhibition.period?.end;

      // 以묐났 ?뺤씤
      const existing = await Exhibition.findOne({
        _source: 'naver_search',
        title: exhibition.title,
        'venue.name': exhibition.venueName
      });

      if (existing) continue;

      // ???
      await Exhibition.create({
        title: exhibition.title,
        period: {
          start: exhibition.period?.start || now,
          end: exhibition.period?.end || new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
        },
        periodUnknown: !hasPeriod,
        venue: {
          name: venue.name,
          address: venue.address || venue.name || '二쇱냼 ?뺣낫 ?놁쓬',
          location: venue.location
        },
        description: exhibition.description || '',
        website: exhibition.sourceUrl || '',
        barrierFree: {
          wheelchair: !!venue.barrierFree?.wheelchair,
          elevator: !!venue.barrierFree?.elevator,
          braille: !!venue.barrierFree?.braille,
          audioGuide: false
        },
        price: { adult: 0, youth: 0, child: 0, free: true },
        images: [],
        artists: [],
        stats: { averageRating: 0, reviewCount: 0 },
        _source: 'naver_search',
        _apiId: `naver-${exhibition.title}-${exhibition.venueName}`
      });

      savedCount++;
    }

    console.log(`[NaverSync] Saved ${savedCount} exhibitions from Naver search`);

  } catch (err) {
    console.error("[NaverSync] Error:", err.message);
  }
}
