import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Venue from './models/Venue.js';
import { pathToFileURL } from 'url';

dotenv.config();

export const rawVenues = [
  {
    region: '서울',
    name: '국립현대미술관 (서울)',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (수,토 ~21:00)',
    lat: 37.579,
    lng: 126.98,
    address: '서울 종로구 삼청로 30',
    website: 'https://www.mmca.go.kr',
    instagramHandle: 'mmcakorea',
    notes: '가장 최신 시설. 경사로와 엘리베이터가 완벽함. 휠체어 대여소 상시 운영.'
  },
  {
    region: '경기',
    name: '국립현대미술관 (과천)',
    grades: 'O/O/△',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 37.434,
    lng: 126.996,
    address: '경기 과천시 광명로 313',
    website: 'https://www.mmca.go.kr',
    instagramHandle: 'mmcakorea',
    notes: '산속에 있어 셔틀버스 이용 필수. 셔틀버스에 휠체어 리프트가 설치되어 있음.'
  },
  {
    region: '서울',
    name: '국립현대미술관 (덕수궁)',
    grades: 'O/△/X',
    openHours: '10:00~18:00 (수,토 ~21:00, 월 휴관)',
    lat: 37.565,
    lng: 126.975,
    address: '서울 중구 세종대로 99',
    website: 'https://www.mmca.go.kr',
    instagramHandle: 'mmcakorea',
    notes: '덕수궁 궁궐 내 위치. 석조 건물 특성상 내부 엘리베이터는 있으나 궁궐 길(박석)이 휠체어에 다소 덜컹거림.'
  },
  {
    region: '서울',
    name: '예술의전당 (한가람)',
    grades: 'O/O/△',
    openHours: '10:00~19:00 (월 휴관)',
    lat: 37.483,
    lng: 127.014,
    notes: '통합'
  },
  {
    region: '서울',
    name: '리움미술관',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 37.539,
    lng: 127.002,
    notes: '사립'
  },
  {
    region: '서울',
    name: '서울시립미술관 (본관)',
    grades: 'O/O/O',
    openHours: '10:00~20:00 (월 휴관, 주말 ~18:00)',
    lat: 37.564,
    lng: 126.974,
    notes: '시립'
  },
  {
    region: '서울',
    name: 'DDP (디자인전시관)',
    grades: 'O/O/O',
    openHours: '10:00~20:00',
    lat: 37.567,
    lng: 127.01,
    notes: '공공'
  },
  {
    region: '서울',
    name: '아모레퍼시픽미술관',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 37.528,
    lng: 126.968,
    notes: '사립'
  },
  {
    region: '서울',
    name: '석파정 서울미술관',
    grades: 'O/△/X',
    openHours: '10:00~18:00 (월,화 휴관)',
    lat: 37.592,
    lng: 126.962,
    notes: '야외경사'
  },
  {
    region: '인천/경기',
    name: '인천아트플랫폼',
    grades: 'O/O/△',
    openHours: '11:00~18:00 (월 휴관)',
    lat: 37.472,
    lng: 126.621,
    notes: '시립'
  },
  {
    region: '경기',
    name: '경기도립미술관',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 37.33,
    lng: 126.822,
    notes: '도립'
  },
  {
    region: '경기',
    name: '호암미술관',
    grades: 'O/O/△',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 37.294,
    lng: 127.192,
    notes: '예약제'
  },
  {
    region: '경기',
    name: '백남준아트센터',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 37.268,
    lng: 127.11,
    notes: '도립'
  },
  {
    region: '강원',
    name: '뮤지엄 산',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 37.34,
    lng: 127.873,
    notes: '사립/특화'
  },
  {
    region: '강원',
    name: '하슬라아트월드',
    grades: 'O/△/X',
    openHours: '09:00~18:00',
    lat: 37.708,
    lng: 129.011,
    notes: '지형주의'
  },
  {
    region: '강원',
    name: '춘천시립미술관',
    grades: 'O/O/△',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 37.885,
    lng: 127.73,
    notes: '시립'
  },
  {
    region: '강원',
    name: '바우지움조각미술관',
    grades: 'O/O/X',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 38.214,
    lng: 128.539,
    notes: '사립'
  },
  {
    region: '충청',
    name: '대전시립미술관',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 36.366,
    lng: 127.391,
    notes: '시립'
  },
  {
    region: '충청',
    name: '이응노미술관',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 36.365,
    lng: 127.389,
    notes: '시립'
  },
  {
    region: '충청',
    name: '국립현대미술관 (청주)',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 36.652,
    lng: 127.489,
    address: '충북 청주시 청원구 상당로 314',
    website: 'https://www.mmca.go.kr',
    instagramHandle: 'mmcakorea',
    notes: "담배공장을 개조한 '보이는 수장고' 형태. 공간이 매우 넓고 평탄하여 휠체어 이동이 가장 쾌적함."
  },
  {
    region: '충청',
    name: '아미미술관',
    grades: '△/△/X',
    openHours: '10:00~18:00',
    lat: 36.885,
    lng: 126.671,
    notes: '폐교개조'
  },
  {
    region: '호남',
    name: '국립아시아문화전당(ACC)',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (수,토 ~20:00)',
    lat: 35.147,
    lng: 126.92,
    notes: '국립'
  },
  {
    region: '호남',
    name: '광주시립미술관',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 35.176,
    lng: 126.892,
    notes: '시립'
  },
  {
    region: '호남',
    name: '전남도립미술관',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 34.975,
    lng: 127.581,
    notes: '도립'
  },
  {
    region: '호남',
    name: '전북도립미술관',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 35.736,
    lng: 127.118,
    notes: '도립'
  },
  {
    region: '영남',
    name: '부산시립미술관',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 35.166,
    lng: 129.136,
    notes: '시립'
  },
  {
    region: '영남',
    name: '대구미술관',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 35.823,
    lng: 128.666,
    notes: '시립'
  },
  {
    region: '영남',
    name: '울산시립미술관',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 35.556,
    lng: 129.317,
    notes: '시립'
  },
  {
    region: '영남',
    name: '경남도립미술관',
    grades: 'O/O/O',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 35.244,
    lng: 128.692,
    notes: '도립'
  },
  {
    region: '영남',
    name: '솔거미술관 (경주)',
    grades: 'O/O/△',
    openHours: '10:00~18:00',
    lat: 35.833,
    lng: 129.288,
    notes: '공립'
  },
  {
    region: '제주',
    name: '제주도립미술관',
    grades: 'O/O/O',
    openHours: '09:00~18:00 (월 휴관)',
    lat: 33.456,
    lng: 126.486,
    notes: '도립'
  },
  {
    region: '제주',
    name: '빛의 벙커 (성산)',
    grades: 'O/O/X',
    openHours: '10:00~18:20',
    lat: 33.44,
    lng: 126.905,
    notes: '미디어아트'
  },
  // === 사립 미술관/작가 공간 ===
  {
    region: '서울',
    name: '아트선재센터',
    grades: 'O/O/X',
    openHours: '12:00~19:00 (월 휴관)',
    lat: 37.579,
    lng: 126.981,
    notes: '사립',
    barrierFreeExtra: { accessibleToilet: true, parkingFree: false, parkingPaid: false, audioGuide: false, guideDog: false }
  },
  {
    region: '서울',
    name: '대림미술관',
    grades: 'O/O/O',
    openHours: '11:00~20:00 (월,화 휴관)',
    lat: 37.578,
    lng: 126.973,
    notes: '사립',
    barrierFreeExtra: { accessibleToilet: true, parkingFree: false, parkingPaid: false, audioGuide: false, guideDog: false }
  },
  {
    region: '서울',
    name: '그라운드시소 서촌',
    grades: 'X/X/X',
    openHours: '10:00~19:00',
    lat: 37.577,
    lng: 126.972,
    notes: '사립',
    barrierFreeExtra: { accessibleToilet: true, parkingFree: false, parkingPaid: false, audioGuide: false, guideDog: false }
  },
  {
    region: '서울',
    name: '그라운드시소 성수',
    grades: 'O/O/X',
    openHours: '10:00~19:00',
    lat: 37.546,
    lng: 127.065,
    notes: '사립',
    barrierFreeExtra: { accessibleToilet: true, parkingFree: false, parkingPaid: true, audioGuide: false, guideDog: false }
  },
  {
    region: '서울',
    name: '그라운드시소 센트럴',
    grades: 'O/O/O',
    openHours: '10:30~19:00 (백화점 휴무)',
    lat: 37.564,
    lng: 126.981,
    notes: '사립/신세계백화점 내',
    barrierFreeExtra: { accessibleToilet: true, parkingFree: false, parkingPaid: true, audioGuide: false, guideDog: false }
  },
  {
    region: '서울',
    name: '피크닉',
    grades: 'X/X/X',
    openHours: '10:00~18:00 (월 휴관)',
    lat: 37.556,
    lng: 126.978,
    notes: '사립',
    barrierFreeExtra: { accessibleToilet: false, parkingFree: false, parkingPaid: true, audioGuide: false, guideDog: false }
  },
  {
    region: '서울',
    name: '송은',
    grades: 'O/O/X',
    openHours: '11:00~18:30 (일 휴관)',
    lat: 37.524,
    lng: 127.044,
    notes: '사립',
    barrierFreeExtra: { accessibleToilet: true, parkingFree: false, parkingPaid: true, audioGuide: false, guideDog: false }
  },
  {
    region: '제주',
    name: '본태박물관',
    grades: 'O/O/X',
    openHours: '10:00~18:00',
    lat: 33.303,
    lng: 126.392,
    notes: '사립/안도다다오 설계',
    barrierFreeExtra: { accessibleToilet: true, parkingFree: true, parkingPaid: false, audioGuide: true, guideDog: false }
  },
  {
    region: '호남',
    name: '이이남 스튜디오',
    grades: 'X/X/X',
    openHours: '11:00~21:00 (연중무휴)',
    lat: 35.139,
    lng: 126.913,
    notes: '작가공간/미디어아트',
    barrierFreeExtra: { accessibleToilet: true, parkingFree: true, parkingPaid: false, audioGuide: false, guideDog: false }
  }
];

function gradeToBool(grade) {
  return grade === 'O' || grade === '△';
}

function parseGrades(grades) {
  const [e, w, b] = grades.split('/');
  return {
    elevator: gradeToBool(e),
    wheelchair: gradeToBool(w),
    braille: gradeToBool(b),
    elevatorGrade: e,
    wheelchairGrade: w,
    brailleGrade: b
  };
}

function isEmpty(value) {
  return value === null || value === undefined || value === '';
}

async function seedVenues() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');
    console.log('📦 DB:', mongoose.connection.db.databaseName);

    let upserted = 0;
    let updated = 0;

    for (const venue of rawVenues) {
      const barrierFree = {
        ...parseGrades(venue.grades),
        ...(venue.barrierFreeExtra || {})
      };
      const existing = await Venue.findOne({ name: venue.name }).lean();
      const update = {
        name: venue.name,
        region: venue.region,
        address: venue.address || '',
        location: { lat: venue.lat, lng: venue.lng },
        openHours: venue.openHours,
        website: venue.website || '',
        instagramHandle: venue.instagramHandle || '',
        notes: venue.notes,
        barrierFree,
        updatedAt: new Date()
      };

      if (!existing) {
        await Venue.create(update);
        upserted++;
        continue;
      }

      const set = {};
      if (isEmpty(existing.region)) set.region = update.region;
      if (isEmpty(existing.address)) set.address = update.address;
      if (!existing.location?.lat || !existing.location?.lng) set.location = update.location;
      if (isEmpty(existing.openHours)) set.openHours = update.openHours;
      if (isEmpty(existing.website)) set.website = update.website;
      if (isEmpty(existing.instagramHandle)) set.instagramHandle = update.instagramHandle;
      if (isEmpty(existing.notes)) set.notes = update.notes;

      const bf = {};
      if (typeof existing.barrierFree?.wheelchair === 'undefined') bf.wheelchair = barrierFree.wheelchair;
      if (typeof existing.barrierFree?.elevator === 'undefined') bf.elevator = barrierFree.elevator;
      if (typeof existing.barrierFree?.braille === 'undefined') bf.braille = barrierFree.braille;
      if (isEmpty(existing.barrierFree?.wheelchairGrade)) bf.wheelchairGrade = barrierFree.wheelchairGrade;
      if (isEmpty(existing.barrierFree?.elevatorGrade)) bf.elevatorGrade = barrierFree.elevatorGrade;
      if (isEmpty(existing.barrierFree?.brailleGrade)) bf.brailleGrade = barrierFree.brailleGrade;
      // 추가 배리어프리 필드 (barrierFreeExtra에서 온 것들)
      if (typeof existing.barrierFree?.accessibleToilet === 'undefined' && barrierFree.accessibleToilet !== undefined) bf.accessibleToilet = barrierFree.accessibleToilet;
      if (typeof existing.barrierFree?.parkingFree === 'undefined' && barrierFree.parkingFree !== undefined) bf.parkingFree = barrierFree.parkingFree;
      if (typeof existing.barrierFree?.parkingPaid === 'undefined' && barrierFree.parkingPaid !== undefined) bf.parkingPaid = barrierFree.parkingPaid;
      if (typeof existing.barrierFree?.audioGuide === 'undefined' && barrierFree.audioGuide !== undefined) bf.audioGuide = barrierFree.audioGuide;
      if (typeof existing.barrierFree?.guideDog === 'undefined' && barrierFree.guideDog !== undefined) bf.guideDog = barrierFree.guideDog;
      if (Object.keys(bf).length) set.barrierFree = { ...existing.barrierFree, ...bf };

      if (Object.keys(set).length) {
        set.updatedAt = new Date();
        await Venue.findOneAndUpdate({ name: venue.name }, { $set: set });
        updated++;
      }
    }

    console.log(`✅ Inserted venues: ${upserted}, updated: ${updated}`);
    mongoose.connection.close();
    console.log('🔌 Connection closed');
  } catch (error) {
    console.error('❌ Seed error:', error);
    process.exit(1);
  }
}

const isDirectRun = pathToFileURL(process.argv[1] || '').href === import.meta.url;
if (isDirectRun) {
  seedVenues();
}
