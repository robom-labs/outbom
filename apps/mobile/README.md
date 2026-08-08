# 야외봄 네이티브

Expo SDK 57·React Native 0.86 기반의 독립 Android/iOS 프로젝트다. WebView 없이 `expo-location`과 네이티브 UI를 사용한다. 걷기·애견산책·러닝·등산·자전거 5개 활동을 체감온도·강수·바람·자외선·습도·PM2.5·PM10으로 각각 판단하고, 12시간 흐름과 2시간 추천 구간·준비 정보를 보여준다.

위치 권한은 사용자가 `현재 위치로 확인`을 누른 뒤에만 foreground 권한으로 요청하며 좌표는 로컬 저장소에 남기지 않는다. 마지막 성공 예보와 선택 활동은 기기에 보관해 오프라인에서도 열 수 있고, 활동을 바꾸면 네트워크 요청 없이 저장 예보를 즉시 다시 계산한다.

## 로컬 실행과 검증

Node.js 22.13 이상과 pnpm 10이 필요하다.

```bash
cd apps/mobile
pnpm install
pnpm run doctor
pnpm run check
```

개발 빌드는 `pnpm start`, Expo Go에서 제한적으로 확인할 때는 `pnpm start:go`를 사용한다. `.env.example`을 `.env.local`로 복사할 수 있지만 기본 Open-Meteo 주소만 쓰므로 secret은 필요 없다.

권한을 거부하거나 위치 서비스가 꺼져 있어도 앱은 종료되지 않는다. 저장된 마지막 출발 판단을 계속 보여주며, 저장된 판단이 없으면 위치 권한 없이 `서울 기본 예보`를 시도할 수 있다. 네트워크가 끊기면 마지막 성공 예보를 그대로 유지한다.

## EAS 빌드와 스토어 제출 절차

Android production 빌드는 `expo-build-properties`로 `compileSdkVersion`과 `targetSdkVersion`을 모두 36으로 고정해 Android 16 대상 API 요구를 충족한다.

이 저장소에는 서명 인증서, 프로비저닝 프로파일, Play 서비스 계정 키를 넣지 않는다. 아래 절차는 앱 소유자가 Apple Developer·Google Play Console·Expo 계정과 스토어 메타데이터를 준비한 뒤 직접 수행한다.

1. `cd apps/mobile`에서 `npx eas-cli login`을 실행하고 `expo config --type public`으로 기존 EAS project 연결을 확인한다.
2. 내부 개발용은 `npx eas-cli build --profile development --platform ios|android`, QA 설치본은 `--profile preview`, 스토어 후보는 `--profile production`으로 만든다.
3. iOS 개인정보 라벨에는 앱 사용 중 foreground 위치 사용과 진단 정보 미수집을 정확히 기재한다. Android Data safety에도 동일한 실제 동작을 반영하고 background 위치를 선언하지 않는다.
4. 실기기에서 권한 허용·거부, 위치 서비스 꺼짐, 비행기 모드, 딥링크 `outbom://`, 마지막 예보 복원을 확인한다.
5. 빌드 번호와 버전 코드를 올리고 스토어 설명·스크린샷·지원 및 개인정보 URL을 검토한다.
6. 승인된 production 빌드만 `npx eas-cli submit --platform ios|android --latest`로 제출한다. 이 명령과 서명·제출은 자동 실행하지 않는다.

`eas.json`에는 development·preview·production 프로필만 정의돼 있다. preview Android는 내부 설치가 쉬운 APK이고 production은 기본 스토어 형식을 사용한다.
