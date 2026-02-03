import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Exhibition from './models/Exhibition.js';

dotenv.config();

const sampleExhibitions = [
  {
    title: "빛의 구조",
    period: {
      start: new Date("2026-02-01"),
      end: new Date("2026-04-30")
    },
    openHours: {
      weekday: "10:00-18:00",
      weekend: "10:00-20:00",
      closed: ["월요일"]
    },
    venue: {
      name: "서울시립미술관",
      address: "서울특별시 중구 덕수궁길 61",
      location: { lat: 37.56415, lng: 126.97525 }
    },
    price: { adult: 15000, youth: 10000, child: 5000, free: false },
    barrierFree: { wheelchair: true, elevator: true, braille: false, audioGuide: true },
    website: "https://sema.seoul.go.kr",
    artists: ["김영호", "박서보"],
    description: "빛과 공간의 관계를 탐구하는 현대미술 전시.",
    images: []
  },
  {
    title: "추상과 구상 사이",
    period: {
      start: new Date("2026-03-15"),
      end: new Date("2026-06-15")
    },
    openHours: {
      weekday: "10:00-19:00",
      weekend: "10:00-19:00",
      closed: ["월요일", "공휴일"]
    },
    venue: {
      name: "국립현대미술관",
      address: "서울특별시 종로구 삼청로 30",
      location: { lat: 37.5796, lng: 126.9810 }
    },
    price: { adult: 8000, youth: 5000, child: 0, free: false },
    barrierFree: { wheelchair: true, elevator: true, braille: true, audioGuide: true },
    website: "https://www.mmca.go.kr",
    artists: ["이우환", "정상화"],
    description: "한국 현대미술의 추상과 구상을 조망하는 대규모 기획전.",
    images: []
  },
  {
    title: "도시의 풍경",
    period: {
      start: new Date("2026-01-20"),
      end: new Date("2026-03-20")
    },
    openHours: {
      weekday: "11:00-20:00",
      weekend: "11:00-21:00",
      closed: []
    },
    venue: {
      name: "아라리오뮤지엄",
      address: "서울특별시 종로구 율곡로 83",
      location: { lat: 37.5795, lng: 126.9850 }
    },
    price: { adult: 12000, youth: 8000, child: 5000, free: false },
    barrierFree: { wheelchair: false, elevator: true, braille: false, audioGuide: false },
    website: "https://www.arariomuseum.org",
    artists: ["김아타", "구본창"],
    description: "현대 도시의 변화하는 풍경을 사진과 영상으로 담아낸 전시.",
    images: []
  },
  {
    title: "모네와 인상주의",
    period: {
      start: new Date("2026-01-15"),
      end: new Date("2026-04-15")
    },
    openHours: {
      weekday: "10:00-18:00",
      weekend: "10:00-19:00",
      closed: ["월요일"]
    },
    venue: {
      name: "예술의 전당",
      address: "서울특별시 서초구 남부순환로 2406",
      location: { lat: 37.4806, lng: 127.0116 }
    },
    price: { adult: 18000, youth: 12000, child: 8000, free: false },
    barrierFree: { wheelchair: true, elevator: true, braille: true, audioGuide: true },
    website: "https://www.sac.or.kr",
    artists: ["클로드 모네", "피에르 오귀스트 르누아르"],
    description: "인상주의 거장들의 작품을 한자리에 모은 대규모 기획전.",
    images: ["https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=800"]
  },
  {
    title: "한국 현대 조각의 흐름",
    period: {
      start: new Date("2026-02-01"),
      end: new Date("2026-05-31")
    },
    openHours: {
      weekday: "10:00-18:00",
      weekend: "10:00-19:00",
      closed: ["월요일"]
    },
    venue: {
      name: "예술의 전당",
      address: "서울특별시 서초구 남부순환로 2406",
      location: { lat: 37.4806, lng: 127.0116 }
    },
    price: { adult: 15000, youth: 10000, child: 7000, free: false },
    barrierFree: { wheelchair: true, elevator: true, braille: false, audioGuide: true },
    website: "https://www.sac.or.kr",
    artists: ["이승택", "문신", "김경"],
    description: "한국 현대 조각의 발전 과정을 조명하는 전시.",
    images: ["https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=800"]
  },
  {
    title: "디지털 아트의 미래",
    period: {
      start: new Date("2025-11-01"),
      end: new Date("2025-12-31")
    },
    openHours: {
      weekday: "10:00-18:00",
      weekend: "10:00-19:00",
      closed: ["월요일"]
    },
    venue: {
      name: "예술의 전당",
      address: "서울특별시 서초구 남부순환로 2406",
      location: { lat: 37.4806, lng: 127.0116 }
    },
    price: { adult: 20000, youth: 15000, child: 10000, free: false },
    barrierFree: { wheelchair: true, elevator: true, braille: false, audioGuide: true },
    website: "https://www.sac.or.kr",
    artists: ["팀 아일랜드", "라파엘 로잔달"],
    description: "AI와 VR 기술을 활용한 차세대 디지털 아트 작품 전시.",
    images: ["https://images.unsplash.com/photo-1518770660439-4636190af475?w=800"]
  }
];

async function seedDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB 연결 성공");
    console.log("📍 DB:", mongoose.connection.db.databaseName);

    await Exhibition.deleteMany({});
    console.log("🗑️  기존 데이터 삭제 완료");

    const result = await Exhibition.insertMany(sampleExhibitions);
    console.log(`✅ ${result.length}개 샘플 데이터 추가 완료`);

    // 확인
    const count = await Exhibition.countDocuments();
    console.log(`📊 현재 전시 데이터: ${count}개`);

    mongoose.connection.close();
    console.log("👋 연결 종료");
  } catch (error) {
    console.error("❌ 에러:", error);
    process.exit(1);
  }
}

seedDatabase();