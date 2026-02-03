import {getStatus} from './filters.js';

export function formatPrice(p){return p===0?'무료':`${p.toLocaleString()}원`;}
export function formatDate(d){if(!d)return '-';return new Date(d).toLocaleDateString('ko-KR',{month:'short',day:'numeric'});}

function getStatusBadge(s){if(s==='ongoing')return '<span class="card-badge">진행중</span>';if(s==='upcoming')return '<span class="card-badge upcoming">예정</span>';if(s==='ended')return '<span class="card-badge ended">종료</span>';if(s==='unknown')return '<span class="card-badge unknown">기간미정</span>';return '';}

const FALLBACK_IMAGES=[
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=800&h=400&fit=crop',
  'https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?w=800&h=400&fit=crop',
  'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=800&h=400&fit=crop',
  'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800&h=400&fit=crop',
  'https://images.unsplash.com/photo-1496307042754-b4aa456c4a2d?w=800&h=400&fit=crop',
  'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&h=400&fit=crop'
];

function hashString(value){
  let hash=0;
  const str=String(value||'');
  for(let i=0;i<str.length;i+=1){
    hash=((hash<<5)-hash)+str.charCodeAt(i);
    hash|=0;
  }
  return Math.abs(hash);
}

function getFallbackImage(exh){
  const key=`${exh?.venue?.name||''}-${exh?.title||''}`;
  return FALLBACK_IMAGES[hashString(key)%FALLBACK_IMAGES.length];
}

export function renderCard(exh,expanded,overallRating=null,totalReviews=0,hasMultiple=false){
const status=getStatus(exh);
const venueName=exh.venue?.name||'전시장';
const venueAddress=exh.venue?.address||'';
const periodText=exh.periodUnknown||!exh.period?.start||!exh.period?.end?'기간 미정':`${formatDate(exh.period.start)} ~ ${formatDate(exh.period.end)}`;
// 개별 전시 평점
const exhibitionRating=exh.stats.reviewCount>0?`<div class="card-rating"><span class="rating-label">이 전시</span> ⭐ ${exh.stats.averageRating.toFixed(1)} <span style="color: #999;">(${exh.stats.reviewCount})</span></div>`:'';
// 전체 평점 (여러 전시가 있을 때만 표시)
const overallRatingDisplay=hasMultiple && overallRating?`<div class="card-rating overall"><span class="rating-label">전체 평점</span> ⭐ ${overallRating} <span style="color: #999;">(${totalReviews})</span></div>`:'';

// 이미지 처리
const mainImage=exh.images && exh.images.length>0?exh.images[0]:getFallbackImage(exh);
const imageDisplay=`<div class="card-image"><img src="${mainImage}" alt="${exh.title}" onerror="this.src='${getFallbackImage(exh)}'"></div>`;

return `<div class="exhibition-card ${expanded?'expanded':''}" id="card-${exh._id}">
${imageDisplay}
<div class="card-header" onclick="toggleCard('${exh._id}')">
<div class="card-title">${exh.title}${getStatusBadge(status)}</div>
<div class="card-venue">📍 ${venueName}</div>
<div class="card-info">📅 ${periodText}</div>
<div class="card-info">💰 ${formatPrice(exh.price?.adult||0)}</div>
${overallRatingDisplay}
${exhibitionRating}
<div class="card-facilities">
<div class="facility-icon ${exh.barrierFree?.wheelchair?'active':'disabled'}">♿</div>
<div class="facility-icon ${exh.barrierFree?.elevator?'active':'disabled'}">🛗</div>
<div class="facility-icon ${exh.barrierFree?.braille?'active':'disabled'}">👆</div>
<div class="facility-icon ${exh.barrierFree?.audioGuide?'active':'disabled'}">🎧</div>
</div></div>
<div class="card-detail">
<div class="detail-section"><div class="detail-title">상세 정보</div>
<div class="detail-item"><span class="detail-label">주소</span><span class="detail-value">${venueAddress}</span></div>
${exh.openHours?`<div class="detail-item"><span class="detail-label">운영시간</span><span class="detail-value">평일 ${exh.openHours.weekday||'-'}<br>주말 ${exh.openHours.weekend||'-'}${exh.openHours.closed?.length>0?`<br>휴관: ${exh.openHours.closed.join(', ')}`:''}</span></div>`:''}
<div class="detail-item"><span class="detail-label">관람료</span><span class="detail-value">성인 ${formatPrice(exh.price?.adult||0)}<br>청소년 ${formatPrice(exh.price?.youth||0)}<br>어린이 ${formatPrice(exh.price?.child||0)}</span></div>
${exh.artists?.length>0?`<div class="detail-item"><span class="detail-label">작가</span><span class="detail-value">${exh.artists.join(', ')}</span></div>`:''}
${exh.website?(()=>{const urls=exh.website.split('\n').map(u=>u.trim()).filter(Boolean);const official=urls[0]||'';const source=urls[1]||'';return `<div class="detail-item"><span class="detail-label">웹사이트</span><span class="detail-value"><a href="${official}" target="_blank">공식 홈페이지 →</a>${source?`<br><a href="${source}" target="_blank" style="color:#666;">상세 정보 →</a>`:''}</span></div>`;})():''}
</div>
${exh.description?`<div class="detail-section"><div class="detail-title">전시 소개</div><div class="detail-value">${exh.description}</div></div>`:''}
<div class="review-section"><div class="review-header"><div class="detail-title" style="margin:0;">리뷰</div><button class="review-write-btn" onclick="toggleReviewForm('${exh._id}')">작성</button></div>
<form class="review-form" id="form-${exh._id}" onsubmit="submitReview(event,'${exh._id}')">
<div class="form-group"><label class="form-label">닉네임</label><input type="text" class="form-input" placeholder="익명"></div>
<div class="form-group"><label class="form-label">평점</label><select class="form-select" required><option value="">선택</option><option value="5">⭐⭐⭐⭐⭐</option><option value="4">⭐⭐⭐⭐</option><option value="3">⭐⭐⭐</option><option value="2">⭐⭐</option><option value="1">⭐</option></select></div>
<div class="form-group"><label class="form-label">후기</label><textarea class="form-textarea" required></textarea></div>
<div class="form-buttons"><button type="button" class="btn-cancel" onclick="toggleReviewForm('${exh._id}')">취소</button><button type="submit" class="btn-submit">등록</button></div>
</form><div class="review-list" id="reviews-${exh._id}"></div></div></div></div>`;}

export function renderReview(r){
const avatar=r.userName.charAt(0).toUpperCase();
const colors=['#1a73e8','#34a853','#fbbc04','#ea4335','#9334e6','#00bfa5'];
const colorIndex=r.userName.charCodeAt(0)%colors.length;
const bgColor=colors[colorIndex];
return `<div class="review-item" style="background: white; padding: 16px; margin-bottom: 12px; border-radius: 8px; border: 1px solid #e0e0e0;">
<div class="review-top" style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px;">
<div class="review-avatar" style="width: 40px; height: 40px; border-radius: 50%; background: ${bgColor}; color: white; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 500; flex-shrink: 0;">${avatar}</div>
<div style="flex: 1;">
<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
<span class="review-name" style="font-size: 14px; font-weight: 500; color: #202124;">${r.userName}</span>
<span class="review-date" style="font-size: 12px; color: #5f6368;">${new Date(r.createdAt).toLocaleDateString('ko-KR')}</span>
</div>
<div class="review-rating" style="color: #fbbc04; font-size: 14px; margin-bottom: 8px;">${'⭐'.repeat(r.rating)}</div>
<p class="review-comment" style="margin: 0; font-size: 14px; color: #3c4043; line-height: 1.6;">${r.comment}</p>
</div>
</div>
</div>`;
}
