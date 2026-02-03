import express from 'express';
import Venue from '../models/Venue.js';
import { syncVenues } from '../services/venueSync.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const venues = await Venue.find();
    res.json(venues);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const { serviceId, limit, names, forceOpenHours } = req.body || {};
    const result = await syncVenues({ serviceId, limit, names, forceOpenHours });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to sync venues',
      detail: error.message
    });
  }
});

export default router;
