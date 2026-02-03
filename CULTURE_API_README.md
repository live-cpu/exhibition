# ArtMap Public API Keys

This project uses three public data APIs:
- KCISA unified exhibitions (27 institutions): UNIFIED_EXHIBITION_API_KEY
- Culture Portal unified events (CNV_060): CNV_API_KEY
- Seoul cultural events (culturalEventInfo): SEMA_API_KEY

## .env
```
UNIFIED_EXHIBITION_API_KEY=...
CNV_API_KEY=...
SEMA_API_KEY=...
```

## Sync endpoints
- POST /api/culture/sync (CNV_060)
- Auto sync on server start (KCISA + Seoul + CNV_060)
