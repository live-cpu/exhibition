<div align="center">

# 🎨 CureRoute

### 전시 여행 길잡이 | Exhibition Travel Guide

[![Deploy](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)](https://14exhibition.vercel.app)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?logo=mongodb)](https://mongodb.com)

---

### 📺 Demo

👉 **[https://14exhibition.vercel.app](https://14exhibition.vercel.app)**

![Demo](test.gif)

---

</div>

## ✨ Features

| 기능 | 설명 |
|------|------|
| 🗺️ **지도 기반 탐색** | 카카오맵으로 전국 미술관/갤러리 위치 확인 |
| 📅 **실시간 전시 정보** | 공공데이터 API 연동으로 매일 자동 업데이트 |
| ♿ **배리어프리 정보** | 휠체어, 엘리베이터, 점자, 오디오가이드, 안내견 |
| ⭐ **리뷰 & 별점** | 전시 감상평 공유 |
| 🔍 **스마트 필터** | 가격대, 진행상태, 접근성 필터링 |
| 📈 **트렌드 순위** | 네이버 검색량 기반 인기 전시 |

---

## 🏛️ Data Sources

### 공공데이터 API (6개 소스)

| API | 설명 |
|-----|------|
| 한국문화정보원 외_전시정보(통합) | 27개소 미술관/갤러리 전시 |
| 문화체육관광부_문화예술공연(통합) | 전국 문화예술 공연/전시 |
| 서울시 문화행사 정보 | 서울열린데이터 |
| 국립현대미술관 | MMCA 전시 정보 |
| 대구광역시 공연전시 정보 | 대구 문화재단 |
| 경기도 문화 행사 현황 | 경기데이터드림 |

### 보강 데이터
- **Brave/Naver 검색**: 누락 정보 보완
- **관광공사 API**: 무장애 관광정보

---

## 🛠️ Tech Stack

```
Frontend     Vanilla JS + Kakao Maps
Backend      Node.js + Express
Database     MongoDB Atlas
Deploy       Vercel (Serverless)
APIs         공공데이터포털, 네이버, Brave, 관광공사
```

---

## 🚀 Quick Start

```bash
# Clone
git clone https://github.com/live-cpu/exhibition.git
cd exhibition

# Install
npm install

# Environment
cp .env.example .env
# Edit .env with your API keys

# Run
npm start
```

---

## 📁 Project Structure

```
├── server/
│   ├── index.js              # Express 서버
│   ├── models/               # MongoDB 스키마
│   ├── routes/               # API 라우터
│   └── services/             # 비즈니스 로직
│       ├── syncAll.js        # 전시 동기화
│       ├── dailyScheduler.js # 자동화 스케줄러
│       └── korWithService.js # 관광공사 API
├── src/
│   ├── index.html            # 메인 페이지
│   ├── main.js               # 프론트엔드 로직
│   └── style.css             # 스타일
└── .env.example              # 환경변수 템플릿
```

---

## 🔑 Environment Variables

| Key | Description |
|-----|-------------|
| `MONGO_URI` | MongoDB 연결 문자열 |
| `KAKAO_MAP_KEY` | 카카오맵 JavaScript 키 |
| `NAVER_CLIENT_ID/SECRET` | 네이버 검색 API |
| `KOR_WITH_API_KEY` | 관광공사 무장애 API |
| `UNIFIED_EXHIBITION_API_KEY` | 한국문화정보원 통합 전시 |
| `SEMA_CULTURE_API_KEY` | 서울시 문화행사 |
| `MOCA_API_KEY` | 국립현대미술관 |
| `GG_API_KEY` | 경기도 문화행사 |
| `CNV_API_KEY` | 문화체육관광부 |

---

<div align="center">

**Made with ❤️ for accessible art experiences**

</div>
