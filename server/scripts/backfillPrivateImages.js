import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Exhibition from '../models/Exhibition.js';
import { fetchNaverSearch } from '../services/naverApi.js';
import { fetchBraveImageUrls } from '../services/braveSearch.js';

dotenv.config();

const LIMIT = Number(process.env.BACKFILL_PRIVATE_IMAGE_LIMIT || 40);

async function fetchOg(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ExhibitionBot/1.0)' },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    return m?.[1] || null;
  } catch {
    return null;
  }
}

async function getBetterImage(exh) {
  const resolveRelative = (url) => {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    if (exh.website && /^https?:\/\//i.test(exh.website)) {
      try {
        const base = new URL(exh.website);
        if (url.startsWith('/')) {
          return `${base.origin}${url}`;
        }
        return `${base.origin}/${url}`;
      } catch {
        return url;
      }
    }
    return url;
  };

  // 1) exhibition.website OG
  if (exh.website) {
    const img = await fetchOg(exh.website);
    if (img) return img;
  }

  const queryBase = `${exh.title} ${exh.venue?.name || ''}`.trim();

  // 2) 뉴스 링크 OG
  try {
    const news = await fetchNaverSearch('news', `${queryBase} 전시`, { display: 3, sort: 'date' });
    for (const item of news.items || []) {
      const url = item.originallink || item.link;
      const img = await fetchOg(url);
      if (img) return img;
    }
  } catch (e) {
    console.warn('[backfill-private] news fetch fail:', e.message);
  }

  // 3) 블로그 링크 OG
  try {
    const blogs = await fetchNaverSearch('blog', queryBase, { display: 3, sort: 'sim' });
    for (const item of blogs.items || []) {
      const url = item.link;
      const img = await fetchOg(url);
      if (img) return img;
    }
  } catch (e) {
    console.warn('[backfill-private] blog fetch fail:', e.message);
  }

  // 4) 이미지 검색 (naver → brave)
  try {
    const nimg = await fetchNaverSearch('image', `${queryBase} 포스터`, { display: 2, sort: 'sim' });
    const links = (nimg.items || []).map((i) => i.link).filter(Boolean);
    if (links.length) return links[0];
  } catch {}

  const brave = await fetchBraveImageUrls(`${queryBase} poster`, 2);
  return resolveRelative(brave[0] || null);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const targets = await Exhibition.find({
    _source: 'private_search',
    $or: [{ images: { $exists: false } }, { images: { $size: 0 } }]
  })
    .select('title venue website images')
    .limit(LIMIT)
    .lean();

  console.log(`Backfilling private images: ${targets.length}`);

  for (const ex of targets) {
    const img = await getBetterImage(ex);
    if (img) {
      await Exhibition.updateOne({ _id: ex._id }, { $set: { images: [img] } });
      console.log(`+ ${ex.title} -> ${img}`);
    } else {
      console.log(`- ${ex.title}: no image found`);
    }
    await new Promise((r) => setTimeout(r, 300)); // polite pacing
  }

  await mongoose.disconnect();
  console.log('done');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
