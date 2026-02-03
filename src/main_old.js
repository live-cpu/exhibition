import { fetchReviews, postReview, fetchAllVenueExhibitions } from './js/api.js';
import { filters, currentSort, applyFilters, sortExhibitions, setCurrentSort } from './js/filters.js';
import { renderCard, renderReview } from './js/ui.js';

let map, allExhibitions = [], filteredExhibitions = [], markers = [], expandedCardId = null;
let allVenueExhibitions = []; // 모든 전시장 전시 데이터
let filteredVenueExhibitions = []; // 필터링된 전시 데이터
let isVenueViewActive = false; // 전시장 뷰가 활성화되어 있는지 여부
let venues = []; // 전시장 목록 (확장성)
let currentVenueIndex = 0; // 현재 선택된 전시장 인덱스

// Google Maps 초기화 함수
async function initializeMap() {
    try {
        const mapElement = document.getElementById("map");
        if (!mapElement) {
            console.error("Map element not found");
            loadData();
            return;
        }

        // Google Maps API가 로드되었는지 확인
        if (typeof google === 'undefined' || !google.maps) {
            console.error("Google Maps API not loaded");
            mapElement.innerHTML = '<div style="padding: 40px; text-align: center; color: #666; font-size: 16px;"><p>⚠️ Google Maps API를 불러올 수 없습니다</p><p style="font-size: 14px; margin-top: 10px; color: #999;">API 키를 확인하거나 네트워크 연결을 확인해주세요.</p></div>';
            loadData();
            return;
        }

        // 기본 지도 생성 (Advanced Markers 없이)
        try {
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
            
            console.log("✅ Map initialized");
            loadData();
        } catch (mapErr) {
            console.error("Map creation error:", mapErr);
            mapElement.innerHTML = '<div style="padding: 40px; text-align: center; color: #666; font-size: 16px;"><p>⚠️ 지도를 생성할 수 없습니다</p><p style="font-size: 14px; margin-top: 10px; color: #999;">에러: ' + mapErr.message + '</p></div>';
            loadData();
        }
    } catch (err) {
        console.error("❌ Map initialization error:", err);
        const mapElement = document.getElementById("map");
        if (mapElement) {
            mapElement.innerHTML = '<div style="padding: 40px; text-align: center; color: #666; font-size: 16px;"><p>⚠️ 지도 초기화 오류</p><p style="font-size: 14px; margin-top: 10px; color: #999;">에러: ' + err.message + '</p></div>';
        }
        loadData();
    }
}

// 1. Google Maps 초기화 (Advanced Marker 방식)
// Google Maps API의 callback으로 호출되거나, DOMContentLoaded에서 호출
window.initMap = initializeMap;

// DOM이 로드되면 지도 초기화 시도 (Google Maps API가 이미 로드된 경우)
document.addEventListener('DOMContentLoaded', () => {
    // Google Maps API가 이미 로드되어 있으면 초기화
    if (typeof google !== 'undefined' && google.maps && !map) {
        console.log("Google Maps already loaded, initializing...");
        initializeMap();
    }
    
    // 검색 입력 이벤트 리스너
    document.getElementById('searchInput')?.addEventListener('input', () => refresh());
});

async function loadData() {
    const listElement = document.getElementById('exhibitionList');
    const resultCount = document.getElementById('resultCount');

    try {
        // 로딩 상태 표시
        if (listElement) {
            listElement.innerHTML = `
                <div class="empty" style="padding: 60px 20px; text-align: center; color: #666;">
                    <div style="margin-bottom: 20px;">
                        <div style="width: 50px; height: 50px; margin: 0 auto; border: 4px solid #f3f3f3; border-top: 4px solid #1FB2A6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    </div>
                    <p style="font-size: 16px; color: #999;">전시 데이터를 불러오는 중...</p>
                </div>
            `;
        }
        if (resultCount) resultCount.textContent = '로딩중...';

        console.log("Loading venue exhibitions...");
        allVenueExhibitions = await fetchAllVenueExhibitions();
        console.log(`✅ Loaded ${allVenueExhibitions.length} venue exhibitions`);

        if (allVenueExhibitions.length === 0) {
            console.warn("No venue exhibitions found");
            if (listElement) {
                listElement.innerHTML = `
                    <div class="empty" style="padding: 40px 20px; text-align: center; color: #666;">
                        <p style="font-size: 48px; margin-bottom: 16px;">⚠️</p>
                        <p style="font-size: 16px; margin-bottom: 8px; color: #333;">전시 데이터가 없습니다</p>
                        <p style="font-size: 14px; color: #999; line-height: 1.6;">
                            API 데이터를 동기화해주세요:<br><br>
                            <code style="background: #f5f5f5; padding: 8px 12px; border-radius: 4px; font-size: 12px; display: inline-block;">
                                POST /api/sac/sync<br>
                                POST /api/acc/sync
                            </code>
                        </p>
                    </div>
                `;
            }
            if (resultCount) resultCount.textContent = '0';
            return;
        }

        // 전시장별로 그룹화 (확장성을 위한 구조)
        venues = groupExhibitionsByVenue(allVenueExhibitions);
        console.log(`✅ Grouped into ${venues.length} venue(s)`);

        // 필터 적용
        filteredVenueExhibitions = applyFilters(allVenueExhibitions);
        filteredVenueExhibitions = sortExhibitions(filteredVenueExhibitions, currentSort);

        // 초기 상태: 리스트에 메시지만 표시
        if (listElement) {
            listElement.innerHTML = `
                <div class="empty" style="padding: 40px 20px; text-align: center; color: #666;">
                    <p style="font-size: 48px; margin-bottom: 16px;">🗺️</p>
                    <p style="font-size: 18px; margin-bottom: 10px; color: #333; font-weight: 500;">전시 정보</p>
                    <p style="font-size: 14px; color: #999; line-height: 1.6;">
                        지도에서 <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #1FB2A6; color: white; border-radius: 50%; font-weight: bold; font-size: 12px; margin: 0 4px;">1</span> 마커를 클릭하면<br>전시 정보를 확인할 수 있습니다
                    </p>
                    <p style="font-size: 13px; color: #bbb; margin-top: 16px;">
                        총 ${filteredVenueExhibitions.length}개의 전시가 있습니다
                    </p>
                </div>
            `;
        }
        if (resultCount) resultCount.textContent = filteredVenueExhibitions.length;

        renderVenueMarkers();
    } catch (err) {
        console.error("❌ 데이터 로드 에러:", err);
        if (listElement) {
            listElement.innerHTML = `
                <div class="empty" style="padding: 40px 20px; text-align: center; color: #666;">
                    <p style="font-size: 48px; margin-bottom: 16px;">❌</p>
                    <p style="font-size: 16px; margin-bottom: 8px; color: #d32f2f;">데이터를 불러올 수 없습니다</p>
                    <p style="font-size: 14px; color: #999; line-height: 1.6;">
                        서버 연결을 확인해주세요<br><br>
                        <span style="font-size: 12px; color: #bbb;">에러: ${err.message}</span>
                    </p>
                </div>
            `;
        }
        if (resultCount) resultCount.textContent = '0';
    }
}

// 전시를 전시장별로 그룹화 (확장성을 위한 함수)
function groupExhibitionsByVenue(exhibitions) {
    const venueMap = new Map();

    exhibitions.forEach(exhibition => {
        const venueName = exhibition.venue?.name || '기타';

        if (!venueMap.has(venueName)) {
            // 전시장 그룹의 평균 평점 계산
            const venueExhibitions = exhibitions.filter(e => e.venue?.name === venueName);
            const withReviews = venueExhibitions.filter(e => e.stats?.reviewCount > 0);
            const avgRating = withReviews.length > 0
                ? withReviews.reduce((sum, e) => sum + e.stats.averageRating, 0) / withReviews.length
                : 0;
            const totalReviews = venueExhibitions.reduce((sum, e) => sum + (e.stats?.reviewCount || 0), 0);

            venueMap.set(venueName, {
                name: venueName,
                address: exhibition.venue?.address || '',
                location: exhibition.venue?.location || null,
                barrierFree: exhibition.venue?.barrierFree || {},
                exhibitions: venueExhibitions,
                stats: {
                    averageRating: avgRating,
                    reviewCount: totalReviews,
                    exhibitionCount: venueExhibitions.length
                }
            });
        }
    });

    // 평점순으로 정렬 (나중에 여러 전시장이 생기면 유용)
    return Array.from(venueMap.values()).sort((a, b) => {
        // 평점이 있는 것을 우선
        if (a.stats.reviewCount > 0 && b.stats.reviewCount === 0) return -1;
        if (a.stats.reviewCount === 0 && b.stats.reviewCount > 0) return 1;
        // 평점순
        return b.stats.averageRating - a.stats.averageRating;
    });
}

// 2. 상태 리프레시 (검색 + 필터 + 정렬)
function refresh() {
    const searchQuery = document.getElementById('searchInput')?.value.toLowerCase() || "";

    // 일반 전시 필터링
    let result = applyFilters(allExhibitions);

    if (searchQuery) {
        result = result.filter(e =>
            e.title.toLowerCase().includes(searchQuery) ||
            e.venue.name.toLowerCase().includes(searchQuery) ||
            e.artists?.some(a => a.toLowerCase().includes(searchQuery))
        );
    }

    filteredExhibitions = sortExhibitions(result, currentSort);

    // 전시장 전시 필터링
    let venueResult = applyFilters(allVenueExhibitions);
    if (searchQuery) {
        venueResult = venueResult.filter(e =>
            e.title.toLowerCase().includes(searchQuery) ||
            e.venue.name.toLowerCase().includes(searchQuery) ||
            e.artists?.some(a => a.toLowerCase().includes(searchQuery))
        );
    }
    filteredVenueExhibitions = sortExhibitions(venueResult, currentSort);

    // 결과 카운트 업데이트
    const totalCount = isVenueViewActive ? filteredVenueExhibitions.length : filteredExhibitions.length;
    document.getElementById('resultCount').textContent = totalCount;

    // 현재 전시장 뷰가 활성화되어 있으면 전시장 전시 다시 렌더링
    if (isVenueViewActive) {
        showVenueExhibitions();
    } else {
        renderList();
        renderMarkers();
    }
}

// 3. UI 렌더링 함수들
function renderList() {
    const c = document.getElementById('exhibitionList');
    if (filteredExhibitions.length === 0) {
        c.innerHTML = '<div class="empty">조건에 맞는 전시가 없습니다</div>';
        return;
    }
    
    // 전시장별로 그룹화
    const venueGroups = {};
    filteredExhibitions.forEach(e => {
        const venueKey = `${e.venue.name}|${e.venue.address}`;
        if (!venueGroups[venueKey]) {
            venueGroups[venueKey] = {
                venue: e.venue,
                exhibitions: []
            };
        }
        venueGroups[venueKey].exhibitions.push(e);
    });
    
    // 그룹화된 전시 렌더링
    c.innerHTML = Object.values(venueGroups).map(group => 
        renderVenueGroup(group, expandedCardId)
    ).join('');
}

function renderVenueGroup(group, expandedId) {
    const { venue, exhibitions } = group;
    const hasMultiple = exhibitions.length > 1;
    const activeExhibition = expandedId ? exhibitions.find(e => e._id === expandedId) : null;
    const displayExhibition = activeExhibition || exhibitions[0];
    
    // 전체 평점 계산 (모든 전시의 평균)
    const allRatings = exhibitions
        .filter(e => e.stats.reviewCount > 0)
        .map(e => e.stats.averageRating);
    const overallRating = allRatings.length > 0 
        ? (allRatings.reduce((a, b) => a + b, 0) / allRatings.length).toFixed(1)
        : null;
    const totalReviews = exhibitions.reduce((sum, e) => sum + e.stats.reviewCount, 0);
    
    return `
        <div class="venue-group" data-venue="${venue.name}">
            ${hasMultiple ? `
                <div class="venue-tabs">
                    ${exhibitions.map((e, idx) => `
                        <button class="venue-tab ${(activeExhibition?._id === e._id || (!activeExhibition && idx === 0)) ? 'active' : ''}" 
                                onclick="selectExhibition('${e._id}')">
                            ${e.title}
                        </button>
                    `).join('')}
                </div>
            ` : ''}
            ${renderCard(displayExhibition, !!activeExhibition, overallRating, totalReviews, hasMultiple)}
        </div>
    `;
}

window.selectExhibition = function(id) {
    expandedCardId = id;
    renderList();
    const card = document.getElementById(`card-${id}`);
    if (card) {
        setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }
};

// 전시장 마커 표시
function renderVenueMarkers() {
    if (!map) {
        console.warn("Map not initialized, skipping markers");
        return;
    }

    if (typeof google === 'undefined' || !google.maps || !google.maps.Marker) {
        console.warn("Google Maps Marker API not available");
        return;
    }

    try {
        // Clear existing markers
        markers.forEach(m => {
            try {
                if (m && m.setMap) m.setMap(null);
            } catch (e) {
                // Ignore cleanup errors
            }
        });
        markers = [];

        if (allVenueExhibitions.length === 0) {
            console.log("No venue exhibitions to display");
            return;
        }

        // 전시장별로 그룹화하여 마커 생성
        const bounds = new google.maps.LatLngBounds();

        venues.forEach((venue, index) => {
            if (!venue.location || !venue.location.lat || !venue.location.lng) {
                console.warn(`Venue ${venue.name} missing location`);
                return;
            }

            const position = { lat: venue.location.lat, lng: venue.location.lng };

            const marker = new google.maps.Marker({
                position: position,
                map: map,
                title: venue.name,
                label: {
                    text: String(index + 1),
                    color: '#FFFFFF',
                    fontWeight: 'bold',
                    fontSize: '16px'
                },
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 18,
                    fillColor: index === 0 ? '#FF6B6B' : '#1FB2A6',
                    fillOpacity: 1,
                    strokeColor: '#FFFFFF',
                    strokeWeight: 3
                }
            });

            // 마커 클릭 시 전시 목록 표시
            marker.addListener('click', () => {
                showVenueExhibitions(index);
            });

            markers.push(marker);

            // 마커 위치를 bounds에 추가
            bounds.extend(position);
        });

        // 모든 마커가 보이도록 지도 범위 조정
        if (markers.length > 0) {
            if (markers.length === 1) {
                // 마커가 하나만 있으면 해당 위치로 중심 이동
                map.setCenter(venues[0].location);
                map.setZoom(13);
            } else {
                // 여러 마커가 있으면 모두 보이도록 범위 조정
                map.fitBounds(bounds);

                // 줌이 너무 크지 않도록 제한 (최대 줌 레벨 14)
                google.maps.event.addListenerOnce(map, 'bounds_changed', function() {
                    const currentZoom = map.getZoom();
                    if (currentZoom > 14) {
                        map.setZoom(14);
                    }
                });
            }
        }

        console.log(`✅ ${venues.length} venue markers rendered with ${allVenueExhibitions.length} exhibitions`);
        console.log(`Venues:`, venues.map(v => ({ name: v.name, location: v.location })));
    } catch (err) {
        console.error("❌ Error rendering venue markers:", err);
    }
}

// 전시장 전시 목록 표시
async function showVenueExhibitions(venueIndex = 0) {
    isVenueViewActive = true;
    currentVenueIndex = venueIndex;
    const listElement = document.getElementById('exhibitionList');
    if (!listElement) return;

    // 현재 전시장 정보
    const currentVenue = venues[venueIndex] || venues[0];
    if (!currentVenue) {
        listElement.innerHTML = '<div class="empty">전시장 정보가 없습니다</div>';
        return;
    }

    // 현재 전시장의 전시만 필터링
    const currentVenueExhibitions = filteredVenueExhibitions.filter(e =>
        e.venue?.name === currentVenue.name
    );

    console.log(`Showing ${currentVenue.name}: ${currentVenueExhibitions.length} exhibitions`);

    if (currentVenueExhibitions.length === 0) {
        listElement.innerHTML = `<div class="empty" style="padding: 40px 20px; text-align: center; color: #666;"><p style="font-size: 18px; margin-bottom: 10px;">🎨 ${currentVenue.name}</p><p style="font-size: 14px; color: #999;">필터 조건에 맞는 전시가 없습니다</p></div>`;
        document.getElementById('resultCount').textContent = '0';
        return;
    }

    // 첫 번째 전시를 기본 선택
    expandedCardId = currentVenueExhibitions[0]._id || null;

    // 현재 전시장의 평균 별점 계산 (5점 만점)
    const exhibitionsWithReviews = currentVenueExhibitions.filter(e => e.stats && e.stats.reviewCount > 0);
    const overallRating = exhibitionsWithReviews.length > 0
        ? (exhibitionsWithReviews.reduce((sum, e) => sum + e.stats.averageRating, 0) / exhibitionsWithReviews.length).toFixed(1)
        : null;
    const totalReviews = currentVenueExhibitions.reduce((sum, e) => sum + (e.stats?.reviewCount || 0), 0);

    // 여러 전시장 선택 UI (나중에 확장)
    const venueSelectionUI = venues.length > 1 ? `
        <div class="venue-selection" style="margin-bottom: 20px;">
            <h3 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 600; color: #333;">전시장 선택</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px;">
                ${venues.map((venue, idx) => `
                    <div class="venue-card ${idx === venueIndex ? 'active' : ''}"
                         onclick="showVenueExhibitions(${idx})"
                         style="padding: 16px; background: ${idx === venueIndex ? '#667eea' : 'white'};
                                color: ${idx === venueIndex ? 'white' : '#333'};
                                border: 2px solid ${idx === venueIndex ? '#667eea' : '#e0e0e0'};
                                border-radius: 12px; cursor: pointer; transition: all 0.2s;">
                        <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">${venue.name}</div>
                        <div style="font-size: 13px; opacity: ${idx === venueIndex ? '0.9' : '0.7'}; margin-bottom: 8px;">
                            ${venue.stats.exhibitionCount}개의 전시
                        </div>
                        ${venue.stats.reviewCount > 0 ? `
                            <div style="font-size: 14px;">
                                ⭐ ${venue.stats.averageRating.toFixed(1)} (${venue.stats.reviewCount})
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    ` : '';

    const html = venueSelectionUI + `
        <div class="venue-group" data-venue="예술의전당">
            <div class="venue-header" style="padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 12px 12px 0 0; margin-bottom: 0;">
                <h2 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 700;">🎨 ${currentVenue.name}</h2>
                <p style="margin: 0; font-size: 14px; opacity: 0.9;">${currentVenue.address}</p>
                <div style="display: flex; align-items: center; gap: 16px; margin-top: 12px; flex-wrap: wrap;">
                    ${currentVenue.barrierFree?.wheelchair ? '<p style="margin: 0; font-size: 13px; opacity: 0.8;">♿ 휠체어 접근 가능</p>' : ''}
                    ${currentVenue.barrierFree?.elevator ? '<p style="margin: 0; font-size: 13px; opacity: 0.8;">🛗 엘리베이터 있음</p>' : ''}
                    ${currentVenue.barrierFree?.braille ? '<p style="margin: 0; font-size: 13px; opacity: 0.8;">👆 점자 안내</p>' : ''}
                </div>
                <div style="display: flex; align-items: center; gap: 16px; margin-top: 8px;">
                    <p style="margin: 0; font-size: 13px; opacity: 0.8;">${currentVenueExhibitions.length}개의 전시</p>
                    ${overallRating ? `
                        <div style="display: flex; align-items: center; gap: 6px; font-size: 14px; opacity: 0.95;">
                            <span>⭐ ${overallRating}</span>
                            <span style="opacity: 0.8;">(${totalReviews}개 리뷰)</span>
                        </div>
                    ` : ''}
                </div>
            </div>
            <div class="venue-tabs" style="background: #f8f9fa; border-bottom: 2px solid #e9ecef; padding: 10px; overflow-x: auto; white-space: nowrap;">
                ${currentVenueExhibitions.map((e, idx) => `
                    <button class="venue-tab ${idx === 0 ? 'active' : ''}"
                            onclick="selectVenueExhibition('${e._id}', ${idx})"
                            style="display: inline-block; padding: 10px 16px; margin: 0 4px; border: none; background: ${idx === 0 ? '#667eea' : 'white'}; color: ${idx === 0 ? 'white' : '#333'}; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.2s;">
                        ${e.title.length > 20 ? e.title.substring(0, 20) + '...' : e.title}
                    </button>
                `).join('')}
            </div>
            <div id="venue-exhibition-content">
                ${renderVenueExhibitionCard(currentVenueExhibitions[0])}
            </div>
        </div>
    `;

    listElement.innerHTML = html;

    // 첫 번째 전시의 리뷰 로드
    if (currentVenueExhibitions[0]._id) {
        await loadReviews(currentVenueExhibitions[0]._id);
    }
}

// 예술의전당 전시 카드 렌더링
function renderVenueExhibitionCard(exhibition) {
    if (!exhibition) return '<div class="empty">전시 정보가 없습니다</div>';

    const periodStr = exhibition.period?.start && exhibition.period?.end
        ? `${new Date(exhibition.period.start).toLocaleDateString('ko-KR')} ~ ${new Date(exhibition.period.end).toLocaleDateString('ko-KR')}`
        : '기간 정보 없음';

    // 별점 표시 (5점 만점)
    const ratingDisplay = exhibition.stats?.reviewCount > 0
        ? `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px; padding: 12px; background: #f8f9fa; border-radius: 8px;">
               <span style="font-size: 18px;">⭐ ${exhibition.stats.averageRating.toFixed(1)}</span>
               <span style="font-size: 14px; color: #666;">(${exhibition.stats.reviewCount}개의 리뷰)</span>
           </div>`
        : '';

    return `
        <div class="exhibition-card expanded" style="background: white; border-radius: 0 0 12px 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            ${exhibition.images && exhibition.images[0] ? `
                <div style="width: 100%; height: 300px; overflow: hidden;">
                    <img src="${exhibition.images[0]}" alt="${exhibition.title}"
                         style="width: 100%; height: 100%; object-fit: cover;"
                         onerror="this.style.display='none'">
                </div>
            ` : ''}
            <div style="padding: 24px;">
                <h3 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #333;">${exhibition.title}</h3>

                ${ratingDisplay}

                <!-- 기본 정보 -->
                <div style="display: grid; grid-template-columns: auto 1fr; gap: 12px 20px; margin-bottom: 24px; padding: 16px; background: #fafafa; border-radius: 8px;">
                    <span style="font-size: 13px; color: #666; font-weight: 500;">기간</span>
                    <span style="font-size: 14px; color: #333;">${periodStr}</span>

                    ${exhibition.openHours?.weekday ? `
                        <span style="font-size: 13px; color: #666; font-weight: 500;">운영시간</span>
                        <span style="font-size: 14px; color: #333;">${exhibition.openHours.weekday}</span>
                    ` : ''}

                    ${exhibition.price ? `
                        <span style="font-size: 13px; color: #666; font-weight: 500;">관람료</span>
                        <span style="font-size: 14px; color: #333;">
                            ${exhibition.price.free ? '무료' :
                              `성인 ${exhibition.price.adult.toLocaleString()}원${exhibition.price.youth > 0 ? `, 청소년 ${exhibition.price.youth.toLocaleString()}원` : ''}${exhibition.price.child > 0 ? `, 어린이 ${exhibition.price.child.toLocaleString()}원` : ''}`
                            }
                        </span>
                    ` : ''}

                    ${exhibition.genre ? `
                        <span style="font-size: 13px; color: #666; font-weight: 500;">장르</span>
                        <span style="font-size: 14px; color: #333;">${exhibition.genre}</span>
                    ` : ''}

                    ${exhibition.contact ? `
                        <span style="font-size: 13px; color: #666; font-weight: 500;">문의</span>
                        <span style="font-size: 14px; color: #333;">${exhibition.contact}</span>
                    ` : ''}
                </div>

                ${exhibition.description ? `
                    <div style="margin-bottom: 20px;">
                        <h4 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 500; color: #202124;">전시 소개</h4>
                        <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #5f6368;">${exhibition.description.substring(0, 500)}${exhibition.description.length > 500 ? '...' : ''}</p>
                    </div>
                ` : ''}

                ${exhibition.artists && exhibition.artists.length > 0 ? `
                    <div style="margin-bottom: 20px;">
                        <h4 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 500; color: #202124;">작가</h4>
                        <p style="margin: 0; font-size: 14px; color: #5f6368;">${exhibition.artists.join(', ')}</p>
                    </div>
                ` : ''}

                ${exhibition.website ? `
                    <div style="margin-bottom: 24px;">
                        <a href="${exhibition.website}" target="_blank" rel="noopener noreferrer"
                           style="display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 500; transition: all 0.2s;">
                            상세 정보 보기 →
                        </a>
                    </div>
                ` : ''}

                <!-- 전시별 편의시설 -->
                ${exhibition.barrierFree?.audioGuide ? `
                    <div style="margin-bottom: 20px; padding: 12px 16px; background: #e8f5e9; border-radius: 6px;">
                        <span style="font-size: 13px; color: #2e7d32; font-weight: 500;">음성안내 제공</span>
                    </div>
                ` : ''}

                <!-- 리뷰 섹션 (구글 스타일) -->
                <div class="review-section" style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 24px;">
                    <div class="review-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h4 style="margin: 0; font-size: 20px; font-weight: 500; color: #202124;">리뷰</h4>
                        <button class="review-write-btn" onclick="toggleReviewForm('${exhibition._id}')"
                                style="padding: 8px 20px; background: #1a73e8; color: white; border: none; border-radius: 20px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.12);">
                            리뷰 작성
                        </button>
                    </div>

                    <form class="review-form" id="form-${exhibition._id}" onsubmit="submitReview(event,'${exhibition._id}')"
                          style="display: none; background: white; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
                        <div class="form-group" style="margin-bottom: 16px;">
                            <label class="form-label" style="display: block; margin-bottom: 8px; font-size: 13px; font-weight: 500; color: #5f6368;">닉네임</label>
                            <input type="text" class="form-input" placeholder="익명"
                                   style="width: 100%; padding: 12px; border: 1px solid #dadce0; border-radius: 4px; font-size: 14px; outline: none; transition: border-color 0.2s;">
                        </div>
                        <div class="form-group" style="margin-bottom: 16px;">
                            <label class="form-label" style="display: block; margin-bottom: 8px; font-size: 13px; font-weight: 500; color: #5f6368;">평점</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <select class="form-select" required
                                        style="flex: 1; padding: 12px; border: 1px solid #dadce0; border-radius: 4px; font-size: 14px; outline: none; transition: border-color 0.2s;">
                                    <option value="">별점을 선택하세요</option>
                                    <option value="5">⭐⭐⭐⭐⭐ 최고예요</option>
                                    <option value="4">⭐⭐⭐⭐ 좋아요</option>
                                    <option value="3">⭐⭐⭐ 괜찮아요</option>
                                    <option value="2">⭐⭐ 별로예요</option>
                                    <option value="1">⭐ 최악이에요</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group" style="margin-bottom: 16px;">
                            <label class="form-label" style="display: block; margin-bottom: 8px; font-size: 13px; font-weight: 500; color: #5f6368;">리뷰 내용</label>
                            <textarea class="form-textarea" required placeholder="전시에 대한 경험을 공유해주세요"
                                      style="width: 100%; min-height: 120px; padding: 12px; border: 1px solid #dadce0; border-radius: 4px; font-size: 14px; resize: vertical; outline: none; transition: border-color 0.2s; line-height: 1.5;"></textarea>
                        </div>
                        <div class="form-buttons" style="display: flex; gap: 12px; justify-content: flex-end;">
                            <button type="button" class="btn-cancel" onclick="toggleReviewForm('${exhibition._id}')"
                                    style="padding: 10px 24px; background: white; color: #5f6368; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.2s;">
                                취소
                            </button>
                            <button type="submit" class="btn-submit"
                                    style="padding: 10px 24px; background: #1a73e8; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.12);">
                                게시
                            </button>
                        </div>
                    </form>

                    <div class="review-list" id="reviews-${exhibition._id}"></div>
                </div>
            </div>
        </div>
    `;
}

// 전시 선택 함수
window.selectVenueExhibition = async function(exhibitionId, index) {
    const currentVenue = venues[currentVenueIndex];
    const currentVenueExhibitions = filteredVenueExhibitions.filter(e =>
        e.venue?.name === currentVenue.name
    );

    const exhibition = currentVenueExhibitions[index];
    if (!exhibition) return;

    expandedCardId = exhibitionId;

    // 탭 활성화 상태 업데이트
    document.querySelectorAll('.venue-tab').forEach((tab, idx) => {
        if (idx === index) {
            tab.style.background = '#667eea';
            tab.style.color = 'white';
            tab.classList.add('active');
        } else {
            tab.style.background = 'white';
            tab.style.color = '#333';
            tab.classList.remove('active');
        }
    });

    // 전시 내용 업데이트
    const contentElement = document.getElementById('venue-exhibition-content');
    if (contentElement) {
        contentElement.innerHTML = renderVenueExhibitionCard(exhibition);
    }

    // 리뷰 로드
    if (exhibition._id) {
        await loadReviews(exhibition._id);
    }
};

async function renderMarkers() {
    if (!map) {
        console.warn("Map not initialized, skipping markers");
        return;
    }

    if (typeof google === 'undefined' || !google.maps || !google.maps.Marker) {
        console.warn("Google Maps Marker API not available");
        return;
    }

    try {
        // Clear existing markers
        markers.forEach(m => {
            try {
                if (m && m.setMap) m.setMap(null);
            } catch (e) {
                // Ignore cleanup errors
            }
        });
        markers = [];

        if (filteredExhibitions.length === 0) {
            console.log("No exhibitions to display on map");
            return;
        }

        // 전시장별로 그룹화 (같은 전시장은 하나의 마커만)
        const venueMap = new Map();
        filteredExhibitions.forEach((e) => {
            if (!e.venue || !e.venue.location || !e.venue.location.lat || !e.venue.location.lng) {
                console.warn("Exhibition missing location:", e.title);
                return;
            }

            const venueKey = `${e.venue.name}|${e.venue.address}`;
            if (!venueMap.has(venueKey)) {
                venueMap.set(venueKey, {
                    venue: e.venue,
                    exhibitions: []
                });
            }
            venueMap.get(venueKey).exhibitions.push(e);
        });

        // 전시장별로 마커 생성
        let markerIndex = 1;
        venueMap.forEach((group) => {
            const { venue, exhibitions } = group;
            const firstExhibition = exhibitions[0];

            try {
                const marker = new google.maps.Marker({
                    position: { lat: venue.location.lat, lng: venue.location.lng },
                    map: map,
                    title: venue.name,
                    label: {
                        text: String(markerIndex),
                        color: '#FFFFFF',
                        fontWeight: 'bold',
                        fontSize: '14px'
                    },
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 12,
                        fillColor: '#1FB2A6',
                        fillOpacity: 1,
                        strokeColor: '#FFFFFF',
                        strokeWeight: 3
                    }
                });

                // 마커 클릭 시 첫 번째 전시 카드로 이동
                marker.addListener('click', () => {
                    window.toggleCard(firstExhibition._id);
                    const card = document.getElementById(`card-${firstExhibition._id}`);
                    if (card) {
                        setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
                    }
                });

                markers.push(marker);
                markerIndex++;
            } catch (markerErr) {
                console.warn(`Failed to create marker for ${venue.name}:`, markerErr);
            }
        });

        console.log(`✅ ${markers.length} markers rendered (${venueMap.size} venues)`);
    } catch (err) {
        console.error("❌ Error rendering markers:", err);
    }
}

// 4. HTML과 연결된 전역 함수들
window.toggleCard = async function(id) {
    if (expandedCardId === id) {
        expandedCardId = null;
    } else {
        expandedCardId = id;
        await loadReviews(id);
    }
    renderList();
    if (expandedCardId) {
        setTimeout(() => {
            const card = document.getElementById(`card-${id}`);
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
    }
};

window.toggleFilter = function(type) {
    filters[type] = !filters[type];
    document.getElementById(`${type}Filter`).classList.toggle('active');
    refresh();
};

window.toggleAdvancedFilters = function() {
    const p = document.getElementById('advancedFilters');
    const t = document.getElementById('advancedToggleText');
    p.classList.toggle('active');
    t.textContent = p.classList.contains('active') ? '고급 필터 ▲' : '고급 필터 ▼';
};

window.toggleChipFilter = function(chip) {
    const type = chip.dataset.filter;
    const val = chip.dataset.value;
    chip.classList.toggle('active');
    if (chip.classList.contains('active')) {
        if (!filters[type].includes(val)) filters[type].push(val);
    } else {
        filters[type] = filters[type].filter(v => v !== val);
    }
    refresh();
};

window.applySort = function() {
    const val = document.getElementById('sortSelect').value;
    setCurrentSort(val);
    refresh();
};

window.toggleReviewForm = function(id) {
    const formElement = document.getElementById(`form-${id}`);
    if (formElement) {
        const currentDisplay = formElement.style.display;
        formElement.style.display = currentDisplay === 'none' ? 'block' : 'none';
    }
};

window.submitReview = async function(e, id) {
    e.preventDefault();
    const form = e.target;
    const data = {
        exhibitionId: id,
        userName: form.querySelector('input').value || '익명',
        rating: parseInt(form.querySelector('select').value),
        comment: form.querySelector('textarea').value
    };
    try {
        await postReview(data);
        alert('리뷰가 등록되었습니다!');

        // 전시 목록 다시 불러오기
        allVenueExhibitions = await fetchAllVenueExhibitions();

        // 현재 선택된 전시 찾기
        const currentIndex = allVenueExhibitions.findIndex(e => e._id === id);
        if (currentIndex !== -1) {
            const exhibition = allVenueExhibitions[currentIndex];

            // 카드 업데이트
            const contentElement = document.getElementById('sac-exhibition-content');
            if (contentElement) {
                contentElement.innerHTML = renderVenueExhibitionCard(exhibition);
            }

            // 리뷰 다시 로드
            await loadReviews(id);

            // 헤더의 전체 평균 별점 업데이트
            await showVenueExhibitions(currentVenueIndex);
        }

        // 폼 닫기
        toggleReviewForm(id);
    } catch (err) {
        console.error('리뷰 등록 실패:', err);
        alert('리뷰 등록에 실패했습니다. 다시 시도해주세요.');
    }
};

async function loadReviews(id) {
    const reviews = await fetchReviews(id);
    setTimeout(() => {
        const c = document.getElementById(`reviews-${id}`);
        if (c) c.innerHTML = reviews.length === 0 ? '<div class="empty-reviews" style="padding: 20px; text-align: center; color: #999; font-size: 14px;">아직 리뷰가 없습니다</div>' : reviews.map(r => renderReview(r)).join('');
    }, 50);
}

// 전시장 선택 함수 글로벌 등록 제거 (이미 위에서 정의됨)

// 검색 입력 이벤트는 위의 DOMContentLoaded에서 처리됨