# ArtMap

ArtMap is a museum/exhibition map service using Google Maps + Node/Express + MongoDB.

## APIs (public data)
- KCISA unified exhibitions (27 institutions): UNIFIED_EXHIBITION_API_KEY
- Culture Portal unified events (CNV_060): CNV_API_KEY
- Seoul cultural events (culturalEventInfo): SEMA_API_KEY

## Setup
1) Create `.env`:
```
UNIFIED_EXHIBITION_API_KEY=...
CNV_API_KEY=...
SEMA_API_KEY=...
```

2) Install and run:
```
npm install
npm start
```

## Sync
- Auto sync runs on server start.
- Culture Portal manual sync: `POST /api/culture/sync`

## Notes
- Only current exhibitions are stored.
- Dedupe prefers KCISA and Seoul sources over CNV_060.
