<div align="center">

# 🎨 CureRoute

### 전시 여행 길잡이 | Exhibition Travel Guide

[![Deploy](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)](https://14-exhibition.vercel.app)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?logo=mongodb)](https://mongodb.com)

---

### 📺 Demo

https://media.serafuku.moe/local_content/original/d7ba0903-99f1-4a49-bc88-41f0c92bfb47.mp4

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

### Venue (전시장 - 고정 데이터)
- **26~60개** 주요 미술관 (국현미, 서울시립, ACC, 리움, 뮤지엄산 등)
- 전국 8도 대표 시설 정보
- 위치, 운영시간, 웹사이트, 배리어프리 5종

### Exhibition (전시 - 변동 데이터)
- **매일 새벽 3시** 자동 동기화
- 문화체육관광부, 지역문화진흥원, 통합 전시 API
- 전시명, 기간, 이미지, 관람료, 설명

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
| `UNIFIED_EXHIBITION_API_KEY` | 통합 전시 API |

---

<div align="center">

**Made with ❤️ for accessible art experiences**

</div>
