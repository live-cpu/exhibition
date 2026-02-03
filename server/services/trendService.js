import { fetchNaverBlogSearch, fetchNaverDataLabTrend } from './naverApi.js';

const DEFAULT_TREND_DAYS = 90;
const DEFAULT_TIME_UNIT = 'week';
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;
const TREND_API_ENABLED = String(process.env.NAVER_TREND_ENABLED ?? 'true').toLowerCase() === 'true';
const TREND_STALE_MS = Number(process.env.NAVER_TREND_STALE_MS || DEFAULT_STALE_MS);
const TREND_COOLDOWN_MS = Number(process.env.NAVER_TREND_COOLDOWN_MS || 6 * 60 * 60 * 1000);
let trendDisabledUntil = 0;

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function calcTrendScore({ blogTotal, trendLast, ratingAverage, ratingCount }) {
  const safeTotal = Math.max(0, Number(blogTotal) || 0);
  const blogScore = Math.log10(safeTotal + 1) * 20; // 0~100-ish
  const trendScore = Number(trendLast) || 0; // 0~100
  const ratingBase = Math.max(0, Math.min(5, Number(ratingAverage) || 0)) * 20;
  const ratingWeight = Math.min(1, (Number(ratingCount) || 0) / 10);
  const ratingScore = ratingBase * ratingWeight;

  const total = (blogScore * 0.45) + (trendScore * 0.45) + (ratingScore * 0.10);
  return Math.round(total * 100) / 100;
}

function buildDataLabBody(title, days = DEFAULT_TREND_DAYS, timeUnit = DEFAULT_TIME_UNIT) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    startDate: toDateString(start),
    endDate: toDateString(end),
    timeUnit,
    keywordGroups: [
      {
        groupName: title,
        keywords: [title]
      }
    ]
  };
}

export async function fetchExhibitionTrend(title, options = {}) {
  if (!title) {
    return {
      blogTotal: 0,
      trendLast: 0,
      trendSeries: []
    };
  }

  if (!TREND_API_ENABLED || Date.now() < trendDisabledUntil) {
    return {
      blogTotal: 0,
      trendLast: 0,
      trendSeries: []
    };
  }

  try {
    const blog = await fetchNaverBlogSearch(title, { display: 1 });
    const blogTotal = Number(blog.total || 0);

    const body = buildDataLabBody(
      title,
      options.days || DEFAULT_TREND_DAYS,
      options.timeUnit || DEFAULT_TIME_UNIT
    );
    const dataLab = await fetchNaverDataLabTrend(body);
    const series = dataLab?.results?.[0]?.data || [];
    const trendLast = series.length ? Number(series[series.length - 1].ratio || 0) : 0;

    return {
      blogTotal,
      trendLast,
      trendSeries: series
    };
  } catch (err) {
    const message = String(err?.message || '');
    if (message.includes('429') || message.includes('quota') || message.includes('limit')) {
      trendDisabledUntil = Date.now() + TREND_COOLDOWN_MS;
    }
    return {
      blogTotal: 0,
      trendLast: 0,
      trendSeries: []
    };
  }
}

export async function ensureTrendScore(exhibition, options = {}) {
  const existing = exhibition.trend || {};
  const updatedAt = existing.updatedAt ? new Date(existing.updatedAt) : null;
  const isStale = !updatedAt || (Date.now() - updatedAt.getTime()) > TREND_STALE_MS;

  if (!isStale && typeof existing.score === 'number') {
    return existing;
  }

  if (!TREND_API_ENABLED || Date.now() < trendDisabledUntil) {
    if (typeof existing.score === 'number') return existing;
    const score = calcTrendScore({
      blogTotal: 0,
      trendLast: 0,
      ratingAverage: exhibition.stats?.averageRating || 0,
      ratingCount: exhibition.stats?.reviewCount || 0
    });
    return {
      score,
      blogTotal: 0,
      trendLast: 0,
      trendSeries: [],
      updatedAt: new Date()
    };
  }

  const trendData = await fetchExhibitionTrend(exhibition.title, options);
  const score = calcTrendScore({
    blogTotal: trendData.blogTotal,
    trendLast: trendData.trendLast,
    ratingAverage: exhibition.stats?.averageRating || 0,
    ratingCount: exhibition.stats?.reviewCount || 0
  });

  return {
    score,
    blogTotal: trendData.blogTotal,
    trendLast: trendData.trendLast,
    trendSeries: trendData.trendSeries,
    updatedAt: new Date()
  };
}

export function isTrendApiAvailable() {
  return TREND_API_ENABLED && Date.now() >= trendDisabledUntil;
}
