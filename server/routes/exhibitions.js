import express from 'express';
import Exhibition from '../models/Exhibition.js';
import Venue from '../models/Venue.js';
import { ensureTrendScore, isTrendApiAvailable } from '../services/trendService.js';
import { repairRecentPeriods } from '../services/exhibitionRepair.js';
import { searchVenueExhibitions } from '../services/venueExhibitionSearch.js';

const router = express.Router();

function isOngoingOrUpcoming(exhibition, windowDays = 30) {
  if (!exhibition?.period?.start || !exhibition?.period?.end) return false;
  const now = new Date();
  const start = new Date(exhibition.period.start);
  const end = new Date(exhibition.period.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const upcoming = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  return (now >= start && now <= end) || (start > now && start <= upcoming);
}

// 모든 전시 조회
router.get('/', async (req, res) => {
  try {
    const { sort } = req.query;
    const exhibitions = await Exhibition.find();

    if (sort === 'trend') {
      if (!isTrendApiAvailable()) {
        // 트렌드 API 불가 시 조용히 빈 배열 반환 (클라이언트는 fallback 처리)
        return res.json([]);
      }

      const target = exhibitions.filter((exhibition) => isOngoingOrUpcoming(exhibition));
      const maxUpdates = Number(process.env.TREND_UPDATE_LIMIT || 30);
      const staleTargets = target
        .filter((exhibition) => {
          const updatedAt = exhibition.trend?.updatedAt ? new Date(exhibition.trend.updatedAt) : null;
          if (!updatedAt) return true;
          const ttl = Number(process.env.NAVER_TREND_STALE_MS || 24 * 60 * 60 * 1000);
          return Date.now() - updatedAt.getTime() > ttl;
        })
        .sort((a, b) => {
          const aTime = new Date(a.trend?.updatedAt || 0).getTime();
          const bTime = new Date(b.trend?.updatedAt || 0).getTime();
          return aTime - bTime;
        })
        .slice(0, maxUpdates);
      const updated = [];
      for (const exhibition of staleTargets) {
        try {
          const trend = await ensureTrendScore(exhibition);
          await Exhibition.updateOne(
            { _id: exhibition._id },
            { $set: { trend } },
            { runValidators: false }
          );
          updated.push({ ...exhibition.toObject(), trend });
        } catch (err) {
          console.error('Trend update failed:', exhibition._id, err.message);
          updated.push(exhibition.toObject());
        }
      }
      const merged = target.map((exhibition) => {
        const hit = updated.find((item) => String(item._id) === String(exhibition._id));
        return hit || exhibition.toObject();
      });
      merged.sort((a, b) => (b.trend?.score || 0) - (a.trend?.score || 0));
      return res.json(merged.slice(0, 100)); // 최대 100개 제한
    }

    res.json(exhibitions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 트렌드 정렬 (네이버 검색/데이터랩 기반)
router.get('/trending', async (req, res) => {
  try {
    const exhibitions = await Exhibition.find();
    if (!isTrendApiAvailable()) {
      return res.json([]);
    }

    const target = exhibitions.filter((exhibition) => isOngoingOrUpcoming(exhibition));
    const maxUpdates = Number(process.env.TREND_UPDATE_LIMIT || 30);
    const staleTargets = target
      .filter((exhibition) => {
        const updatedAt = exhibition.trend?.updatedAt ? new Date(exhibition.trend.updatedAt) : null;
        if (!updatedAt) return true;
        const ttl = Number(process.env.NAVER_TREND_STALE_MS || 24 * 60 * 60 * 1000);
        return Date.now() - updatedAt.getTime() > ttl;
      })
      .sort((a, b) => {
        const aTime = new Date(a.trend?.updatedAt || 0).getTime();
        const bTime = new Date(b.trend?.updatedAt || 0).getTime();
        return aTime - bTime;
      })
      .slice(0, maxUpdates);
    const updated = [];

    for (const exhibition of staleTargets) {
      try {
        const trend = await ensureTrendScore(exhibition);
        await Exhibition.updateOne(
          { _id: exhibition._id },
          { $set: { trend } },
          { runValidators: false }
        );
        updated.push({ ...exhibition.toObject(), trend });
      } catch (err) {
        console.error('Trend update failed:', exhibition._id, err.message);
        updated.push(exhibition.toObject());
      }
    }

    const merged = target.map((exhibition) => {
      const hit = updated.find((item) => String(item._id) === String(exhibition._id));
      return hit || exhibition.toObject();
    });
    merged.sort((a, b) => (b.trend?.score || 0) - (a.trend?.score || 0));
    res.json(merged.slice(0, 100)); // 최대 100개 제한
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Venue ?꾩떆 寃??(News/Web) -> ?꾩떆 異붽?
router.post('/venue-search', async (req, res) => {
  try {
    const {
      venueNames,
      limit,
      perVenue,
      serviceIds,
      keywords,
      braveLimit,
      debug,
      allowPeriodUnknown
    } = req.body || {};

    const result = await searchVenueExhibitions({
      venueNames,
      limit,
      perVenue,
      serviceIds,
      keywords,
      braveLimit,
      debug,
      allowPeriodUnknown
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Repair recent periodUnknown exhibitions via Brave
router.post('/repair-periods', async (req, res) => {
  try {
    const { sources, limit, braveLimit, force } = req.body || {};
      const result = await repairRecentPeriods({
      sources: Array.isArray(sources) && sources.length ? sources : ['unified_exhibition_api', 'seoul_api', 'culture_unified'],
      limit: Number(limit || process.env.PERIOD_REPAIR_LIMIT || 5),
      braveLimit: Number(braveLimit || process.env.PERIOD_REPAIR_BRAVE_LIMIT || 5),
      force: force === true || String(force || '').toLowerCase() === 'true'
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 특정 전시 상세 조회 (평점 로직 포함)
router.get('/:id', async (req, res) => {
  try {
    const exhibition = await Exhibition.findById(req.params.id);
    if (!exhibition) {
      return res.status(404).json({ error: '전시를 찾을 수 없습니다' });
    }
    
    // 전시가 현재 진행 중인지 확인
    const isOngoing = exhibition.isOngoing();
    
    let displayRating = null;
    
    if (isOngoing) {
      // 현재 전시 중: 해당 전시 평점
      if (exhibition.stats.reviewCount > 0) {
        displayRating = {
          type: 'exhibition',
          rating: exhibition.stats.averageRating,
          count: exhibition.stats.reviewCount,
          label: '이 전시 평점'
        };
      }
    } else {
      // 전시 종료: 전시관 평점
      const venue = await Venue.findOne({ name: exhibition.venue.name });
      if (venue && venue.stats.totalReviews > 0) {
        displayRating = {
          type: 'venue',
          rating: venue.stats.averageRating,
          count: venue.stats.totalReviews,
          label: `${venue.name} 전체 평점`
        };
      }
    }
    
    // 응답 데이터
    const response = {
      ...exhibition.toObject(),
      displayRating,
      isOngoing
    };
    
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 전시 추가
router.post('/', async (req, res) => {
  try {
    const exhibition = new Exhibition(req.body);
    await exhibition.save();
    res.status(201).json(exhibition);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
