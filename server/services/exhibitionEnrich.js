import dotenv from 'dotenv';

dotenv.config();

const MAX_BYTES = Number(process.env.ENRICH_MAX_BYTES || 300000);
const TIMEOUT_MS = Number(process.env.ENRICH_TIMEOUT_MS || 10000);

function stripHtml(value) {
  if (!value) return '';
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractMeta(content, name) {
  if (!content) return '';
  const patterns = [
    new RegExp(`<meta[^>]*name=[\"']${name}[\"'][^>]*content=[\"']([^\"']+)[\"'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]*property=[\"']${name}[\"'][^>]*content=[\"']([^\"']+)[\"'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) return stripHtml(match[1]);
  }
  return '';
}

function extractPrice(text) {
  const value = String(text || '');
  if (/무료/.test(value)) {
    return { adult: 0, youth: 0, child: 0, free: true };
  }
  const match = value.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/);
  if (match) {
    const amount = Number(match[1].replace(/,/g, '')) || 0;
    return {
      adult: amount,
      youth: Math.floor(amount * 0.7),
      child: Math.floor(amount * 0.5),
      free: amount === 0
    };
  }
  return null;
}

export async function enrichFromUrl(url) {
  if (!url) return {};
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return {};
    const text = await res.text();
    const snippet = text.slice(0, MAX_BYTES);
    const metaDesc = extractMeta(snippet, 'description') || extractMeta(snippet, 'og:description');
    const price = extractPrice(snippet);
    return {
      description: metaDesc,
      price
    };
  } catch (err) {
    return {};
  }
}
