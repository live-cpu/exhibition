export const filters = { rating: false, free: false, ongoing: false, price: [], status: ['ongoing'], barrier: [] };
export let currentSort = 'trend';

// 정렬 상태 업데이트를 위한 함수 추가
export function setCurrentSort(val) {
    currentSort = val;
}

export function applyFilters(exhibitions) {
    return exhibitions.filter(e => {
        // Rating filter: must have reviews and rating >= 3.5
        if (filters.rating) {
            const reviewCount = e.stats?.reviewCount || 0;
            const avgRating = e.stats?.averageRating || 0;
            if (reviewCount === 0 || avgRating < 3.5) return false;
        }
        
        // Free filter: adult price must be 0
        if (filters.free) {
            const adultPrice = e.price?.adult || 0;
            if (adultPrice !== 0) return false;
        }
        
        // Ongoing filter: must be currently ongoing
        if (filters.ongoing) {
            if (e.periodUnknown) return true;
            if (!e.period?.start || !e.period?.end) return false;
            const now = new Date();
            const start = new Date(e.period.start);
            const end = new Date(e.period.end);
            if (!(now >= start && now <= end)) return false;
        }
        
        // Price filter: match any selected price range
        if (filters.price.length > 0) {
            const adultPrice = e.price?.adult || 0;
            let match = false;
            filters.price.forEach(p => {
                if (p === 'free' && adultPrice === 0) match = true;
                if (p === 'under10k' && adultPrice > 0 && adultPrice <= 10000) match = true;
                if (p === 'over10k' && adultPrice > 10000) match = true;
            });
            if (!match) return false;
        }
        
        // Status filter: match any selected status
        if (filters.status.length > 0) {
            if (e.periodUnknown) {
                return filters.status.includes('ongoing');
            }
            if (!e.period?.start || !e.period?.end) return false;
            const now = new Date();
            const start = new Date(e.period.start);
            const end = new Date(e.period.end);
            let match = false;
            filters.status.forEach(s => {
                if (s === 'ongoing' && now >= start && now <= end) match = true;
                if (s === 'upcoming' && now < start) match = true;
                if (s === 'ended' && now > end) match = true;
            });
            if (!match) return false;
        }
        
        // Barrier-free filter: must have ALL selected facilities
        // barrierFree는 venue에 있거나 exhibition에 직접 있을 수 있음
        if (filters.barrier.length > 0) {
            const bf = e.venue?.barrierFree || e.barrierFree;
            if (!bf) return false;
            let match = true;
            filters.barrier.forEach(b => {
                if (!bf[b]) match = false;
            });
            if (!match) return false;
        }
        
        return true;
    });
}

export function sortExhibitions(exhibitions, sortType) {
    const type = sortType || currentSort;
    return [...exhibitions].sort((a, b) => {
        switch (type) {
            case 'trend':
                // 트렌드 점수 기준 내림차순 정렬
                return (b.trend?.score || 0) - (a.trend?.score || 0);
            case 'distance':
                // 거리 정렬은 main.js의 sortByDistance()에서 처리
                return 0;
            default:
                // 기본값: 트렌드순
                return (b.trend?.score || 0) - (a.trend?.score || 0);
        }
    });
}

export function getStatus(exh) {
    if (exh.periodUnknown || !exh.period?.start || !exh.period?.end) {
        return 'unknown';
    }
    const now = new Date(), start = new Date(exh.period.start), end = new Date(exh.period.end);
    if (now < start) return 'upcoming';
    if (now > end) return 'ended';
    return 'ongoing';
}
