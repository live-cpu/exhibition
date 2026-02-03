import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Venue from '../server/models/Venue.js';

dotenv.config();

const rawVenues = [
  {
    name: '뮤지엄 산',
    openHours: '10:00-18:00 (월 휴무)',
    website: '',
    barrierFree: {
      wheelchair: true,
      parkingFree: true,
      parkingPaid: false,
      accessibleToilet: true,
      braille: true,
      audioGuide: true
    },
    location: { lat: 37.415, lng: 127.823 }
  },
  {
    name: '리움미술관',
    openHours: '10:00-18:00 (월 휴무)',
    website: '',
    barrierFree: {
      wheelchair: true,
      parkingFree: true,
      parkingPaid: false,
      accessibleToilet: true,
      braille: true,
      audioGuide: true
    },
    location: { lat: 37.539, lng: 126.999 }
  },
  {
    name: '아모레퍼시픽미술관',
    openHours: '10:00-18:00 (월 휴무)',
    website: '',
    barrierFree: {
      wheelchair: true,
      parkingFree: true,
      parkingPaid: true,
      accessibleToilet: true,
      braille: true,
      audioGuide: true
    },
    location: { lat: 37.528, lng: 126.968 }
  },
  {
    name: '대림미술관',
    openHours: '11:00-20:00 (월,화 휴무)',
    website: '',
    barrierFree: {
      wheelchair: true,
      parkingFree: false,
      parkingPaid: false,
      accessibleToilet: true,
      braille: false,
      audioGuide: true
    },
    location: { lat: 37.577, lng: 126.973 }
  },
  {
    name: '송은(SONGEUN)',
    openHours: '11:00-18:30 (일 휴무)',
    website: '',
    barrierFree: {
      wheelchair: true,
      parkingFree: false,
      parkingPaid: true,
      accessibleToilet: true,
      braille: false,
      audioGuide: false
    },
    location: { lat: 37.524, lng: 127.044 }
  },
  {
    name: '일민미술관',
    openHours: '11:00-19:00 (월 휴무)',
    website: '',
    barrierFree: {
      wheelchair: true,
      parkingFree: false,
      parkingPaid: true,
      accessibleToilet: true,
      braille: false,
      audioGuide: false
    },
    location: { lat: 37.569, lng: 126.977 }
  },
  {
    name: '아트선재센터',
    openHours: '12:00-19:00 (월 휴무)',
    website: '',
    barrierFree: {
      wheelchair: true,
      parkingFree: false,
      parkingPaid: false,
      accessibleToilet: true,
      braille: false,
      audioGuide: false
    },
    location: { lat: 37.579, lng: 126.981 }
  },
  {
    name: '피크닉(piknic)',
    openHours: '10:00-18:00 (월 휴무)',
    website: '',
    barrierFree: {
      wheelchair: false,
      parkingFree: false,
      parkingPaid: true,
      accessibleToilet: false,
      braille: false,
      audioGuide: false
    },
    location: { lat: 37.556, lng: 126.978 }
  },
  {
    name: '그라운드시소 서촌',
    openHours: '10:00-19:00',
    website: '',
    barrierFree: {
      wheelchair: false,
      parkingFree: false,
      parkingPaid: false,
      accessibleToilet: true,
      braille: false,
      audioGuide: false
    },
    location: { lat: 37.577, lng: 126.972 }
  },
  {
    name: '그라운드시소 성수',
    openHours: '10:00-19:00',
    website: '',
    barrierFree: {
      wheelchair: true,
      parkingFree: false,
      parkingPaid: true,
      accessibleToilet: true,
      braille: false,
      audioGuide: false
    },
    location: { lat: 37.546, lng: 127.065 }
  },
  {
    name: '그라운드시소 센트럴',
    openHours: '10:30-19:00 (백화점 휴무)',
    website: '',
    barrierFree: {
      wheelchair: true,
      parkingFree: false,
      parkingPaid: true,
      accessibleToilet: true,
      braille: true,
      audioGuide: false
    },
    location: { lat: 37.564, lng: 126.981 }
  },
  {
    name: '국제갤러리(서울)',
    openHours: '10:00-18:00 (일/공휴일 17시)',
    website: '',
    barrierFree: {
      wheelchair: true,
      parkingFree: false,
      parkingPaid: true,
      accessibleToilet: true,
      braille: false,
      audioGuide: false
    },
    location: { lat: 37.58, lng: 126.98 }
  },
  {
    name: '세화미술관',
    openHours: '10:00-18:00 (월 휴무)',
    website: '',
    barrierFree: {
      wheelchair: true,
      parkingFree: false,
      parkingPaid: true,
      accessibleToilet: true,
      braille: false,
      audioGuide: true
    },
    location: { lat: 37.569, lng: 126.972 }
  }
];

function isEmpty(value) {
  return value === null || value === undefined || value === '';
}

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');

    let inserted = 0;
    let updated = 0;

    for (const venue of rawVenues) {
      const existing = await Venue.findOne({ name: venue.name }).lean();
      if (!existing) {
        await Venue.create({
          name: venue.name,
          region: '',
          address: '',
          location: venue.location,
          openHours: venue.openHours,
          website: venue.website,
          notes: '',
          barrierFree: venue.barrierFree,
          updatedAt: new Date()
        });
        inserted += 1;
        continue;
      }

      const set = {};
      if ((!existing.location?.lat || !existing.location?.lng) && venue.location) {
        set.location = venue.location;
      }
      if (isEmpty(existing.openHours) && venue.openHours) set.openHours = venue.openHours;
      if (isEmpty(existing.website) && venue.website) set.website = venue.website;

      const bf = {};
      if (typeof existing.barrierFree?.wheelchair === 'undefined') bf.wheelchair = !!venue.barrierFree?.wheelchair;
      if (typeof existing.barrierFree?.elevator === 'undefined') bf.elevator = !!venue.barrierFree?.elevator;
      if (typeof existing.barrierFree?.braille === 'undefined') bf.braille = !!venue.barrierFree?.braille;
      if (typeof existing.barrierFree?.audioGuide === 'undefined') bf.audioGuide = !!venue.barrierFree?.audioGuide;
      if (typeof existing.barrierFree?.accessibleToilet === 'undefined') {
        bf.accessibleToilet = !!venue.barrierFree?.accessibleToilet;
      }
      if (typeof existing.barrierFree?.parkingFree === 'undefined') bf.parkingFree = !!venue.barrierFree?.parkingFree;
      if (typeof existing.barrierFree?.parkingPaid === 'undefined') bf.parkingPaid = !!venue.barrierFree?.parkingPaid;

      if (Object.keys(bf).length) {
        set.barrierFree = { ...existing.barrierFree, ...bf };
      }

      if (Object.keys(set).length) {
        set.updatedAt = new Date();
        await Venue.findOneAndUpdate({ name: venue.name }, { $set: set });
        updated += 1;
      }
    }

    console.log(`Inserted: ${inserted}, updated: ${updated}`);
  } catch (error) {
    console.error('Upsert failed:', error);
    process.exit(1);
  } finally {
    mongoose.connection.close();
  }
}

run();
