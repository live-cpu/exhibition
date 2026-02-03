import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function requireNaverKeys() {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing NAVER_CLIENT_ID or NAVER_CLIENT_SECRET');
  }
  return { clientId, clientSecret };
}

export async function fetchNaverSearch(serviceId, query, options = {}) {
  const { clientId, clientSecret } = requireNaverKeys();
  if (!serviceId) {
    throw new Error('Missing Naver search serviceId');
  }
  if (!query) return { items: [], total: 0 };

  const {
    display = 10,
    start = 1,
    sort = 'sim'
  } = options;

  const url = new URL(`https://openapi.naver.com/v1/search/${serviceId}.json`);
  url.searchParams.set('query', query);
  url.searchParams.set('display', String(display));
  url.searchParams.set('start', String(start));
  if (sort) {
    url.searchParams.set('sort', sort);
  }

  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver search error: ${res.status} ${text}`);
  }

  return await res.json();
}

export async function fetchNaverBlogSearch(query, options = {}) {
  return await fetchNaverSearch('blog', query, options);
}

export async function fetchNaverDataLabTrend(body) {
  const { clientId, clientSecret } = requireNaverKeys();
  if (!body?.startDate || !body?.endDate || !body?.timeUnit || !body?.keywordGroups?.length) {
    throw new Error('Invalid datalab payload');
  }

  const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver datalab error: ${res.status} ${text}`);
  }

  return await res.json();
}

