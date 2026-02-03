import express from 'express';
import Review from '../models/Review.js';
import Exhibition from '../models/Exhibition.js';
import Venue from '../models/Venue.js';

const router = express.Router();
const TEN_MINUTES_MS = 10 * 60 * 1000;

// ??? ???????? ???
router.get('/exhibition/:exhibitionId', async (req, res) => {
  try {
    const reviews = await Review.find({
      exhibitionId: req.params.exhibitionId
    }).sort({ createdAt: -1 });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ?????????? ??? ???
router.get('/venue/:venueName', async (req, res) => {
  try {
    // ??? ?????????? ??? ???
    const exhibitions = await Exhibition.find({
      'venue.name': req.params.venueName
    });

    const exhibitionIds = exhibitions.map(e => e._id);

    // ??? ???????? ???
    const reviews = await Review.find({
      exhibitionId: { $in: exhibitionIds }
    }).sort({ createdAt: -1 });

    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ??? ???
router.post('/', async (req, res) => {
  try {
    const { exhibitionId, userId, userName } = req.body;
    const throttleKey = userId?.trim() || userName?.trim();

    if (!exhibitionId || !throttleKey) {
      return res.status(400).json({ error: '??? ??? ??? ?????' });
    }

    const tenMinutesAgo = new Date(Date.now() - TEN_MINUTES_MS);
    const recentReview = await Review.findOne({
      exhibitionId,
      ...(userId ? { userId } : { userName }),
      createdAt: { $gte: tenMinutesAgo }
    }).sort({ createdAt: -1 });

    if (recentReview) {
      const waitMs = Math.max(0, TEN_MINUTES_MS - (Date.now() - recentReview.createdAt.getTime()));
      return res.status(429).json({
        error: '10? ???? ?? ??? ?? ??? ??? ? ???. ?? ? ?? ??????.',
        retryAfterSeconds: Math.ceil(waitMs / 1000)
      });
    }

    // ??? ????
    const review = new Review(req.body);
    await review.save();

    // ??? ??? ???????
    const exhibition = await Exhibition.findById(req.body.exhibitionId);
    if (!exhibition) {
      return res.status(404).json({ error: '???????? ????????' });
    }

    // 1. ??? ???????? ??????
    const exhibitionReviews = await Review.find({
      exhibitionId: req.body.exhibitionId
    });

    const avgRating = exhibitionReviews.reduce((sum, r) => sum + r.rating, 0) / exhibitionReviews.length;

    await Exhibition.findByIdAndUpdate(req.body.exhibitionId, {
      'stats.averageRating': avgRating,
      'stats.reviewCount': exhibitionReviews.length
    });

    // 2. ?????????? ??? ??????
    await updateVenueRating(exhibition.venue.name);

    res.status(201).json(review);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ????? ??? ?????? ???
async function updateVenueRating(venueName) {
  try {
    // ??? ?????????? ??? ???
    const exhibitions = await Exhibition.find({ 'venue.name': venueName });
    const exhibitionIds = exhibitions.map(e => e._id);

    // ??? ??? ???
    const allReviews = await Review.find({
      exhibitionId: { $in: exhibitionIds }
    });

    if (allReviews.length === 0) {
      return;
    }

    // ??? ??? ???
    const totalAvg = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;

    // Venue ?????? ????(????????)
    const venueData = exhibitions[0].venue; // ????? ?????? ??? ??? ???????

    await Venue.findOneAndUpdate(
      { name: venueName },
      {
        name: venueName,
        address: venueData.address,
        location: venueData.location,
        stats: {
          averageRating: totalAvg,
          totalReviews: allReviews.length
        },
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('????? ??? ?????? ???:', error);
  }
}

export default router;
