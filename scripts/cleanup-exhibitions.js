import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Exhibition from '../server/models/Exhibition.js';

dotenv.config();

const DRY_RUN = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';

const EXCLUDE_KEYWORDS = [
  '관람안내',
  '관람 정보',
  '관람정보',
  '오시는길',
  '찾아오는길',
  '주차',
  '시설안내',
  '이용안내',
  '대관',
  '대관안내',
  '대관 신청',
  '공지',
  '공지사항',
  '채용',
  '교육',
  '아카데미',
  '운영시간',
  '휴관',
  '예약',
  '입장',
  '전시장 소개',
  '미술관 소개'
];

const EXHIBITION_KEYWORDS = [
  '전시',
  '특별전',
  '기획전',
  '회고전',
  '개인전',
  '단체전',
  '展'
];

const DOMAIN_BLOCKLIST = [
  'news.naver.com',
  'n.news.naver.com',
  'm.news.naver.com',
  'news.daum.net',
  'm.news.nate.com',
  'news.kmib.co.kr',
  'news.mt.co.kr',
  'newsis.com',
  'yonhapnews.co.kr',
  'joongang.co.kr',
  'chosun.com',
  'hani.co.kr',
  'mk.co.kr',
  'naver.com/entertain',
  'blog.naver.com',
  'm.blog.naver.com',
  'tistory.com',
  'brunch.co.kr',
  'medium.com',
  'velog.io'
];

function hasKeyword(text, keywords) {
  const haystack = String(text || '').toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}

function hasExcludedKeyword(text) {
  const haystack = String(text || '').toLowerCase();
  return EXCLUDE_KEYWORDS.some((k) => haystack.includes(k.toLowerCase()));
}

function isLikelyExhibitionTitle(title) {
  if (!title) return false;
  const value = String(title).trim();
  if (value.length < 3) return false;
  if (hasExcludedKeyword(value)) return false;
  if (hasKeyword(value, EXHIBITION_KEYWORDS)) return true;
  if (/[《「“"']/g.test(value)) return true;
  return false;
}

function shouldDelete(exhibition) {
  const source = exhibition?._source || '';
  if (!['naver_search', 'brave_search'].includes(source)) return false;

  const title = exhibition?.title || '';
  const desc = exhibition?.description || '';
  const text = `${title} ${desc}`;

  if (!isLikelyExhibitionTitle(title)) return true;
  if (hasExcludedKeyword(text)) return true;

  const website = String(exhibition?.website || '').toLowerCase();
  if (website) {
    for (const domain of DOMAIN_BLOCKLIST) {
      if (website.includes(domain)) return true;
    }
  }

  // 전시장/미술관 이름만 있는 경우 제거
  const venueName = String(exhibition?.venue?.name || '').trim();
  if (venueName && title.replace(/\s+/g, '') === venueName.replace(/\s+/g, '')) return true;
  if (!hasKeyword(title, EXHIBITION_KEYWORDS) && /(미술관|전시장|전시관|갤러리)\s*$/i.test(title)) return true;

  return false;
}

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    const exhibitions = await Exhibition.find({ _source: { $in: ['naver_search', 'brave_search'] } });
    const toDelete = exhibitions.filter(shouldDelete);

    console.log(`Found ${exhibitions.length} candidate records.`);
    console.log(`Will delete ${toDelete.length} records. (DRY_RUN=${DRY_RUN})`);

    if (DRY_RUN) {
      console.log('Sample titles:');
      toDelete.slice(0, 20).forEach((e) => console.log(`- ${e.title} (${e.website || '-'})`));
      return;
    }

    const ids = toDelete.map((e) => e._id);
    if (ids.length) {
      await Exhibition.deleteMany({ _id: { $in: ids } });
      console.log(`✅ Deleted ${ids.length} records.`);
    }
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
