import mongoose from 'mongoose';

const exhibitionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  
  period: {
    start: { type: Date, required: false },
    end: { type: Date, required: false }
  },
  
  openHours: {
    weekday: String,
    weekend: String,
    closed: [String]
  },
  
  // 전시관 정보 (변경)
  venue: {
    name: { type: String, required: true },
    address: { type: String, required: true },
    location: {
      lat: { type: Number, required: false },
      lng: { type: Number, required: false }
    }
  },
  
  price: {
    adult: { type: Number, default: 0 },
    youth: { type: Number, default: 0 },
    child: { type: Number, default: 0 },
    free: { type: Boolean, default: false }
  },
  
  barrierFree: {
    wheelchair: Boolean,
    elevator: Boolean,
    braille: Boolean,
    audioGuide: Boolean
  },
  
  website: String,
  artists: [String],
  description: String,
  images: [String],

  periodUnknown: { type: Boolean, default: false },
  
  // 이 전시의 평점 (전시 기간 중에만 사용)
  stats: {
    averageRating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 }
  },

  trend: {
    score: { type: Number, default: 0 },
    blogTotal: { type: Number, default: 0 },
    trendLast: { type: Number, default: 0 },
    trendSeries: { type: Array, default: [] },
    updatedAt: { type: Date, default: null }
  },
  
  // API 동기화 관련 필드
  _source: { type: String, default: null }, // 'culture_api' 등
  _apiId: { type: String, default: null }, // API에서 제공하는 고유 ID
  
  createdAt: { type: Date, default: Date.now }
}, {
  strict: false // 추가 필드 허용 (안전을 위해)
});

// 전시가 현재 진행 중인지 확인하는 메서드
exhibitionSchema.methods.isOngoing = function() {
  const now = new Date();
  if (!this.period?.start || !this.period?.end) {
    return false;
  }
  return now >= this.period.start && now <= this.period.end;
};

export default mongoose.model('Exhibition', exhibitionSchema);
