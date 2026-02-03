import Venue from '../models/Venue.js';
import { fetchNaverSearch } from './naverApi.js';

const STATUS_STALE_MS = 24 * 60 * 60 * 1000;

function isStale(date) {
  if (!date) return true;
  return (Date.now() - new Date(date).getTime()) > STATUS_STALE_MS;
}

export async function syncVenueExhibitionStatus(options = {}) {
  const { serviceId = 'blog', limit = 30 } = options;
  const venues = await Venue.find().limit(limit);
  let updated = 0;

  for (const venue of venues) {
    if (!isStale(venue.status?.updatedAt)) continue;
    const query = `${venue.name} 전시`;
    const result = await fetchNaverSearch(serviceId, query, { display: 1 });
    const total = Number(result.total || 0);
    const hasCurrentExhibition = total > 0;

    venue.status = {
      hasCurrentExhibition,
      updatedAt: new Date()
    };
    await venue.save();
    updated++;
  }

  return { updated };
}
