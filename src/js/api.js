export async function fetchExhibitions(){
    try {
        const r = await fetch('/api/exhibitions');
        if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
        return await r.json();
    } catch (err) {
        console.error('Failed to fetch exhibitions:', err);
        throw err;
    }
}

export async function fetchSACExhibitions(){
    try {
        const r = await fetch('/api/sac/exhibitions');
        if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
        return await r.json();
    } catch (err) {
        console.error('Failed to fetch SAC exhibitions:', err);
        throw err;
    }
}

// 모든 전시장의 데이터를 가져오기
export async function fetchTrendingExhibitions(){
    try {
        const r = await fetch('/api/exhibitions?sort=trend');
        if (!r.ok) {
            if (r.status === 503) {
                return [];
            }
            const payload = await r.json().catch(() => ({}));
            const err = new Error(`HTTP error! status: ${r.status}`);
            err.fallback = payload?.fallback;
            throw err;
        }
        return await r.json();
    } catch (err) {
        console.error('Failed to fetch trending exhibitions:', err);
        throw err;
    }
}

export async function fetchAllVenueExhibitions(){
    try {
        return await fetchExhibitions();
    } catch (err) {
        console.error('Failed to fetch all venue exhibitions:', err);
        return [];
    }
}

export async function fetchVenues(){
    try {
        const r = await fetch('/api/venues');
        if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
        return await r.json();
    } catch (err) {
        console.error('Failed to fetch venues:', err);
        return [];
    }
}

export async function fetchReviews(id){
    try {
        const r = await fetch(`/api/reviews/exhibition/${id}`);
        if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
        return await r.json();
    } catch (err) {
        console.error('Failed to fetch reviews:', err);
        return [];
    }
}

export async function postReview(data){
    try {
        const r = await fetch('/api/reviews', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
        return await r.json();
    } catch (err) {
        console.error('Failed to post review:', err);
        throw err;
    }
}
