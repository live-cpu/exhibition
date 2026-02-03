import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Exhibition from '../models/Exhibition.js';

dotenv.config();

const LIMIT = Number(process.env.FIX_PRIVATE_DESC_LIMIT || 500);

// 공홈 링크 (privateVenueSync.js와 동일)
const OFFICIAL_URLS = {
  '아트선재센터': 'https://artsonje.org',
  '대림미술관': 'https://www.daelimmuseum.org',
  '그라운드시소': 'https://groundseesaw.co.kr',
  '그라운드시소 서촌': 'https://groundseesaw.co.kr',
  '그라운드시소 성수': 'https://groundseesaw.co.kr',
  '그라운드시소 센트럴': 'https://groundseesaw.co.kr',
  '그라운드시소 한남': 'https://groundseesaw.co.kr',
  '그라운드시소 이동': 'https://groundseesaw.co.kr',
  '리움미술관': 'https://www.leeum.org',
  '아모레퍼시픽미술관': 'https://apma.amorepacific.com',
  '피크닉 (piknic)': 'https://piknic.kr',
  '송은 (SONGEUN)': 'https://songeun.or.kr',
  '뮤지엄산 (원주)': 'https://www.museumsan.org',
  '본태박물관 (제주)': 'http://www.bontemuseum.com',
  '제주도립미술관': 'https://jmoa.jeju.go.kr',
  '백남준아트센터 (용인)': 'https://njp.ggcf.kr',
  '이이남 스튜디오': 'http://www.leenamlee.com'
};

function extractSourceFromDescription(desc = '') {
  const lines = String(desc).split(/\n/).map(l => l.trim()).filter(Boolean);
  const tail = lines[lines.length - 1] || '';
  const m = tail.match(/출처:\s*(https?:\/\/\S+)/i);
  return m ? m[1].replace(/[)]+$/, '') : null;
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const docs = await Exhibition.find({ _source: 'private_search' })
    .select('venue.name description descriptionSource website')
    .limit(LIMIT)
    .lean();

  let updated = 0;
  for (const doc of docs) {
    const venueName = doc.venue?.name || '';
    const officialUrl = OFFICIAL_URLS[venueName] || '';
    const sourceUrl = doc.descriptionSource || extractSourceFromDescription(doc.description) || '';

    // 첫째줄: 공홈 링크, 둘째줄: 설명 출처 링크
    let newWebsite;
    if (officialUrl && sourceUrl && officialUrl !== sourceUrl) {
      newWebsite = `${officialUrl}\n${sourceUrl}`;
    } else {
      newWebsite = officialUrl || sourceUrl || doc.website || '';
    }

    // 변경이 필요한 경우만 업데이트
    if (newWebsite !== doc.website) {
      await Exhibition.updateOne(
        { _id: doc._id },
        { $set: { website: newWebsite, descriptionSource: sourceUrl || undefined } }
      );
      updated++;
      console.log(`[Updated] ${doc.venue?.name}: ${doc.website?.split('\n')[0]} → ${newWebsite.split('\n')[0]}`);
    }
  }

  await mongoose.disconnect();
  console.log(`\nUpdated ${updated}/${docs.length}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
