import express from 'express';
import Exhibition from '../models/Exhibition.js';

const router = express.Router();

router.get('/exhibitions', async (req, res) => {
  try {
    const exhibitions = await Exhibition.find({
      $or: [
        { 'venue.name': { $regex: /예술의전당|SAC/i } },
        { _source: 'sac_api' }
      ]
    }).limit(200);
    res.json(exhibitions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
