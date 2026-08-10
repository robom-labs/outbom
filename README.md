# 야외봄 — 걷기·애견산책·러닝·등산·자전거, 나가기 좋은 시간

날씨·대기질을 활동별로 종합해 **"지금 나가도 돼? 오늘 언제가 좋아?"**에 답하는 야외활동 컨디션 PWA입니다. 걷기·애견산책·러닝·등산·자전거 5개 활동을 각각의 기준으로 0~100점으로 판단합니다.

로봄의 야외활동 앱입니다. 기존 러닝콜의 기능과 사용자 설정을 그대로 이어받습니다.

공식 배포: https://robom-labs.github.io/outbom/

API·기존 PWA 호환 주소: https://outbom.robom.kr

기존 Vercel 호환 주소: https://runningcall.vercel.app

현재 웹 버전: **v0.25.6** (`public/sw.js`의 `outbom-v0.25.6`과 일치)

현재 네이티브 버전: **v0.26.3** (`apps/mobile`의 Android/iOS 앱)

## 패밀리 셸과 설치

- 로봄 패밀리 1.0.0 생성물은 `src/generated/robom-family/`에, 생성 SHA와 파일 해시는 `family.lock.json`에 보관합니다.
- 설정에서 로봄 앱 5개, 야외봄 설치·업데이트, 지원·개인정보, 앱·빌드·PWA 메타를 확인할 수 있습니다.
- Android·데스크톱의 브라우저 설치 프롬프트와 iPhone Safari의 `공유 → 홈 화면에 추가` 안내를 지원합니다.
- 익명 사용 통계는 기본 꺼짐이며 현재 외부 분석 SDK나 광고 SDK를 포함하지 않습니다.
- 기존 `running-alarm:*` 저장 키는 이름을 바꾸거나 삭제하지 않습니다.

## 실행

```bash
pnpm install
pnpm dev      # 개발 서버
pnpm test     # 테스트 (러닝 골든마스터 등)
pnpm build    # 프로덕션 빌드
pnpm typecheck
```

## 활동 카테고리

| 활동 | 특징 |
|---|---|
| 🚶 걷기 | 더위·습도 관대, 미세먼지·자외선 강조 |
| 🐕 애견산책 | 강아지 기준(발바닥 화상·지면열 경고) |
| 🏃 러닝 | 체감온도·습도 민감 (기존 완성형, 골든마스터로 불변 보장) |
| ⛰️ 등산 | 목적지 산 검색·하산 마감·낙뢰/돌풍/조망·새벽 4시 시간대 |
| 🚴 자전거 | 바람·비 민감, 강풍 위험 경고 |

## 데이터

- 날씨: Open-Meteo Forecast API (체감온도·강수·바람·자외선·낙뢰·돌풍·시정·적설 등)
- 대기질: Open-Meteo Air Quality API (PM2.5/PM10)
- 현재 광고·구독이 없는 공개판은 Open-Meteo 비상업 무료 API와 일 10,000회 제한을 사용한다. 광고·구독·유료 판매 등 수익화 전에는 유료 라이선스 또는 자체 호스팅 API 호환 프록시를 `EXPO_PUBLIC_FORECAST_API_URL`·`EXPO_PUBLIC_AIR_QUALITY_API_URL`에 연결하고, 비밀 API 키를 앱 번들에 넣지 않는다.
- 위치 검색: Kakao Local API — `KAKAO_REST_API_KEY`가 없으면 검색이 비활성화되고(503) 화면에 안내가 표시됩니다. 텍스트 검색 폴백은 없습니다. (Nominatim은 좌표→동네명 역지오코딩에만 사용)
- 장애 복원: 위치 좌표별로 최근 예보를 최대 5곳, 6시간 동안만 보관하며 실시간 요청 실패 시 같은 좌표의 저장 데이터와 경과 시간을 표시합니다.

## 주요 라우트

- `/api/forecast` — 좌표 → 원본 시간별 예보(활동별 점수화는 클라이언트에서)
- `/api/search-location` — 위치·산 검색
- `/api/reverse-location` — 좌표 → 동네명

## 점수 로직

활동마다 6개 지표(미세먼지·체감온도·강수·자외선·습도·바람)의 가중치가 다르고, 위험 조건(폭염·강풍·낙뢰 등)엔 하드캡을 건다. 프로필은 `lib/activity.ts` 참고. 러닝 프로필은 값이 고정되어 있으며 `lib/__tests__/scoring.test.ts`의 골든마스터로 잠겨 있다.

## 배포

`main` push 뒤 GitHub Pages 프런트가 자동 배포되고, 기존 Vercel 주소는 API·기존 PWA 호환용으로 유지됩니다. 카카오 검색을 쓰려면 Vercel 환경변수에 `KAKAO_REST_API_KEY`를 추가합니다. 설정 화면의 버전·빌드 SHA·PWA 캐시로 실제 반영 상태를 확인합니다.
