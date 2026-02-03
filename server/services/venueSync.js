import Venue from '../models/Venue.js';
import Exhibition from '../models/Exhibition.js';
import { fetchNaverSearch } from './naverApi.js';
import { fetchBraveVenueInfo } from './braveSearch.js';

const STATUS_STALE_MS = 24 * 60 * 60 * 1000;

function isStale(date) {
  if (!date) return true;
  return (Date.now() - new Date(date).getTime()) > STATUS_STALE_MS;
}

function isEmpty(value) {
  return value === null || value === undefined || value === '';
}

function isInvalidOpenHours(value) {
  if (!value) return false;
  return /\d{4}-\d{2}-\d{2}/.test(String(value));
}

export async function syncVenues(options = {}) {
  const { serviceId = 'blog', limit = 50, names = [], forceOpenHours = false } = options;
  const nameFilter = Array.isArray(names) && names.length
    ? { name: { $in: names } }
    : {};
  const venues = await Venue.find(nameFilter).limit(limit);
  let statusUpdated = 0;
  let infoUpdated = 0;

  for (const venue of venues) {
    let dirty = false;
    if (!venue.barrierFree) {
      venue.barrierFree = {};
    }

    if (isStale(venue.status?.updatedAt)) {
      const query = `${venue.name} 전시`;
      const result = await fetchNaverSearch(serviceId, query, { display: 1 });
      const total = Number(result.total || 0);
      venue.status = {
        hasCurrentExhibition: total > 0,
        updatedAt: new Date()
      };
      statusUpdated++;
      dirty = true;
    }

    if (
      isEmpty(venue.address) ||
      !venue.location?.lat ||
      !venue.location?.lng ||
      isEmpty(venue.openHours) ||
      typeof venue.barrierFree?.wheelchair === 'undefined' ||
      typeof venue.barrierFree?.elevator === 'undefined' ||
      typeof venue.barrierFree?.braille === 'undefined' ||
      typeof venue.barrierFree?.audioGuide === 'undefined' ||
      typeof venue.barrierFree?.accessibleToilet === 'undefined' ||
      typeof venue.barrierFree?.parkingPaid === 'undefined'
    ) {
      const exhibition = await Exhibition.findOne({ 'venue.name': venue.name }).lean();
      if (exhibition?.venue) {
        if (isEmpty(venue.address) && exhibition.venue.address) {
          venue.address = exhibition.venue.address;
          dirty = true;
        }
        if ((!venue.location?.lat || !venue.location?.lng) && exhibition.venue.location) {
          venue.location = exhibition.venue.location;
          dirty = true;
        }
        if (typeof venue.barrierFree?.wheelchair === 'undefined' && exhibition.venue.barrierFree?.wheelchair !== undefined) {
          venue.barrierFree.wheelchair = !!exhibition.venue.barrierFree.wheelchair;
          dirty = true;
        }
        if (typeof venue.barrierFree?.elevator === 'undefined' && exhibition.venue.barrierFree?.elevator !== undefined) {
          venue.barrierFree.elevator = !!exhibition.venue.barrierFree.elevator;
          dirty = true;
        }
        if (typeof venue.barrierFree?.braille === 'undefined' && exhibition.barrierFree?.braille !== undefined) {
          venue.barrierFree.braille = !!exhibition.barrierFree.braille;
          dirty = true;
        }
        if (typeof venue.barrierFree?.audioGuide === 'undefined' && exhibition.barrierFree?.audioGuide !== undefined) {
          venue.barrierFree.audioGuide = !!exhibition.barrierFree.audioGuide;
          dirty = true;
        }
      }
    }

    if (isInvalidOpenHours(venue.openHours)) {
      venue.openHours = '';
      dirty = true;
    }

    if (forceOpenHours && !isEmpty(venue.openHours)) {
      venue.openHours = '';
      dirty = true;
    }

    const needsBraveInfo =
      isEmpty(venue.openHours) ||
      isEmpty(venue.address) ||
      !venue.location?.lat ||
      !venue.location?.lng ||
      typeof venue.barrierFree?.wheelchair === 'undefined' ||
      typeof venue.barrierFree?.elevator === 'undefined' ||
      typeof venue.barrierFree?.braille === 'undefined' ||
      typeof venue.barrierFree?.audioGuide === 'undefined' ||
      typeof venue.barrierFree?.accessibleToilet === 'undefined' ||
      typeof venue.barrierFree?.parkingPaid === 'undefined' ||
      typeof venue.barrierFree?.parkingFree === 'undefined';

    if (needsBraveInfo) {
      const braveInfo = await fetchBraveVenueInfo(venue.name);
      if (isEmpty(venue.openHours) && braveInfo?.openHours) {
        venue.openHours = braveInfo.openHours;
        dirty = true;
      }
      if (isEmpty(venue.address) && braveInfo?.address) {
        venue.address = braveInfo.address;
        dirty = true;
      }
      if ((!venue.location?.lat || !venue.location?.lng) && braveInfo?.location) {
        venue.location = braveInfo.location;
        dirty = true;
      }
      if (braveInfo?.barrierFree) {
        if (typeof venue.barrierFree?.wheelchair === 'undefined' && typeof braveInfo.barrierFree.wheelchair !== 'undefined') {
          venue.barrierFree.wheelchair = !!braveInfo.barrierFree.wheelchair;
          dirty = true;
        }
        if (typeof venue.barrierFree?.elevator === 'undefined' && typeof braveInfo.barrierFree.elevator !== 'undefined') {
          venue.barrierFree.elevator = !!braveInfo.barrierFree.elevator;
          dirty = true;
        }
        if (typeof venue.barrierFree?.braille === 'undefined' && typeof braveInfo.barrierFree.braille !== 'undefined') {
          venue.barrierFree.braille = !!braveInfo.barrierFree.braille;
          dirty = true;
        }
        if (typeof venue.barrierFree?.audioGuide === 'undefined' && typeof braveInfo.barrierFree.audioGuide !== 'undefined') {
          venue.barrierFree.audioGuide = !!braveInfo.barrierFree.audioGuide;
          dirty = true;
        }
        if (typeof venue.barrierFree?.accessibleToilet === 'undefined' && typeof braveInfo.barrierFree.accessibleToilet !== 'undefined') {
          venue.barrierFree.accessibleToilet = !!braveInfo.barrierFree.accessibleToilet;
          dirty = true;
        }
        if (typeof venue.barrierFree?.parkingPaid === 'undefined' && typeof braveInfo.barrierFree.parkingPaid !== 'undefined') {
          venue.barrierFree.parkingPaid = !!braveInfo.barrierFree.parkingPaid;
          dirty = true;
        }
        if (typeof venue.barrierFree?.parkingFree === 'undefined' && typeof braveInfo.barrierFree.parkingFree !== 'undefined') {
          venue.barrierFree.parkingFree = !!braveInfo.barrierFree.parkingFree;
          dirty = true;
        }
      }
    }

    if (dirty) {
      venue.updatedAt = new Date();
      await venue.save();
      infoUpdated++;
    }
  }

  return { statusUpdated, infoUpdated };
}
