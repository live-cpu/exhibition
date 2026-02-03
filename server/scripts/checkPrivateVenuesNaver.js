import dotenv from 'dotenv';
import { fetchNaverSearch } from '../services/naverApi.js';

dotenv.config();

const privateVenues = [
  '대림미술관',
  '아르코미술관',
  '아트선재센터',
  '그라운드 시소',
  '피크닉',
  '갤러리현대'
];

function clean(text) {
  return String(text || '').replace(/<[^>]*>/g, '').trim();
}

function formatMonthDay(date = new Date()) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${m}/${d}`;
}

function parseBlogDate(postdate) {
  if (!postdate || postdate.length !== 8) return null;
  const y = postdate.slice(0, 4);
  const m = postdate.slice(4, 6);
  const d = postdate.slice(6, 8);
  return new Date(`${y}-${m}-${d}`);
}

async function run() {
  const today = new Date();
  const todayKey = formatMonthDay(today);
  const year = today.getFullYear();

  const query = `${todayKey} 전시`;
  const shop = await fetchNaverSearch('shop', query, { display: 10, sort: 'date' }).catch(() => ({ items: [] }));
  const items = shop.items || [];

  const matches = [];
  for (const item of items) {
    const title = clean(item.title);
    const desc = clean(item.description);
    const hay = `${title} ${desc}`;
    for (const venue of privateVenues) {
      if (hay.includes(venue)) {
        matches.push({ venue, title, link: item.link || '' });
      }
    }
  }

  console.log(`Query: ${query}`);
  console.log(`Shopping matches: ${matches.length}`);
  matches.forEach(m => console.log(`- ${m.venue}: ${m.title}`));

  if (matches.length > 0) return;

  // fallback: blog/news with date filter
  console.log('No shopping matches, checking blog/news (current year only)...');
  for (const venue of privateVenues) {
    const blog = await fetchNaverSearch('blog', `${venue} 전시`, { display: 3, sort: 'date' }).catch(() => ({ items: [] }));
    const blogItems = blog.items || [];
    for (const item of blogItems) {
      const postdate = parseBlogDate(item.postdate);
      if (!postdate || postdate.getFullYear() !== year) continue;
      console.log(`- BLOG ${venue}: ${clean(item.title)}`);
    }

    const news = await fetchNaverSearch('news', `${venue} 전시`, { display: 3, sort: 'date' }).catch(() => ({ items: [] }));
    const newsItems = news.items || [];
    for (const item of newsItems) {
      const pub = item.pubDate ? new Date(item.pubDate) : null;
      if (!pub || pub.getFullYear() !== year) continue;
      console.log(`- NEWS ${venue}: ${clean(item.title)}`);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
