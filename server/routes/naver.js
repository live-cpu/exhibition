import express from 'express';
import { fetchNaverBlogSearch, fetchNaverDataLabTrend, fetchNaverSearch } from '../services/naverApi.js';
import { syncVenueExhibitionStatus } from '../services/venueStatus.js';

const router = express.Router();

router.get('/search/blog', async (req, res) => {
  try {
    const { query, display, start, sort } = req.query;
    const result = await fetchNaverBlogSearch(query, {
      display: display ? Number(display) : undefined,
      start: start ? Number(start) : undefined,
      sort: sort || undefined
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch Naver blog search',
      detail: error.message
    });
  }
});

router.get('/search/:serviceId', async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { query, display, start, sort } = req.query;
    const result = await fetchNaverSearch(serviceId, query, {
      display: display ? Number(display) : undefined,
      start: start ? Number(start) : undefined,
      sort: sort || undefined
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch Naver search',
      detail: error.message
    });
  }
});

router.post('/datalab', async (req, res) => {
  try {
    const result = await fetchNaverDataLabTrend(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch Naver DataLab',
      detail: error.message
    });
  }
});

router.post('/venue-status/sync', async (req, res) => {
  try {
    const { serviceId, limit } = req.body || {};
    const result = await syncVenueExhibitionStatus({ serviceId, limit });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to sync venue status',
      detail: error.message
    });
  }
});

export default router;
