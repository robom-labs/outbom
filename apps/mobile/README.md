# 야외봄 네이티브

Expo SDK 57·React Native 0.86 기반의 독립 Android/iOS 프로젝트다. WebView 없이 `expo-location`·`expo-notifications`와 네이티브 UI를 사용한다. 걷기·애견산책·러닝·등산·자전거 5개 활동을 체감온도·강수·바람·돌풍·가시거리·낙뢰·주야간·자외선·습도·PM2.5·PM10으로 각각 판단하고, 12시간 흐름과 안전한 2시간 추천 구간·추천 시간 기준 준비 정보를 보여준다.

위치 권한은 사용자가 `현재 위치로 확인`을 누른 뒤에만 foreground 권한으로 요청하며 좌표는 로컬 저장소에 남기지 않는다. 마지막 성공 예보와 선택 활동은 기기에 보관해 오프라인에서도 열 수 있고, 활동을 바꾸면 네트워크 요청 없이 저장 예보를 즉시 다시 계산한다.

추천 시간 알림은 사용자가 직접 저장할 때만 기기 알림 권한을 요청한다. 예약 정보와 기기 알림 식별자는 로컬 저장소에만 보관하며, 알림 탭에서 해제할 수 있다. Android 13 이상에서는 사용자가 알림을 허용해야 하고, 일부 제조사의 절전 정책에서는 지연될 수 있다. 야외봄은 배터리 예외·백그라운드 위치·정확한 알람 권한을 자동 요청하지 않는다.

## 로컬 실행과 검증

Node.js 22.13 이상과 pnpm 10이 필요하다.

```bash
cd apps/mobile
pnpm install
pnpm run doctor
pnpm run check
```

개발 빌드는 `pnpm start`, Expo Go에서 제한적으로 확인할 때는 `pnpm start:go`를 사용한다. `.env.example`의 공개 Open-Meteo 주소는 평가·비상업용 기본값이다. 상업 출시에서는 라이선스가 적용된 API 호환 프록시 주소를 `EXPO_PUBLIC_FORECAST_API_URL`·`EXPO_PUBLIC_AIR_QUALITY_API_URL`에 넣고, 유료 API 키나 다른 비밀값은 앱 번들에 절대 넣지 않는다. 화면에는 Open-Meteo 원자료 출처·CC BY 4.0 링크와 야외봄의 활동별 재계산 사실을 표시한다. 대기질·돌풍·가시거리·기상 상태·적설·주야간·등산 일몰 정보가 누락된 시간대는 안전 추천에서 제외하고 그 이유를 알린다.

권한을 거부하거나 위치 서비스가 꺼져 있어도 앱은 종료되지 않는다. 저장된 마지막 출발 판단을 계속 보여주며, 위치 확인이 길어지는 중에도 `서울 기본 예보`로 바로 전환할 수 있다. 네트워크가 끊기면 마지막 성공 예보를 유지하되 시간이 흐를 때 현재 슬롯·추천 구간·준비 정보를 남은 시간 기준으로 다시 계산하고, 모든 저장 시간이 지나면 새 예보 확인을 안내한다.

## EAS 빌드와 스토어 제출 절차

Android production 빌드는 `expo-build-properties`로 `compileSdkVersion`과 `targetSdkVersion`을 모두 36으로 고정해 Android 16 대상 API 요구를 충족한다.

이 저장소에는 서명 인증서, 프로비저닝 프로파일, Play 서비스 계정 키를 넣지 않는다. 아래 절차는 앱 소유자가 Apple Developer·Google Play Console·Expo 계정과 스토어 메타데이터를 준비한 뒤 직접 수행한다.

1. `cd apps/mobile`에서 `npx eas-cli login`을 실행하고 `expo config --type public`으로 기존 EAS project 연결을 확인한다.
2. EAS 프로젝트의 production 환경에 비밀키가 없는 라이선스 적용 HTTPS 프록시 `https://weather.robom.kr/api/forecast`와 `https://weather.robom.kr/api/air-quality`를 각각 등록한다. `npx eas-cli env:list production --scope project`로 이름을 확인하고, 실제 production 환경을 불러온 상태에서 `pnpm run verify:production-api`가 통과해야 한다. 이 검사는 주소 문자열뿐 아니라 공용 DNS·TLS·HTTP와 앱이 실제 사용하는 예보·대기질 JSON 배열까지 확인한다. 공개 Open-Meteo·사설망·localhost·예시 주소·다른 `robom.kr` 경로나 쿼리·프래그먼트가 붙은 주소는 자동으로 거부한다.
3. 내부 개발용은 `npx eas-cli build --profile development --platform ios|android`, QA 설치본은 `--profile preview`, 스토어 후보는 `--profile production`으로 만든다. production 빌드는 위 프록시가 없으면 설치 전 단계에서 중단된다.
4. iOS 개인정보 라벨에는 앱 사용 중 foreground 위치 사용과 진단 정보 미수집을 정확히 기재한다. Android Data safety에도 동일한 실제 동작을 반영하고 background 위치를 선언하지 않는다.
5. 실기기에서 권한 허용·거부, 위치 서비스 꺼짐, 비행기 모드, 딥링크 `outbom://`, 마지막 예보 복원을 확인한다.
6. 빌드 번호와 버전 코드를 올리고 스토어 설명·스크린샷·지원 및 개인정보 URL을 검토한다.
7. 승인된 production 빌드만 `npx eas-cli submit --platform ios|android --latest`로 제출한다. 이 명령과 서명·제출은 자동 실행하지 않는다.

`eas.json`에는 development·preview·production 프로필만 정의돼 있다. preview Android는 내부 설치가 쉬운 APK이고 production은 기본 스토어 형식을 사용한다.
