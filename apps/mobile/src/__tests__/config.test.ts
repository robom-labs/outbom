// 네이티브 앱 식별자와 EAS 프로필, foreground 위치 전용 계약을 정적으로 검증한다.
import { describe, expect, it } from "vitest";
import appConfig from "../../app.json";
import easConfig from "../../eas.json";
import packageInfo from "../../package.json";

describe("native app contract", () => {
  it("Expo SDK 57과 Android/iOS 식별자를 고정한다", () => {
    expect(packageInfo.version).toBe("0.26.4");
    expect(appConfig.expo.version).toBe(packageInfo.version);
    expect(packageInfo.dependencies.expo).toMatch(/^~57\./);
    expect(packageInfo.dependencies["react-native"]).toBe("0.86.2");
    expect(packageInfo.dependencies["react-native-safe-area-context"]).toBe("~5.7.0");
    expect(appConfig.expo.scheme).toBe("outbom");
    expect(appConfig.expo.platforms).toEqual(["ios", "android"]);
    expect(appConfig.expo.orientation).toBe("default");
    expect(appConfig.expo.ios.supportsTablet).toBe(true);
    expect(appConfig.expo.ios.bundleIdentifier).toBe("kr.robom.outbom");
    expect(appConfig.expo.ios.buildNumber).toBe("8");
    expect(appConfig.expo.android.package).toBe("kr.robom.outbom");
    expect(appConfig.expo.android.versionCode).toBe(9);
    expect(appConfig.expo.ios.associatedDomains).toContain("applinks:robom.kr");
    expect(appConfig.expo.android.intentFilters[0]?.data[0]).toMatchObject({
      scheme: "https",
      host: "robom.kr",
      pathPrefix: "/get/outbom"
    });
  });

  it("EAS development, preview, production 프로필을 모두 제공한다", () => {
    expect(Object.keys(easConfig.build).sort()).toEqual(["development", "preview", "production"]);
    expect(easConfig.build.development.developmentClient).toBe(true);
    expect(easConfig.build.preview.distribution).toBe("internal");
    expect(easConfig.build.production.environment).toBe("production");
    expect(easConfig.build.production.android?.buildType).toBe("app-bundle");
    expect(easConfig.build.production.env?.EXPO_PUBLIC_PRIVACY_URL).toBe("https://robom.kr/privacy/outbom");
    expect(packageInfo.scripts["eas-build-pre-install"]).toBe("node scripts/verify-production-api.mjs");
  });

  it("Android 16 대상 API와 컴파일 SDK를 36으로 고정한다", () => {
    const buildProperties = appConfig.expo.plugins.find((plugin) => plugin[0] === "expo-build-properties");

    expect(packageInfo.dependencies["expo-build-properties"]).toMatch(/^~57\./);
    expect(buildProperties?.[1]).toMatchObject({
      android: {
        compileSdkVersion: 36,
        targetSdkVersion: 36
      }
    });
  });

  it("foreground 위치만 구성하고 WebView 의존성을 포함하지 않는다", () => {
    expect(packageInfo.dependencies).not.toHaveProperty("react-native-webview");
    expect(appConfig.expo.android.blockedPermissions).toContain("android.permission.ACCESS_BACKGROUND_LOCATION");
  });
});
