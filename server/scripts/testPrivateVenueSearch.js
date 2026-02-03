/**
 * 사립 미술관 전시 검색 테스트 스크립트 v3
 * 전략:
 * 1. 전시장명으로 쇼핑 검색 → 입장권 상품에서 전시명 추출
 * 2. 전시명으로 블로그 검색 → 기간, 가격, 상세 전시장 위치 추출
 */
import dotenv from 'dotenv';
import { fetchNaverSearch } from '../services/naverApi.js';
import { getPrivateVenueSearchList, extractVenueFromText } from '../services/venueNormalizer.js';
import { extractPeriod, extractPrice, extractExhibitionTitle, isGoods, isNoisy, getPeriodStatus, isValidExhibitionTitle } from '../services/exhibitionParser.js';

dotenv.config();

function clean(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .trim();
}

// 추출된 전시명 정제
function cleanExhibitionTitle(title) {
  let t = String(title || '').trim();

  // HTML 엔티티 변환
  t = t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

  // 꺽쇠 안의 텍스트 추출 (전시명 패턴)
  const bracketMatch = t.match(/[<《「『"']([^<>《》「」『』""'']+)[>》」』"']/);
  if (bracketMatch && bracketMatch[1].length >= 3) {
    return bracketMatch[1].trim();
  }

  // 작가명 + 전시명 패턴: "작가명: 전시명" or "작가명 - 전시명"
  const artistMatch = t.match(/^([가-힣a-zA-Z\s]+)[:\-]\s*(.+)$/);
  if (artistMatch && artistMatch[1].length >= 2) {
    // 작가명 포함 형태로 반환
    return `${artistMatch[1].trim()}: ${artistMatch[2].trim()}`;
  }

  // 날짜 패턴 제거 (9/3-2/1), (~12/31) 등
  t = t.replace(/\s*\([~\d\/\-\.]+\)\s*/g, '').trim();
  t = t.replace(/\s*~?\d{1,2}\/\d{1,2}.*$/g, '').trim();

  // 불필요한 접미사 제거
  t = t.replace(/\s*(특별전|개인전|기획전|소장품전|전시회)?\s*(솔직)?\s*(입니다|후기|리뷰)?\.?$/gi, '').trim();

  // 앞뒤 특수문자 정리
  t = t.replace(/^[\s\-|:~\[\]_@,.]+|[\s\-|:~\[\]_@,.]+$/g, '').trim();

  // 연속 공백 정리
  t = t.replace(/\s{2,}/g, ' ');

  return t;
}

async function searchExhibitionsFromShop(venueName, searchKey) {
  console.log(`  [쇼핑] 쿼리: "${searchKey}"`);

  const result = await fetchNaverSearch('shop', searchKey, { display: 20, sort: 'sim' });
  const items = result.items || [];
  console.log(`  [쇼핑] 결과: ${items.length}건`);

  const exhibitions = [];
  const seenTitles = new Set();

  for (const item of items) {
    const rawTitle = clean(item.title);

    // 굿즈/노이즈 제외
    if (isGoods(rawTitle) || isNoisy(rawTitle)) continue;

    // 전시명 추출
    const title = extractExhibitionTitle(rawTitle, venueName);
    if (seenTitles.has(title) || !isValidExhibitionTitle(title)) continue;
    seenTitles.add(title);

    // 가격 (쇼핑 가격)
    const shopPrice = item.lprice ? parseInt(item.lprice, 10) : null;

    exhibitions.push({
      title,
      shopPrice,
      link: item.link || '',
      source: 'shop'
    });
  }

  return exhibitions;
}

async function enrichFromBlog(venueName, exhibition) {
  const query = `${venueName} ${exhibition.title}`;
  console.log(`    [블로그] 쿼리: "${query}"`);

  const result = await fetchNaverSearch('blog', query, { display: 5, sort: 'sim' }).catch(() => ({ items: [] }));
  const items = result.items || [];

  let period = null;
  let price = null;
  let detailedVenue = null;

  for (const item of items) {
    const text = `${clean(item.title)} ${clean(item.description)}`;

    // 기간 추출 (최신 우선 - 연장 고려)
    const extractedPeriod = extractPeriod(text);
    if (extractedPeriod) {
      // 더 긴 기간(연장된 것)을 우선
      if (!period || (extractedPeriod.end && period.end && extractedPeriod.end > period.end)) {
        period = extractedPeriod;
      }
    }

    // 가격 추출
    if (!price) {
      price = extractPrice(text);
    }

    // 상세 전시장 (그라운드시소 지점 등)
    if (!detailedVenue) {
      detailedVenue = extractVenueFromText(text);
    }
  }

  return { period, price, detailedVenue };
}

async function searchFromBlogDirect(venueName, debug = false) {
  // 블로그에서 직접 전시 정보 검색 (쇼핑 결과 없는 경우)
  console.log(`  [블로그 직접] 쿼리: "${venueName} 전시"`);

  const result = await fetchNaverSearch('blog', `${venueName} 전시`, { display: 10, sort: 'sim' }).catch(() => ({ items: [] }));
  const items = result.items || [];
  console.log(`  [블로그 직접] 결과: ${items.length}건`);

  const exhibitions = [];
  const seenTitles = new Set();

  for (const item of items) {
    const blogTitle = clean(item.title);
    const desc = clean(item.description);
    const text = `${blogTitle} ${desc}`;

    if (debug) console.log(`    [DEBUG] 블로그: "${blogTitle}"`);

    // 기간 추출
    const period = extractPeriod(text);

    // 전시명 추출 시도 (여러 패턴)
    let exhTitle = null;
    let extractMethod = '';

    // 1. 꺽쇠/따옴표 안의 텍스트 (전시명 표기 패턴)
    const quotedMatch = blogTitle.match(/[<《「『"']([^<>《》「」『』""'']{3,40})[>》」』"']/);
    if (quotedMatch) {
      exhTitle = quotedMatch[1];
      extractMethod = '따옴표';
    }

    // 2. 블로그 제목에서 전시장명 + 일반어 제거 → 남는 게 전시명
    if (!exhTitle) {
      let titleCandidate = blogTitle
        .replace(new RegExp(venueName, 'gi'), '')
        .replace(/전시|관람|후기|리뷰|방문|예매|예약|입장|무료|할인|정보|추천|데이트|서울|가볼만한곳/gi, '')
        .trim();
      // 앞뒤 불필요한 문자 제거
      titleCandidate = titleCandidate.replace(/^[\s\-|:~\[\]]+|[\s\-|:~\[\]]+$/g, '').trim();

      if (debug) console.log(`      → 전시장명 제거 후: "${titleCandidate}"`);

      if (titleCandidate.length >= 3 && titleCandidate.length <= 50) {
        exhTitle = titleCandidate;
        extractMethod = '제목정제';
      }
    }

    if (!exhTitle) continue;

    // 전시명 정제
    exhTitle = cleanExhibitionTitle(exhTitle);

    if (debug) console.log(`      → 추출: "${exhTitle}" (${extractMethod})`);

    if (!exhTitle || exhTitle.length < 3 || seenTitles.has(exhTitle)) continue;

    // 유효성 검증 (추출된 전시명에만 적용)
    if (!isValidExhibitionTitle(exhTitle)) {
      if (debug) console.log(`      → 유효성 검증 실패: "${exhTitle}"`);
      continue;
    }

    seenTitles.add(exhTitle);

    // 기간 없어도 저장 (나중에 확인)
    // 가격 추출
    const price = extractPrice(text);

    // 상세 전시장
    const detailedVenue = extractVenueFromText(text);

    exhibitions.push({
      title: exhTitle,
      period,
      price,
      detailedVenue: detailedVenue || venueName,
      status: period ? getPeriodStatus(period) : 'unknown',
      source: 'blog'
    });
  }

  return exhibitions;
}

async function searchVenue(venue, index, total) {
  console.log(`\n[${ index}/${total}] ${venue.name}`);

  const allExhibitions = [];

  // 블로그 우선 검색 여부
  const DEBUG_VENUES = ['대림미술관', '아트선재센터', '리움미술관'];  // 디버그할 미술관
  const debug = DEBUG_VENUES.includes(venue.name);

  if (venue.useBlogSearch) {
    const blogExhibitions = await searchFromBlogDirect(venue.name, debug);
    allExhibitions.push(...blogExhibitions);

    if (allExhibitions.length > 0) {
      console.log(`  전시 후보: ${allExhibitions.length}건 (블로그)`);
      // 결과 출력
      for (const exh of allExhibitions) {
        const priceStr = exh.price?.free ? '무료' : exh.price?.adult ? `${exh.price.adult.toLocaleString()}원` : '가격 미확인';
        const periodStr = exh.period
          ? `${exh.period.start?.toISOString().split('T')[0] || '?'} ~ ${exh.period.end?.toISOString().split('T')[0] || '?'}`
          : '기간 미확인';
        const venueStr = exh.detailedVenue !== venue.name ? `@ ${exh.detailedVenue}` : '';
        const statusIcon = exh.status === 'ongoing' ? '✓' : exh.status === 'upcoming' ? '⏳' : exh.status === 'ended' ? '✗' : '⚠️';
        console.log(`    ${statusIcon} "${exh.title}" | ${priceStr} | ${periodStr} ${venueStr}`);
      }
      return allExhibitions;
    }
  }

  // 각 검색 키워드로 쇼핑 검색
  for (const searchKey of venue.searchKeys) {
    const exhibitions = await searchExhibitionsFromShop(venue.name, searchKey);

    for (const exh of exhibitions) {
      // 중복 체크
      if (allExhibitions.some(e => e.title === exh.title)) continue;
      allExhibitions.push(exh);
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`  전시 후보: ${allExhibitions.length}건`);

  // 상위 5개만 블로그에서 상세 정보 보강
  for (const exh of allExhibitions.slice(0, 5)) {
    const enriched = await enrichFromBlog(venue.name, exh);

    exh.period = enriched.period;
    exh.price = enriched.price || (exh.shopPrice ? { adult: exh.shopPrice, free: exh.shopPrice === 0 } : null);
    exh.detailedVenue = enriched.detailedVenue || venue.name;
    exh.status = getPeriodStatus(exh.period);

    await new Promise(r => setTimeout(r, 400));
  }

  // 나머지는 기간 미확인
  for (const exh of allExhibitions.slice(5)) {
    exh.status = 'unknown';
    exh.detailedVenue = venue.name;
  }

  // 결과 출력
  for (const exh of allExhibitions) {
    const priceStr = exh.price?.free ? '무료' : exh.price?.adult ? `${exh.price.adult.toLocaleString()}원` : '가격 미확인';
    const periodStr = exh.period
      ? `${exh.period.start?.toISOString().split('T')[0] || '?'} ~ ${exh.period.end?.toISOString().split('T')[0] || '?'}`
      : '기간 미확인';
    const venueStr = exh.detailedVenue !== venue.name ? `@ ${exh.detailedVenue}` : '';
    const statusIcon = exh.status === 'ongoing' ? '✓' : exh.status === 'upcoming' ? '⏳' : exh.status === 'ended' ? '✗' : '⚠️';

    console.log(`    ${statusIcon} "${exh.title}" | ${priceStr} | ${periodStr} ${venueStr}`);
  }

  return allExhibitions;
}

async function run() {
  console.log('=== 사립 미술관 전시 검색 테스트 v3 ===');
  console.log('전략: 쇼핑 → 전시명 추출 → 블로그 → 기간/가격/위치 보강');
  console.log(`시간: ${new Date().toISOString()}\n`);

  const venues = getPrivateVenueSearchList();
  console.log(`검색 대상: ${venues.length}개 미술관`);

  const allResults = [];
  let shopCalls = 0;
  let blogCalls = 0;

  for (let i = 0; i < venues.length; i++) {
    const venue = venues[i];
    const exhibitions = await searchVenue(venue, i + 1, venues.length);

    shopCalls += venue.searchKeys.length;
    blogCalls += Math.min(exhibitions.length, 5);

    for (const exh of exhibitions) {
      allResults.push({ ...exh, venue: venue.name });
    }

    if (i < venues.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // 요약
  const ongoing = allResults.filter(e => e.status === 'ongoing');
  const upcoming = allResults.filter(e => e.status === 'upcoming');
  const ended = allResults.filter(e => e.status === 'ended');
  const unknown = allResults.filter(e => e.status === 'unknown');

  console.log('\n' + '='.repeat(50));
  console.log('=== 요약 ===');
  console.log(`검색: ${venues.length}개 미술관`);
  console.log(`API 호출: 쇼핑 ${shopCalls}회, 블로그 ${blogCalls}회`);
  console.log(`전시 후보: ${allResults.length}건`);
  console.log(`  ✓ 진행중: ${ongoing.length}건`);
  console.log(`  ⏳ 예정: ${upcoming.length}건`);
  console.log(`  ✗ 종료: ${ended.length}건`);
  console.log(`  ⚠️ 기간 미확인: ${unknown.length}건`);

  if (ongoing.length > 0) {
    console.log('\n=== 진행중 전시 (저장 대상) ===');
    for (const exh of ongoing) {
      const priceStr = exh.price?.free ? '무료' : exh.price?.adult ? `${exh.price.adult.toLocaleString()}원` : '';
      console.log(`  [${exh.detailedVenue}] ${exh.title} ${priceStr}`);
      if (exh.period) {
        console.log(`    기간: ${exh.period.start?.toISOString().split('T')[0]} ~ ${exh.period.end?.toISOString().split('T')[0]}`);
      }
    }
  }

  if (unknown.length > 0 && unknown.length <= 10) {
    console.log('\n=== 기간 미확인 (수동 확인 필요) ===');
    for (const exh of unknown) {
      console.log(`  [${exh.venue}] ${exh.title}`);
    }
  }
}

run().catch((err) => {
  console.error('실행 오류:', err);
  process.exit(1);
});
