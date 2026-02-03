import { fetchAllVenueExhibitions, fetchTrendingExhibitions, fetchReviews, postReview, fetchVenues } from './js/api.js';
import { filters, currentSort, applyFilters, sortExhibitions, setCurrentSort } from './js/filters.js';

let map;
let allVenueExhibitions = [];
let filteredVenueExhibitions = [];
let markers = [];
let trendingExhibitions = [];
let venues = [];
let venueDetails = [];
let currentVenue = null;
let currentOverlay = null;
let currentExhibitionIndex = 0;
let expandedCardId = null;
let pinnedVenueName = null;
const compareSelection = new Set();
const MAX_COMPARE = 3;
let compareBarHidden = false;
const venueTabSelection = new Map();
let trendMode = 'trend';
let userLocation = null;
let markerPositions = [];

const MAP_LOAD_LIMIT = 100000; // effectively disable daily cap
const MAP_QUOTA_KEY = 'mapLoadQuota';
let mapLoaded = false;
let mapScriptLoading = false;
let mapProvider = 'kakao';
let mapQuotaIncremented = false;
let mapApiKeys = { kakaoKey: '', googleKey: '' };

async function fetchMapApiKeys() {
  try {
    const res = await fetch('/api/config/map');
    if (!res.ok) throw new Error('Failed to fetch map config');
    mapApiKeys = await res.json();
    return mapApiKeys;
  } catch (err) {
    console.error('Failed to fetch map API keys:', err);
    return { kakaoKey: '', googleKey: '' };
  }
}

const FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=400&h=200&fit=crop',
  'https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?w=400&h=200&fit=crop',
  'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=400&h=200&fit=crop',
  'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=200&fit=crop',
  'https://images.unsplash.com/photo-1496307042754-b4aa456c4a2d?w=400&h=200&fit=crop',
  'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=400&h=200&fit=crop'
  ];

const UI_EXCLUDE_KEYWORDS_EXTRA = [
  '\ucd94\ucc9c',
  '\uac00\ubcfc\ub9cc\ud55c\uacf3',
  '\ub180\uac70\ub9ac',
  '\ud61c\ud0dd',
  '\ud560\uc778',
  '\ucf54\uc2a4',
  '\ub9db\uc9d1',
  '\uce74\ud398',
  '\uc5ec\ud589',
  '\ud56b\ud50c',
  '\ub9ac\ubdf0\ubaa8\uc74c',
  '\ud5e4\ub4dc\ub77c\uc778',
  '\ub274\uc2a4',
  '\uae30\uc0ac',
  '\uc774\ud0dc\uc6d0',
  '\uc6a9\uc0b0',
  '\uc774\uc7ac\uc6a9',
  '\uc74c\ub8cc\uc218',
  '\ucc28\uc5d0\uc11c'
];

function stripHtml(text) {
  if (!text) return '';
  return String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(text);
  return textarea.value;
}

function sanitizeText(text) {
  return decodeHtmlEntities(stripHtml(text));
}

function sanitizeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch (err) {
    return '';
  }
  return '';
}

function normalizeVenueKey(value) {
  return sanitizeText(value || '').toLowerCase().replace(/\s+/g, '').replace(/[()]/g, '');
}

function hashString(value) {
  let hash = 0;
  const str = String(value || '');
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getFallbackImage(exhibition) {
  const key = `${exhibition?.venue?.name || ''}-${exhibition?.title || ''}`;
  const index = hashString(key) % FALLBACK_IMAGES.length;
  return FALLBACK_IMAGES[index];
}

function getSourcePriority(source) {
  const order = [
    'unified_exhibition_api',
    'seoul_api',
    'culture_unified',
    'moca',
    'daegu_dgfca',
    'ggcultur',
    'naver_search',
    'brave_search',
    'gemini_search'
  ];
  const idx = order.indexOf(source || '');
  return idx == -1 ? order.length : idx;
}

const UI_EXCLUDE_KEYWORDS = [
  '\uad00\ub78c\uc548\ub0b4',
  '\uad00\ub78c\uc815\ubcf4',
  '\uad00\ub78c\uc815\ucc45',
  '\ucc3e\uc544\uc624\ub294\uae38',
  '\uc8fc\uc758',
  '\uc2dc\uc124\uc548\ub0b4',
  '\uc774\uc6a9\uc548\ub0b4',
  '\uc804\uc2dc\uad00',
  '\uc804\uc2dc\uad00\uc548\ub0b4',
  '\uacf5\uc9c0',
  '\uacf5\uc9c0\uc0ac\ud56d',
  '\ucc44\uc6a9',
  '\uc548\ub0b4',
  '\uc8fc\uac04',
  '\ucc38\uc5ec',
  '\uc544\uce74\ub370\ubbf8',
  '\uc6b4\uc601\uc2dc\uac04',
  '\uc624\uc2dc\ub294\uae38',
  '\uc608\uc57d'
];

function isExcludedExhibition(exhibition) {
  const text = sanitizeText(`${exhibition?.title || ''} ${exhibition?.description || ''}`).toLowerCase();
  const combined = UI_EXCLUDE_KEYWORDS.concat(UI_EXCLUDE_KEYWORDS_EXTRA);
  return combined.some((k) => text.includes(k.toLowerCase()));
}

const FALLBACK_LOCATIONS = [
  {
    matches: (name, address) =>
      name.includes('\uad6d\ub9bd\uc544\uc2dc\uc544\ubb38\ud654\uc804\ub2f9') ||
      name.includes('acc') ||
      address.includes('\ubb38\ud654\uc804\ub2f9\ub85c 38') ||
      address.includes('\uad11\uc8fc\uad11\uc5ed\uc2dc \ub3d9\uad6c'),
    location: { lat: 35.14668, lng: 126.92049 }
  },
  {
    matches: (name, address) =>
      name.includes('\uc608\uc220\uc758\uc804\ub2f9') ||
      address.includes('\ub0a8\ubd80\uc21c\ud658\ub85c 2406') ||
      address.includes('\uc11c\ucd08\uad6c'),
    location: { lat: 37.4777, lng: 127.0123 }
  }
];

function coerceLatLng(location) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return null;
}

function resolveVenueLocation(venueName, venueAddress, exhibitions) {
  const fromExhibitions = exhibitions
    .map((e) => coerceLatLng(e.venue?.location))
    .find(Boolean);
  if (fromExhibitions) return fromExhibitions;

  const fromVenue = venueDetails.find((v) => v.name === venueName);
  const venueLoc = coerceLatLng(fromVenue?.location);
  if (venueLoc) return venueLoc;

  const name = (venueName || '').toLowerCase();
  const address = (venueAddress || '').toLowerCase();
  const fallback = FALLBACK_LOCATIONS.find((item) => item.matches(name, address));
  return fallback ? fallback.location : null;
}

function getUserLocation() {
  if (userLocation) return Promise.resolve(userLocation);
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        resolve(userLocation);
      },
      () => resolve(null),
      { timeout: 3000 }
    );
  });
}

function distanceKm(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function getExhibitionById(id) {
  if (!id) return null;
  return allVenueExhibitions.find((e) => e._id === id) || null;
}

function updateCompareBar() {
  const bar = document.getElementById('compareBar');
  const count = document.getElementById('compareCount');
  if (!bar || !count) return;
  count.textContent = `\ube44\uad50 ${compareSelection.size}/${MAX_COMPARE}`;
  if (compareSelection.size === 0) {
    compareBarHidden = false;
  }
  const shouldShow = compareSelection.size > 0 && !compareBarHidden;
  bar.style.display = shouldShow ? 'flex' : 'none';
  const showBtn = document.getElementById('compareShowBtn');
  if (showBtn) {
    showBtn.style.display = compareSelection.size > 0 && compareBarHidden ? 'inline-flex' : 'none';
    showBtn.disabled = compareSelection.size === 0;
  }
}

function setCompareBarHidden(hidden) {
  compareBarHidden = hidden;
  updateCompareBar();
}

function renderCompareModal() {
  const body = document.getElementById('compareBody');
  if (!body) return;
  const items = Array.from(compareSelection).map(getExhibitionById).filter(Boolean);
  if (items.length === 0) {
    body.innerHTML = '<div style="font-size:12px;color:#666;">\uc120\ud0dd\ud55c \uc804\uc2dc\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.</div>';
    return;
  }

  const cards = items.map((exh) => {
    const imageUrl = exh.images && exh.images[0] ? exh.images[0] : getFallbackImage(exh);
    const periodStr = exh.periodUnknown || !exh.period?.start || !exh.period?.end
      ? '\uae30\uac04 \ubbf8\uc815'
      : `${new Date(exh.period.start).toLocaleDateString('ko-KR')} ~ ${new Date(exh.period.end).toLocaleDateString('ko-KR')}`;
    const priceStr = exh.price?.free ? '\ubb34\ub8cc' : `\uc131\uc778: ${exh.price?.adult?.toLocaleString?.() ?? 0}\uc6d0`;
    const ratingStr = (exh.stats?.reviewCount || 0) > 0
      ? `${(exh.stats?.averageRating || 0).toFixed(1)} (${exh.stats?.reviewCount || 0})`
      : '\uc544\uc9c1 \uc5c6\uc74c';
    return `
      <div class="compare-card">
        <img src="${imageUrl}" alt="${sanitizeText(exh.title || '')}" onerror="this.src='${getFallbackImage(exh)}'">
        <div class="compare-card-body">
          <div class="compare-card-title">${sanitizeText(exh.title || '')}</div>
          <div>\uc804\uc2dc\uc7a5: ${sanitizeText(exh.venue?.name || '')}</div>
          <div>\uae30\uac04: ${periodStr}</div>
          <div>\uad00\ub78c\ub8cc: ${priceStr}</div>
          <div>\ud3c9\uc810: ${ratingStr}</div>
        </div>
      </div>
    `;
  }).join('');

  body.innerHTML = `<div class="compare-grid">${cards}</div>`;
}

function setCompareModalVisible(visible) {
  const modal = document.getElementById('compareModal');
  if (!modal) return;
  modal.classList.toggle('active', visible);
  modal.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (visible) {
    renderCompareModal();
  }
}

function toggleCompareSelection(id) {
  if (!id) return;
  if (compareSelection.has(id)) {
    compareSelection.delete(id);
  } else {
    if (compareSelection.size >= MAX_COMPARE) return;
    compareSelection.add(id);
  }
  updateCompareBar();
  renderCompareModal();
}

function getReferenceLocation() {
  return userLocation || coerceLatLng(map?.getCenter?.()) || { lat: 37.5665, lng: 126.9780 };
}

function getExhibitionLocation(exhibition) {
  return coerceLatLng(exhibition?.venue?.location) || null;
}

function sortByDistance(exhibitions, reference) {
  const ref = reference || getReferenceLocation();
  return exhibitions.slice().sort((a, b) => {
    const aLoc = getExhibitionLocation(a);
    const bLoc = getExhibitionLocation(b);
    return distanceKm(ref, aLoc) - distanceKm(ref, bLoc);
  });
}

function isPermanentExhibition(exhibition) {
  const text = sanitizeText(`${exhibition?.title || ''} ${exhibition?.description || ''}`).toLowerCase();
  return text.includes('상설') || text.includes('상설전');
}

function getMapQuota() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = localStorage.getItem(MAP_QUOTA_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (!data || data.date !== today || typeof data.count !== 'number') {
      return { date: today, count: 0 };
    }
    return data;
  } catch (err) {
    const today = new Date().toISOString().slice(0, 10);
    return { date: today, count: 0 };
  }
}

function setMapQuota(next) {
  try {
    localStorage.setItem(MAP_QUOTA_KEY, JSON.stringify(next));
  } catch (err) {
    // ignore
  }
}

function canLoadMapToday() {
  return true;
}

function incrementMapQuota() {
  const quota = getMapQuota();
  const next = { date: quota.date, count: quota.count + 1 };
  setMapQuota(next);
  return next;
}

function ensureMapQuotaIncremented() {
  if (mapQuotaIncremented) return;
  incrementMapQuota();
  mapQuotaIncremented = true;
}

async function loadKakaoMapsScript() {
  if (mapLoaded || mapScriptLoading) return;
  const mapElement = document.getElementById('map');

  // 서버에서 API 키 가져오기
  if (!mapApiKeys.kakaoKey) {
    await fetchMapApiKeys();
  }
  const apiKey = mapApiKeys.kakaoKey;

  if (!apiKey) {
    console.warn('Kakao Maps key missing');
    loadGoogleMapsScript();
    return;
  }
  if (!canLoadMapToday()) {
    console.warn('Map load limit reached');
    return;
  }

  mapScriptLoading = true;
  ensureMapQuotaIncremented();

  const script = document.createElement('script');
  script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(apiKey)}&autoload=false`;
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    mapScriptLoading = false;
    console.warn('Kakao Maps load failed.');
    if (mapElement) {
      mapElement.innerHTML =
        '<div style="padding: 40px; text-align: center; color: #666; font-size: 14px; line-height: 1.6;">' +
        '<p>카카오 지도 로딩에 실패했습니다.</p>' +
        '<p style="font-size:12px;color:#999;">도메인 등록/네트워크 상태/차단 확장 프로그램을 확인해주세요.</p>' +
        '</div>';
    }
    loadGoogleMapsScript();
  };
  script.onload = () => {
    if (window.kakao && window.kakao.maps) {
      window.kakao.maps.load(() => initializeKakaoMap());
    } else {
      mapScriptLoading = false;
      loadGoogleMapsScript();
    }
  };
  document.head.appendChild(script);
}

async function loadGoogleMapsScript() {
  if (mapLoaded || mapScriptLoading) return;
  const mapElement = document.getElementById('map');
  if (!mapElement) {
    loadData();
    return;
  }

  if (!canLoadMapToday()) {
    console.warn('Map load limit reached');
    return;
  }

  if (window.google && window.google.maps) {
    initializeGoogleMap();
    return;
  }

  // 서버에서 API 키 가져오기
  if (!mapApiKeys.googleKey) {
    await fetchMapApiKeys();
  }
  const apiKey = mapApiKeys.googleKey;

  if (!apiKey) {
    console.warn('Google Maps key missing');
    mapElement.innerHTML =
      '<div style="padding: 40px; text-align: center; color: #666; font-size: 14px; line-height: 1.6;">' +
      '<p>지도 로딩에 실패했습니다.</p>' +
      '<p style="font-size:12px;color:#999;">Google Maps API를 설정해주세요.</p>' +
      '</div>';
    loadData();
    return;
  }

  mapScriptLoading = true;
  ensureMapQuotaIncremented();

  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=initMap&v=weekly`;
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    mapScriptLoading = false;
    console.warn('Google Maps load failed.');
    mapElement.innerHTML =
      '<div style="padding: 40px; text-align: center; color: #666; font-size: 14px; line-height: 1.6;">' +
      '<p>Google 지도 로딩에 실패했습니다.</p>' +
      '<p style="font-size:12px;color:#999;">도메인/네트워크 상태를 확인해주세요.</p>' +
      '</div>';
    loadData();
  };
  document.head.appendChild(script);
}

async function initializeKakaoMap() {
  try {
    const mapElement = document.getElementById('map');
    if (!mapElement) {
      loadData();
      return;
    }

    if (!window.kakao || !window.kakao.maps) {
      loadGoogleMapsScript();
      loadData();
      return;
    }
    const center = new kakao.maps.LatLng(37.5665, 126.9780);
    map = new kakao.maps.Map(mapElement, { center, level: 4 });

    mapProvider = 'kakao';
    mapLoaded = true;
    mapScriptLoading = false;
    loadData();
  } catch (err) {
    const mapElement = document.getElementById('map');
    if (mapElement) {
      mapElement.innerHTML =
        '<div style="padding: 40px; text-align: center; color: #666; font-size: 16px;"><p>\uc9c0\ub3c4 \ucd08\uae30\ud654 \uc624\ub958</p></div>';
    }
    loadGoogleMapsScript();
    loadData();
  }
}

async function initializeGoogleMap() {
  try {
    const mapElement = document.getElementById('map');
    if (!mapElement) {
      loadData();
      return;
    }

    if (!window.google || !window.google.maps) {
      mapScriptLoading = false;
      loadData();
      return;
    }

    map = new google.maps.Map(mapElement, {
      zoom: 13,
      center: { lat: 37.5665, lng: 126.9780 },
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      scaleControl: true,
      streetViewControl: false,
      rotateControl: false,
      fullscreenControl: true
    });

    mapProvider = 'google';
    mapLoaded = true;
    mapScriptLoading = false;
    loadData();
  } catch (err) {
    const mapElement = document.getElementById('map');
    if (mapElement) {
      mapElement.innerHTML =
        '<div style="padding: 40px; text-align: center; color: #666; font-size: 16px;"><p>지도 초기화 오류</p></div>';
    }
    mapScriptLoading = false;
    loadData();
  }
}

window.initMap = initializeGoogleMap;

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  if (canLoadMapToday()) {
    loadKakaoMapsScript();
  }
  document.getElementById('searchInput')?.addEventListener('input', () => refresh());
  document.getElementById('compareOpenBtn')?.addEventListener('click', () => setCompareModalVisible(true));
  document.getElementById('compareCloseBtn')?.addEventListener('click', () => setCompareModalVisible(false));
  document.getElementById('compareBackdrop')?.addEventListener('click', () => setCompareModalVisible(false));
  document.getElementById('compareHideBtn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    setCompareBarHidden(true);
  });
  document.getElementById('compareShowBtn')?.addEventListener('click', () => {
    setCompareBarHidden(false);
  });
  updateCompareBar();

  // InfoWindow 자세히보기 버튼 이벤트 위임 (카카오 지도 호환)
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.info-window-cta');
    if (btn) {
      event.preventDefault();
      event.stopPropagation();
      const venueIdx = parseInt(btn.dataset.venueIdx, 10);
      const exhId = btn.dataset.exhId || '';
      if (!isNaN(venueIdx)) {
        window.showVenueDetail(venueIdx, exhId);
      }
    }
  });
});

async function loadData() {
  const detailElement = document.getElementById('exhibitionDetail');

  try {
    if (detailElement) {
      detailElement.innerHTML = `
        <div class="empty-state">
          <p style="font-size: 48px; margin-bottom: 16px;">ART</p>
          <p style="font-size: 16px; margin-bottom: 10px; color: #333; font-weight: 500;">\uc804\uc2dc \uc815\ubcf4</p>
          <p style="font-size: 14px; color: #999; line-height: 1.6;">
            \uc544\ub798 \uce74\ub4dc\uc5d0\uc11c \uc804\uc2dc\ub97c \uc120\ud0dd\ud558\uac70\ub098<br>
            \uc9c0\ub3c4 \ub9c8\ucee4\ub97c \ud074\ub9ad\ud574 \ud655\uc778\ud558\uc138\uc694
          </p>
        </div>
      `;
    }

    allVenueExhibitions = await fetchAllVenueExhibitions();
    venueDetails = await fetchVenues();
    allVenueExhibitions = allVenueExhibitions.filter((e) => (e.title || '').trim());

    const now = new Date();
    const upcomingLimit = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    allVenueExhibitions = allVenueExhibitions.filter((e) => {
      if (e.periodUnknown) return true;
      if (!e.period?.start || !e.period?.end) return true;
      const start = new Date(e.period.start);
      const end = new Date(e.period.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return true;
      if (now >= start && now <= end) return true;
      if (start > now && start <= upcomingLimit) return true;
      return isPermanentExhibition(e) && end >= now;
    });

    if (allVenueExhibitions.length === 0) {
      if (detailElement) {
        detailElement.innerHTML = `
          <div class="empty-state">
            <p style="font-size: 48px; margin-bottom: 16px;">ART</p>
            <p style="font-size: 16px; margin-bottom: 8px; color: #333;">\uc804\uc2dc \ub370\uc774\ud130\uac00 \uc5c6\uc2b5\ub2c8\ub2e4</p>
          </div>
        `;
      }
      renderTrendCards();
      return;
    }

    venues = groupExhibitionsByVenue(allVenueExhibitions);
    const filtered = applyFilters(allVenueExhibitions);
    filteredVenueExhibitions = currentSort === 'distance'
      ? sortByDistance(filtered, getReferenceLocation())
      : sortExhibitions(filtered, currentSort);

    renderTrendCards();
    renderVenueMarkers();

    fetchTrendingExhibitions()
      .then((list) => {
        trendMode = 'trend';
        // 진행중인 전시만 필터링하고 최대 100개 제한
        trendingExhibitions = (list || [])
          .filter((e) => {
            if (e.periodUnknown) return true;
            if (!e.period?.start || !e.period?.end) return true;
            const start = new Date(e.period.start);
            const end = new Date(e.period.end);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return true;
            // 현재 진행중인 전시만 포함 (예정/종료 제외)
            return now >= start && now <= end;
          })
          .slice(0, 100); // 최대 100개 제한
        renderTrendCards();
      })
      .catch((err) => {
        // 트렌드 API 실패 시 거리순으로 fallback
        trendMode = 'distance';
        trendingExhibitions = [];
        getUserLocation().then(() => renderTrendCards());
      });
  } catch (err) {
    if (detailElement) {
      detailElement.innerHTML = `
        <div class="empty-state">
          <p style="font-size: 48px; margin-bottom: 16px;">ART</p>
          <p style="font-size: 16px; margin-bottom: 8px; color: #d32f2f;">\ub370\uc774\ud130\ub97c \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4</p>
          <p style="font-size: 14px; color: #999; line-height: 1.6;">
            <span style="font-size: 12px; color: #bbb;">\uc624\ub958: ${err.message}</span>
          </p>
        </div>
      `;
    }
  }
}

function groupExhibitionsByVenue(exhibitions) {
  const venueMap = new Map();

  exhibitions.forEach((exhibition) => {
    const venueName = exhibition.venue?.name || '\uae30\ud0c0';
    const venueAddress = exhibition.venue?.address || '';
    const venueInfo = venueDetails.find((v) => normalizeVenueKey(v.name) === normalizeVenueKey(venueName));

    if (!venueMap.has(venueName)) {
      const venueExhibitions = exhibitions.filter((e) => e.venue?.name === venueName);
      const withReviews = venueExhibitions.filter((e) => e.stats?.reviewCount > 0);
      const avgRating = withReviews.length > 0
        ? withReviews.reduce((sum, e) => sum + e.stats.averageRating, 0) / withReviews.length
        : 0;
      const totalReviews = venueExhibitions.reduce((sum, e) => sum + (e.stats?.reviewCount || 0), 0);
      const resolvedLocation = resolveVenueLocation(venueName, venueAddress, venueExhibitions);

      venueMap.set(venueName, {
        name: venueName,
        address: venueInfo?.address || venueAddress,
        location: resolvedLocation,
        barrierFree: venueInfo?.barrierFree || exhibition.venue?.barrierFree || {},
        openHours: exhibition.openHours?.weekday || venueInfo?.openHours || exhibition.venue?.openHours || '',
        exhibitions: venueExhibitions,
        stats: {
          averageRating: avgRating,
          reviewCount: totalReviews,
          exhibitionCount: venueExhibitions.length
        }
      });
    }
  });

  return Array.from(venueMap.values()).sort((a, b) => {
    if (a.stats.reviewCount > 0 && b.stats.reviewCount === 0) return -1;
    if (a.stats.reviewCount === 0 && b.stats.reviewCount > 0) return 1;
    return b.stats.averageRating - a.stats.averageRating;
  });
}

function renderTrendCards() {
  const container = document.getElementById('trendCards');
  if (!container) return;

  const searchQuery = document.getElementById('searchInput')?.value.toLowerCase() || '';
  const filteredTrend = trendingExhibitions.length ? applyFilters(trendingExhibitions) : [];
  const baseList = trendingExhibitions.length ? filteredTrend : filteredVenueExhibitions;
  const list = (trendingExhibitions.length
    ? Array.from(new Map([...baseList, ...filteredVenueExhibitions].map((e) => [e._id, e])).values())
    : filteredVenueExhibitions)
    .filter((e) => {
      const title = sanitizeText(e.title || '').toLowerCase();
      const venueName = sanitizeText(e.venue?.name || '').toLowerCase();
      const artists = Array.isArray(e.artists) ? e.artists.join(' ').toLowerCase() : '';
      const matchesQuery = !searchQuery || title.includes(searchQuery) || venueName.includes(searchQuery) || artists.includes(searchQuery);
      return matchesQuery;
    })
    .filter((e) => !isExcludedExhibition(e));

  const venueMap = new Map();
  list.forEach((exhibition) => {
    const venueName = exhibition.venue?.name || '기타';
    if (!venueMap.has(venueName)) {
      venueMap.set(venueName, []);
    }
    venueMap.get(venueName).push(exhibition);
  });

  // pinnedVenueName이 있는 경우 목록에 없으면 강제로 추가 (venues 배열에서 직접 가져옴)
  if (pinnedVenueName) {
    const pinnedVenue = venues.find((v) => normalizeVenueKey(v.name) === normalizeVenueKey(pinnedVenueName));
    if (pinnedVenue && pinnedVenue.exhibitions && pinnedVenue.exhibitions.length > 0) {
      venueMap.set(pinnedVenue.name, pinnedVenue.exhibitions);
    }
  }

  const groups = Array.from(venueMap.entries()).map(([venueName, exhibitions]) => {
    const sortedBySource = exhibitions.slice().sort((a, b) => {
      const aPriority = getSourcePriority(a._source);
      const bPriority = getSourcePriority(b._source);
      if (aPriority !== bPriority) return aPriority - bPriority;
      const aRating = (a.stats?.reviewCount || 0) > 0 ? (a.stats?.averageRating || 0) : 0;
      const bRating = (b.stats?.reviewCount || 0) > 0 ? (b.stats?.averageRating || 0) : 0;
      if (bRating !== aRating) return bRating - aRating;
      return (b.trend?.score || 0) - (a.trend?.score || 0);
    });
    const bestByRating = exhibitions.slice().sort((a, b) => {
      const aRating = (a.stats?.reviewCount || 0) > 0 ? (a.stats?.averageRating || 0) : 0;
      const bRating = (b.stats?.reviewCount || 0) > 0 ? (b.stats?.averageRating || 0) : 0;
      if (bRating !== aRating) return bRating - aRating;
      if ((b.stats?.reviewCount || 0) !== (a.stats?.reviewCount || 0)) {
        return (b.stats?.reviewCount || 0) - (a.stats?.reviewCount || 0);
      }
      return (b.trend?.score || 0) - (a.trend?.score || 0);
    })[0];
    const groupPriority = Math.min(...exhibitions.map((e) => getSourcePriority(e._source)));
    return { venueName, exhibitions: sortedBySource, bestByRating, groupPriority };
  });

  const distanceSort = currentSort === 'distance' || trendMode === 'distance';

  groups.sort((a, b) => {
    if (pinnedVenueName) {
      if (a.venueName === pinnedVenueName && b.venueName !== pinnedVenueName) return -1;
      if (b.venueName === pinnedVenueName && a.venueName !== pinnedVenueName) return 1;
    }
    if (distanceSort) {
      const ref = getReferenceLocation();
      const aLoc = coerceLatLng(venues.find((v) => v.name === a.venueName)?.location) || coerceLatLng(a.bestByRating?.venue?.location);
      const bLoc = coerceLatLng(venues.find((v) => v.name === b.venueName)?.location) || coerceLatLng(b.bestByRating?.venue?.location);
      const aDist = distanceKm(ref, aLoc);
      const bDist = distanceKm(ref, bLoc);
      return aDist - bDist;
    }

    if (a.groupPriority !== b.groupPriority) return a.groupPriority - b.groupPriority;
    const aTop = a.bestByRating || a.exhibitions[0];
    const bTop = b.bestByRating || b.exhibitions[0];
    const aRating = (aTop?.stats?.reviewCount || 0) > 0 ? (aTop?.stats?.averageRating || 0) : 0;
    const bRating = (bTop?.stats?.reviewCount || 0) > 0 ? (bTop?.stats?.averageRating || 0) : 0;
    if (bRating !== aRating) return bRating - aRating;
    return (bTop?.trend?.score || 0) - (aTop?.trend?.score || 0);
  });

  if (groups.length === 0) {
    container.innerHTML = '<div style="font-size:12px;color:#666;padding:6px 2px;">\ud45c\uc2dc\ud560 \uc804\uc2dc\uac00 \uc5c6\uc2b5\ub2c8\ub2e4</div>';
    return;
  }

  const MAX_GROUPS = 50;          // 기본 노출 한도
  const MAX_GROUPS_FORCED = 50;   // 검색/자세히보기 시 포함 상한

  let visibleGroups = searchQuery ? groups : groups.slice(0, MAX_GROUPS);

  // 핀으로 선택되었거나(말풍선/자세히보기) 현재 펼친 카드가 리스트에 없으면 강제로 포함
  if (!searchQuery) {
    const ensureGroup = (picker) => {
      const g = picker && picker();
      if (!g) return;
      if (!visibleGroups.find((x) => normalizeVenueKey(x.venueName) === normalizeVenueKey(g.venueName))) {
        visibleGroups.push(g);
      }
    };

    ensureGroup(() => groups.find((g) => normalizeVenueKey(g.venueName) === normalizeVenueKey(pinnedVenueName)));
    ensureGroup(() => groups.find((g) => g.exhibitions.some((e) => e._id === expandedCardId)));

    if (visibleGroups.length > MAX_GROUPS_FORCED) {
      visibleGroups = visibleGroups.slice(0, MAX_GROUPS_FORCED);
    }
  }

  // pinnedVenueName이 있고 expandedCardId가 없으면 해당 venue의 첫 전시를 자동 선택
  if (pinnedVenueName && !expandedCardId) {
    const pinnedGroup = visibleGroups.find((g) => normalizeVenueKey(g.venueName) === normalizeVenueKey(pinnedVenueName));
    if (pinnedGroup && pinnedGroup.exhibitions[0]?._id) {
      expandedCardId = pinnedGroup.exhibitions[0]._id;
      venueTabSelection.set(pinnedGroup.venueName, expandedCardId);
    }
  }

  const cards = visibleGroups.map((group) => {
    const defaultId = group.bestByRating?._id || group.exhibitions[0]?._id;
    const selectedId = venueTabSelection.get(group.venueName) || defaultId;
    const exhibition = group.exhibitions.find((e) => e._id === selectedId) || group.exhibitions[0];
    if (!exhibition) return '';
    const imageUrl = exhibition.images && exhibition.images[0]
      ? exhibition.images[0]
      : getFallbackImage(exhibition);
    const title = sanitizeText(exhibition.title || '\uc804\uc2dc \uc815\ubcf4');
    const rawVenueName = exhibition.venue?.name || group.venueName || '';
    const venueName = sanitizeText(rawVenueName);
  const venueInfo = venueDetails.find((v) => normalizeVenueKey(v.name) === normalizeVenueKey(rawVenueName));
    const venueHours = venues.find((v) => v.name === rawVenueName)?.openHours || venueInfo?.openHours || '';
    const openHours = exhibition.openHours?.weekday || venueHours;
    const idAttr = exhibition._id ? `data-id="${exhibition._id}"` : '';
    const isExpanded = exhibition._id && exhibition._id === expandedCardId;
    const periodStr = exhibition.periodUnknown || !exhibition.period?.start || !exhibition.period?.end
      ? '\uae30\uac04 \ubbf8\uc815'
      : `${new Date(exhibition.period.start).toLocaleDateString('ko-KR')} ~ ${new Date(exhibition.period.end).toLocaleDateString('ko-KR')}`;
    const averageRating = typeof exhibition.stats?.averageRating === 'number'
      ? exhibition.stats.averageRating
      : 0;
    const reviewCount = exhibition.stats?.reviewCount || 0;
    const ratingText = reviewCount > 0
      ? `${averageRating.toFixed(1)} (${reviewCount})`
      : '\uc544\uc9c1 \uc5c6\uc74c';
    const priceStr = exhibition.price?.free
      ? '\ubb34\ub8cc'
      : `\uc131\uc778: ${exhibition.price?.adult?.toLocaleString?.() ?? 0}\uc6d0` +
        `${exhibition.price?.youth ? `, \uccad\uc18c\ub144 ${exhibition.price.youth.toLocaleString()}\uc6d0` : ''}` +
        `${exhibition.price?.child ? `, \uc5b4\ub9b0\uc774 ${exhibition.price.child.toLocaleString()}\uc6d0` : ''}`;
    const description = sanitizeText(exhibition.description || '');
    const websiteRaw = exhibition.website || '';
    const websiteLines = websiteRaw.split('\n').map(url => sanitizeUrl(url.trim())).filter(Boolean);
    const officialUrl = websiteLines[0] || '';
    const sourceUrl = websiteLines[1] || '';
    const isCompared = exhibition._id && compareSelection.has(exhibition._id);
    const tabs = group.exhibitions.slice(0, 6).map((exh) => `
      <button class="venue-tab ${exh._id === exhibition._id ? 'active' : ''}"
              data-venue="${group.venueName}" data-id="${exh._id}">
        ${sanitizeText(exh.title || '\uC804\uC2DC')}
      </button>
    `).join('');
    const extraCount = group.exhibitions.length - 6;

    return `
      <div class="trend-card ${isExpanded ? 'expanded' : ''}" ${idAttr}>
        <div class="trend-card-main">
          <div class="trend-card-media">
            <img src="${imageUrl}" alt="${title}"
                 onerror="this.src='${getFallbackImage(exhibition)}'">
            <div class="trend-card-overlay">
              <div class="trend-card-title">${title}</div>
            </div>
          </div>
        </div>
        <div class="trend-card-detail">
          <div class="trend-detail-header">
            <div class="trend-venue-name">${venueName}</div>
            <div class="trend-icons">
              <span class="trend-icon ${(venueInfo?.barrierFree?.wheelchair ?? exhibition.venue?.barrierFree?.wheelchair ?? exhibition.barrierFree?.wheelchair) ? 'active' : 'disabled'}" title="휠체어">♿</span>
              <span class="trend-icon ${(venueInfo?.barrierFree?.accessibleToilet ?? exhibition.venue?.barrierFree?.accessibleToilet ?? exhibition.barrierFree?.accessibleToilet) ? 'active' : 'disabled'}" title="장애인 화장실">🚻</span>
              <span class="trend-icon ${(venueInfo?.barrierFree?.braille ?? exhibition.venue?.barrierFree?.braille ?? exhibition.barrierFree?.braille) ? 'active' : 'disabled'}" title="점자">⠿</span>
              <span class="trend-icon ${(venueInfo?.barrierFree?.audioGuide ?? exhibition.venue?.barrierFree?.audioGuide ?? exhibition.barrierFree?.audioGuide) ? 'active' : 'disabled'}" title="음성안내">🔊</span>
            </div>
          </div>
          <div class="venue-tabs">
            ${tabs}
            ${extraCount > 0 ? `<span class="venue-tab-more">+${extraCount}</span>` : ''}
          </div>
          <div class="trend-detail-row">
            <div class="trend-detail-label">전시기간</div>
            <div>${periodStr}</div>
          </div>
          ${openHours ? `
          <div class="trend-detail-row">
            <div class="trend-detail-label">운영시간</div>
            <div>${openHours}</div>
          </div>` : ''}
          <div class="trend-detail-row">
            <div class="trend-detail-label">주소</div>
            <div>${exhibition.venue?.address || ''}</div>
          </div>
          <div class="trend-detail-row">
            <div class="trend-detail-label">평점</div>
            <div>${ratingText}</div>
          </div>
          <div class="trend-detail-row">
            <div class="trend-detail-label">관람료</div>
            <div>${priceStr}</div>
          </div>
          ${description ? `
          <div class="trend-detail-row">
            <div class="trend-detail-label">설명</div>
            <div class="trend-description">${description}</div>
          </div>` : ''}
          ${officialUrl ? `
          <div class="trend-detail-row">
            <div class="trend-detail-label">사이트</div>
            <div>
              <a href="${officialUrl}" target="_blank" rel="noopener">공식 홈페이지</a>
              ${sourceUrl ? `<br><a href="${sourceUrl}" target="_blank" rel="noopener" style="color:#666;">상세 정보</a>` : ''}
            </div>
          </div>` : ''}
          ${exhibition._id ? `
          <div class="review-section">
            <div class="review-header">
              <div class="detail-title" style="margin:0;">\ub9ac\ubdf0</div>
              <button class="review-write-btn" type="button" data-action="toggle-review">\uc791\uc131</button>
            </div>
            <form class="review-form" data-exhibition-id="${exhibition._id}">
              <div class="form-group">
                <label class="form-label">\uc774\ub984</label>
                <input type="text" class="form-input" name="userName" placeholder="\uc774\ub984">
              </div>
              <div class="form-group">
                <label class="form-label">\ud3c9\uc810</label>
                <select class="form-select" name="rating" required>
                  <option value="">\uc120\ud0dd</option>
                  <option value="5">5</option>
                  <option value="4">4</option>
                  <option value="3">3</option>
                  <option value="2">2</option>
                  <option value="1">1</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">\ucf54\uba58\ud2b8</label>
                <textarea class="form-textarea" name="comment" required></textarea>
              </div>
              <div class="form-buttons">
                <button type="button" class="btn-cancel" data-action="cancel-review">\ucde8\uc18c</button>
                <button type="submit" class="btn-submit">\ub4f1\ub85d</button>
              </div>
            </form>
            <div class="review-list" data-reviews-for="${exhibition._id}"></div>
          </div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = cards;

  container.querySelectorAll('.trend-card').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('button, a, input, select, textarea, .review-form')) {
        return;
      }
      const id = card?.getAttribute('data-id');
      if (!id) return;
      // 먼저 필터링된 리스트에서 찾고, 없으면 전체 리스트에서 찾음
      const exhibition = list.find((e) => e._id === id) || allVenueExhibitions.find((e) => e._id === id);
      if (!exhibition) return;
      expandedCardId = exhibition._id || null;
      pinnedVenueName = exhibition?.venue?.name || null;
      // 클릭한 전시를 해당 venue의 선택된 전시로 설정
      if (pinnedVenueName && expandedCardId) {
        venueTabSelection.set(pinnedVenueName, expandedCardId);
      }
      renderTrendCards();
      if (expandedCardId) scrollToCard(expandedCardId);
      panToExhibitionTwice(exhibition);
    });
  });

  container.querySelectorAll('[data-action="toggle-review"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const card = btn.closest('.trend-card');
      const form = card?.querySelector('.review-form');
      form?.classList.toggle('active');
    });
  });

  container.querySelectorAll('[data-action="cancel-review"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const form = btn.closest('.review-form');
      form?.classList.remove('active');
    });
  });

  container.querySelectorAll('[data-compare-id]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = btn.getAttribute('data-compare-id');
      toggleCompareSelection(id);
      renderTrendCards();
    });
  });

  container.querySelectorAll('.review-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const exhibitionId = form.dataset.exhibitionId;
      const userName = form.querySelector('input[name="userName"]')?.value.trim();
      const rating = Number(form.querySelector('select[name="rating"]')?.value || 0);
      const comment = form.querySelector('textarea[name="comment"]')?.value.trim();
      if (!exhibitionId || !userName || !rating || !comment) return;
      try {
        await postReview({ exhibitionId, userName, rating, comment });
        form.reset();
        form.classList.remove('active');
        await loadData();
      } catch (err) {
        console.error('Failed to post review:', err);
      }
    });
  });

  if (expandedCardId) {
    loadReviews(expandedCardId);
  }

  container.querySelectorAll('.venue-tab').forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.stopPropagation();
      const venueName = tab.dataset.venue;
      const exhibitionId = tab.dataset.id;
      if (!venueName || !exhibitionId) return;
      venueTabSelection.set(venueName, exhibitionId);
      expandedCardId = exhibitionId;
      const target = list.find((e) => e._id === exhibitionId);
      renderTrendCards();
    });
  });
}

function renderReviewItem(review) {
  const avatar = (review.userName || '?').charAt(0).toUpperCase();
  const createdAt = review.createdAt ? new Date(review.createdAt).toLocaleDateString('ko-KR') : '';
  const rating = Number(review.rating || 0);
  const stars = rating > 0 ? '\u2b50'.repeat(Math.min(rating, 5)) : '';
  return `
    <div class="review-item">
      <div class="review-top">
        <div class="review-user">
          <div class="review-avatar">${avatar}</div>
          <div class="review-name">${review.userName || ''}</div>
        </div>
        <div class="review-date">${createdAt}</div>
      </div>
      <div class="review-rating">${stars}</div>
      <div class="review-comment">${review.comment || ''}</div>
    </div>
  `;
}

async function loadReviews(exhibitionId) {
  if (!exhibitionId) return;
  const container = document.querySelector(`[data-reviews-for="${exhibitionId}"]`);
  if (!container) return;
  container.innerHTML = `<div class="empty-reviews">\ub85c\ub529 \uc911...</div>`;
  const reviews = await fetchReviews(exhibitionId).catch(() => []);
  if (!reviews.length) {
    container.innerHTML = `<div class="empty-reviews">\uccab \ub9ac\ubdf0\ub97c \ub0a8\uaca8\uc8fc\uc138\uc694</div>`;
    return;
  }
  container.innerHTML = reviews.map(renderReviewItem).join('');
}

function panToExhibition(exhibition) {
  if (!exhibition) return;
  const venueName = exhibition.venue?.name || '';
  const venue = venues.find((v) => v.name === venueName);
  const preciseMatch = allVenueExhibitions.find((e) => e._id === exhibition._id);
  const pos =
    coerceLatLng(exhibition?.venue?.location) ||
    coerceLatLng(preciseMatch?.venue?.location) ||
    coerceLatLng(venue?.location) ||
    (() => {
      const idx = venues.findIndex((v) => v.name === venueName);
      return idx >= 0 ? coerceLatLng(markerPositions[idx]) : null;
    })() ||
    resolveVenueLocation(
      venueName,
      venue?.address || exhibition?.venue?.address || '',
      venue?.exhibitions || [exhibition]
    );
  if (pos && map) {
    if (mapProvider === 'kakao') {
      const latlng = new kakao.maps.LatLng(pos.lat, pos.lng);
      map.panTo(latlng);
      map.setLevel(3);
    } else {
      map.panTo(pos);
      map.setZoom(15);
    }
  }
}

function panToExhibitionTwice(exhibition) {
  panToExhibition(exhibition);
  setTimeout(() => panToExhibition(exhibition), 120);
}

function scrollToCard(exhibitionId) {
  if (!exhibitionId) return;
  requestAnimationFrame(() => {
    const container = document.getElementById('trendCards');
    const card = container?.querySelector(`.trend-card[data-id="${exhibitionId}"]`);
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

function focusExhibition(exhibition, options = {}) {
  const venueName = exhibition?.venue?.name || '';
  const venueIndex = venues.findIndex((v) => v.name === venueName);
  if (venueIndex === -1) return;

  currentVenue = venues[venueIndex];
  const idx = currentVenue.exhibitions.findIndex((e) => e._id === exhibition._id);
  currentExhibitionIndex = idx >= 0 ? idx : 0;

  panToExhibition(exhibition);

  if (options.render !== false) {
    renderTrendCards();
  }
  if (options.scroll) {
    scrollToCard(exhibition?._id);
  }
}

function openVenuePanel(venue, options = {}) {
  if (!venue) return;
  let exhibition = venue.exhibitions?.find((e) => !isExcludedExhibition(e)) || venue.exhibitions?.[0];
  if (options.exhibitionId) {
    const hit = venue.exhibitions?.find((e) => e._id === options.exhibitionId);
    if (hit) exhibition = hit;
  }

  // 전시가 있어도 pinnedVenueName을 설정 (카드 렌더링시 추가용)
  pinnedVenueName = venue.name || null;
  expandedCardId = exhibition?._id || null;

  if (exhibition) {
    venueTabSelection.set(venue.name, exhibition._id);
    if (options.pan !== false) {
      panToExhibition(exhibition);
    }
  }

  renderTrendCards();

  // DOM 업데이트 후 스크롤 (setTimeout으로 타이밍 보장)
  if (options.scroll !== false && expandedCardId) {
    setTimeout(() => {
      scrollToCard(expandedCardId);
    }, 50);
  }
}

function renderVenueMarkers() {
  if (!map) return;

  markerPositions = [];
  markers.forEach((m) => {
    if (mapProvider === 'kakao') {
      if (m && m.setMap) m.setMap(null);
    } else {
      if (m?.setMap) m.setMap(null);
    }
  });
  markers = [];

  if (filteredVenueExhibitions.length === 0) return;

  // 지도에도 필터링된 전시만 표시 (태그, 검색어 등 적용)
  const validExhibitions = filteredVenueExhibitions.filter((e) => !isExcludedExhibition(e));
  const venueNames = new Set(validExhibitions.map((e) => e.venue?.name).filter(Boolean));
  const filteredVenues = venues.filter((v) => venueNames.has(v.name));

  if (mapProvider === 'kakao') {
    if (!window.kakao || !window.kakao.maps) return;
    const bounds = new kakao.maps.LatLngBounds();
    filteredVenues.forEach((venue, displayIndex) => {
      const position = coerceLatLng(venue.location);
      if (!position) return;
      // 원본 venues 배열에서의 인덱스를 찾음
      const venueIndex = venues.findIndex((v) => v.name === venue.name);
      const latlng = new kakao.maps.LatLng(position.lat, position.lng);
      const marker = new kakao.maps.Marker({
        position: latlng,
        map
      });
      kakao.maps.event.addListener(marker, 'click', () => {
        console.log('[마커 클릭] venueIndex:', venueIndex, 'venue:', venue.name);
        // 기존 오버레이 닫기
        if (currentOverlay) {
          if (currentOverlay.setMap) currentOverlay.setMap(null);
          else if (currentOverlay.close) currentOverlay.close();
          currentOverlay = null;
        }
        const firstExh = venue.exhibitions.find((e) => !isExcludedExhibition(e)) || venue.exhibitions[0];
        console.log('[마커 클릭] firstExh:', firstExh?.title);
        if (venueIndex >= 0) {
          showVenueDetail(venueIndex, firstExh?._id || '');
        } else {
          showVenueDetailByVenue(venue, firstExh?._id || '');
        }
      });
      markers.push(marker);
      markerPositions[displayIndex] = { lat: position.lat, lng: position.lng };
      bounds.extend(latlng);
    });
    if (markers.length > 1) {
      map.setBounds(bounds);
    } else if (markers.length === 1) {
      map.setCenter(bounds.getSouthWest());
      map.setLevel(4);
    }
    return;
  }

  if (typeof google === 'undefined' || !google.maps || !google.maps.Marker) return;
  const bounds = new google.maps.LatLngBounds();

  filteredVenues.forEach((venue, displayIndex) => {
    const position = coerceLatLng(venue.location);
    if (!position) return;
    // 원본 venues 배열에서의 인덱스를 찾음
    const venueIndex = venues.findIndex((v) => v.name === venue.name);

    const marker = new google.maps.Marker({
      position,
      map,
      title: venue.name,
      label: {
        text: String(displayIndex + 1),
        color: '#FFFFFF',
        fontWeight: 'bold',
        fontSize: '16px'
      },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 18,
        fillColor: '#1FB2A6',
        fillOpacity: 1,
        strokeColor: '#FFFFFF',
        strokeWeight: 3
      }
    });

    marker.addListener('click', () => {
      console.log('[마커 클릭] venueIndex:', venueIndex, 'venue:', venue.name);
      // 기존 오버레이 닫기
      if (currentOverlay) {
        if (currentOverlay.setMap) currentOverlay.setMap(null);
        else if (currentOverlay.close) currentOverlay.close();
        currentOverlay = null;
      }
      const firstExh = venue.exhibitions.find((e) => !isExcludedExhibition(e)) || venue.exhibitions[0];
      console.log('[마커 클릭] firstExh:', firstExh?.title);
      if (venueIndex >= 0) {
        showVenueDetail(venueIndex, firstExh?._id || '');
      } else {
        showVenueDetailByVenue(venue, firstExh?._id || '');
      }
    });

    markers.push(marker);
    markerPositions[displayIndex] = { lat: position.lat, lng: position.lng };
    bounds.extend(position);
  });

  if (markers.length > 0) {
    if (markers.length === 1) {
      const onlyPosition = markers[0].getPosition();
      if (onlyPosition) map.setCenter(onlyPosition);
      map.setZoom(13);
    } else {
      map.fitBounds(bounds);
      google.maps.event.addListenerOnce(map, 'bounds_changed', function() {
        const currentZoom = map.getZoom();
        if (currentZoom > 14) map.setZoom(14);
      });
    }
  }
}

function showInfoWindow(marker, venue, venueIndex) {
  if (currentOverlay) {
    if (mapProvider === 'kakao') {
      currentOverlay.setMap(null);
    } else {
      currentOverlay.close();
    }
    currentOverlay = null;
  }

  const firstExhibition = venue.exhibitions.find((e) => !isExcludedExhibition(e)) || venue.exhibitions[0] || {};
  const imageUrl = firstExhibition.images && firstExhibition.images[0]
    ? firstExhibition.images[0]
    : getFallbackImage(firstExhibition);
  const exhibitionTitle = sanitizeText(firstExhibition.title || '\uc804\uc2dc \uc815\ubcf4');
  const exhId = firstExhibition._id || '';

  const content = document.createElement('div');
  content.style.cssText = 'background: white; padding: 12px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); width: 240px; position: relative;';
  
  content.innerHTML = `
    <button class="overlay-close" style="position: absolute; top: 8px; right: 8px; border: none; background: none; cursor: pointer; font-size: 16px; padding: 0; color: #666;">×</button>
    <div style="margin-bottom: 8px;">
      <img src="${imageUrl}" style="width: 100%; height: 120px; object-fit: cover; border-radius: 4px;" onerror="this.src='${getFallbackImage(firstExhibition)}'">
    </div>
    <div style="font-weight: bold; font-size: 14px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${exhibitionTitle}</div>
    <div style="font-size: 12px; color: #666; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${venue.name}</div>
    <button class="overlay-detail-btn" style="width: 100%; background: #1FB2A6; color: white; border: none; padding: 8px 0; border-radius: 4px; cursor: pointer; font-size: 13px;">자세히 보기</button>
  `;

  const closeBtn = content.querySelector('.overlay-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeOverlay();
    });
  }

  const detailBtn = content.querySelector('.overlay-detail-btn');
  if (detailBtn) {
    detailBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (venueIndex >= 0) {
        window.showVenueDetail(venueIndex, exhId);
      } else {
        showVenueDetailByVenue(venue, exhId);
      }
    });
  }

  if (mapProvider === 'kakao') {
    const overlay = new kakao.maps.CustomOverlay({
      content: content,
      position: marker.getPosition(),
      yAnchor: 1.3,
      zIndex: 100,
      clickable: true
    });
    overlay.setMap(map);
    currentOverlay = overlay;
  } else {
    const infoWindow = new google.maps.InfoWindow({ content: content });
    infoWindow.open(map, marker);
    currentOverlay = infoWindow;
  }
}

function showVenueDetailByVenue(venue, exhibitionId = '') {
  console.log('[showVenueDetailByVenue] venue:', venue?.name, 'exhibitionId:', exhibitionId);
  if (!venue) {
    console.log('[showVenueDetailByVenue] venue not found, returning');
    return;
  }
  const target =
    (exhibitionId && venue.exhibitions.find((e) => e._id === exhibitionId)) ||
    venue.exhibitions.find((e) => !isExcludedExhibition(e)) ||
    venue.exhibitions?.[0] ||
    allVenueExhibitions.find((e) => normalizeVenueKey(e.venue?.name) === normalizeVenueKey(venue.name));
  if (!target) return;

  currentVenue = venue;
  currentExhibitionIndex = venue.exhibitions.findIndex((e) => e._id === target._id);
  if (currentExhibitionIndex < 0) currentExhibitionIndex = 0;
  expandedCardId = target._id || null;
  pinnedVenueName = venue.name || null;

  const pos =
    coerceLatLng(currentVenue.location) ||
    coerceLatLng(target?.venue?.location) ||
    resolveVenueLocation(
      venue.name,
      venue.address || target?.venue?.address || '',
      venue.exhibitions
    );
  if (pos && map) {
    if (mapProvider === 'kakao') {
      const latlng = new kakao.maps.LatLng(pos.lat, pos.lng);
      map.panTo(latlng);
      map.setLevel(3);
    } else {
      map.panTo(pos);
      map.setZoom(15);
    }
  }

  openVenuePanel(currentVenue, { pan: false, scroll: true, exhibitionId: target._id });
  setTimeout(() => scrollToCard(target._id), 30);
  panToExhibitionTwice(target);
  openExhibitionModal(target);
}

window.closeOverlay = function() {
  if (currentOverlay) {
    if (mapProvider === 'kakao') {
      currentOverlay.setMap(null);
    } else {
      currentOverlay.close();
    }
    currentOverlay = null;
  }
};

window.showVenueDetail = function(venueIndex, exhibitionId = '') {
  console.log('[showVenueDetail] venueIndex:', venueIndex, 'exhibitionId:', exhibitionId);
  const venue = venues[venueIndex];
  console.log('[showVenueDetail] venue:', venue?.name);
  if (!venue) {
    console.log('[showVenueDetail] venue not found, returning');
    return;
  }
  const target =
    (exhibitionId && venue.exhibitions.find((e) => e._id === exhibitionId)) ||
    venue.exhibitions.find((e) => !isExcludedExhibition(e)) ||
    venue.exhibitions?.[0] ||
    allVenueExhibitions.find((e) => normalizeVenueKey(e.venue?.name) === normalizeVenueKey(venue.name));
  if (!target) return;

  currentVenue = venue;
  currentExhibitionIndex = venue.exhibitions.findIndex((e) => e._id === target._id);
  if (currentExhibitionIndex < 0) currentExhibitionIndex = 0;
  expandedCardId = target._id || null;
  pinnedVenueName = venue.name || null;

  const pos =
    coerceLatLng(currentVenue.location) ||
    coerceLatLng(target?.venue?.location) ||
    resolveVenueLocation(
      venue.name,
      venue.address || target?.venue?.address || '',
      venue.exhibitions
    );
  if (pos && map) {
    if (mapProvider === 'kakao') {
      const latlng = new kakao.maps.LatLng(pos.lat, pos.lng);
      map.panTo(latlng);
      if (map.setLevel) map.setLevel(3);
    } else {
      map.panTo(pos);
      if (map.setZoom) map.setZoom(15);
    }
  }

  openVenuePanel(currentVenue, { pan: false, scroll: true, exhibitionId: target._id });
  // 카드 DOM이 재구성된 직후 보장 스크롤
  setTimeout(() => scrollToCard(target._id), 30);
  panToExhibitionTwice(target);
  openExhibitionModal(target);
};

window.toggleFilter = function(type) {
  filters[type] = !filters[type];
  document.getElementById(`${type}Filter`)?.classList.toggle('active');
  refresh();
};

// 검색 입력 시 패널 닫기: 새 검색 결과로 혼동 방지
document.getElementById('searchInput')?.addEventListener('input', () => {
  expandedCardId = null;
  pinnedVenueName = null;
  currentVenue = null;
  currentExhibitionIndex = 0;
  closeExhibitionModal();
  refresh();
});

// ---------------- 모달(지도 위 간단 상세) ----------------
function openExhibitionModal(exh) {
  if (!exh) return;
  const existing = document.getElementById('exhibitionModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'exhibitionModal';
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; right:0; bottom:0;
    background: rgba(0,0,0,0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width: 360px;
    max-width: 90vw;
    max-height: 90vh;
    overflow-y: auto;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.25);
    padding: 16px;
    font-family: 'Pretendard', 'Noto Sans KR', sans-serif;
  `;

  const periodText = exh.periodUnknown || !exh.period?.start || !exh.period?.end
    ? '기간 미정'
    : `${new Date(exh.period.start).toLocaleDateString('ko-KR')} ~ ${new Date(exh.period.end).toLocaleDateString('ko-KR')}`;
  const priceText = exh.price?.free
    ? '무료'
    : `성인 ${exh.price?.adult?.toLocaleString?.() ?? 0}원`;
  const img = (exh.images && exh.images[0]) || getFallbackImage(exh);

  card.innerHTML = `
    <div style="position:relative;">
      <img src="${img}" alt="${sanitizeText(exh.title || '전시')}" style="width:100%; height:180px; object-fit:cover; border-radius:8px;">
      <button id="modalCloseBtn" style="position:absolute; top:8px; right:8px; background:#111; color:#fff; border:none; width:32px; height:32px; border-radius:50%; cursor:pointer;">×</button>
    </div>
    <h2 style="margin:12px 0 6px; font-size:18px; line-height:1.4;">${sanitizeText(exh.title)}</h2>
    <div style="color:#555; font-size:14px; margin-bottom:6px;">${sanitizeText(exh.venue?.name || '')}</div>
    <div style="color:#777; font-size:13px; margin-bottom:6px;">${periodText}</div>
    <div style="color:#777; font-size:13px; margin-bottom:10px;">${priceText}</div>
    ${exh.description ? `<p style="color:#333; font-size:14px; line-height:1.6; white-space:pre-wrap;">${sanitizeText(exh.description)}</p>` : ''}
    ${exh.website ? (() => {
      const urls = exh.website.split('\n').map(u => u.trim()).filter(Boolean);
      const official = urls[0] || '';
      const source = urls[1] || '';
      return `
        <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
          ${official ? `<a href="${official}" target="_blank" style="padding:10px 14px; background:#1FB2A6; color:#fff; border-radius:8px; text-decoration:none;">공식 홈페이지</a>` : ''}
          ${source ? `<a href="${source}" target="_blank" style="padding:10px 14px; background:#666; color:#fff; border-radius:8px; text-decoration:none;">상세 정보</a>` : ''}
        </div>
      `;
    })() : ''}
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeExhibitionModal();
  });
  card.querySelector('#modalCloseBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeExhibitionModal();
  });

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function closeExhibitionModal() {
  const m = document.getElementById('exhibitionModal');
  if (m) m.remove();
}

window.toggleAdvancedFilters = function() {
  const p = document.getElementById('advancedFilters');
  const t = document.getElementById('advancedToggleText');
  p?.classList.toggle('active');
  if (t) t.textContent = p?.classList.contains('active') ? '\uace0\uae09 \ud544\ud130 \ub2eb\uae30' : '\uace0\uae09 \ud544\ud130 \uc5f4\uae30';
};

window.toggleChipFilter = function(chip) {
  const type = chip.dataset.filter;
  const val = chip.dataset.value;
  chip.classList.toggle('active');
  if (chip.classList.contains('active')) {
    if (!filters[type].includes(val)) filters[type].push(val);
  } else {
    filters[type] = filters[type].filter((v) => v !== val);
  }
  refresh();
};

window.applySort = function() {
  const val = document.getElementById('sortSelect')?.value;
  if (val) setCurrentSort(val);

  if (val === 'distance') {
    // 거리순: 현재 위치 가져온 후 정렬
    trendMode = 'distance';
    getUserLocation().then(() => refresh());
    return;
  }

  if (val === 'trend') {
    // 트렌드순: 캐시된 trendingExhibitions 사용
    trendMode = 'trend';
  }

  refresh();
};

function refresh() {
  const searchQuery = document.getElementById('searchInput')?.value.toLowerCase() || '';

  let venueResult = applyFilters(allVenueExhibitions);
  if (searchQuery) {
    venueResult = venueResult.filter((e) =>
      sanitizeText(e.title || '').toLowerCase().includes(searchQuery) ||
      sanitizeText(e.venue?.name || '').toLowerCase().includes(searchQuery) ||
      e.artists?.some((a) => a.toLowerCase().includes(searchQuery))
    );
  }
  filteredVenueExhibitions = currentSort === 'distance'
    ? sortByDistance(venueResult, getReferenceLocation())
    : sortExhibitions(venueResult, currentSort);

  renderTrendCards();

  if (currentVenue && expandedCardId) renderTrendCards();

  renderVenueMarkers();
}
