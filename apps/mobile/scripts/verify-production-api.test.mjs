// production API 게이트와 예보 출처 표시 계약을 Node 환경에서 검증한다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validatePreflightPayload } from "./verify-production-api.mjs";

const script = fileURLToPath(new URL("./verify-production-api.mjs", import.meta.url));
const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

function runGate(environment = {}) {
  return spawnSync(process.execPath, [script, "--strict", "--configuration-only"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", ...environment }
  });
}

const forecastPayload = {
  hourly: Object.fromEntries([
    "time",
    "temperature_2m",
    "apparent_temperature",
    "precipitation",
    "precipitation_probability",
    "wind_speed_10m",
    "wind_gusts_10m",
    "visibility",
    "uv_index",
    "relative_humidity_2m",
    "weather_code",
    "snowfall",
    "is_day"
  ].map((name) => [name, [name === "time" ? "2026-08-08T22:00" : 1]])),
  daily: {
    time: ["2026-08-08"],
    sunrise: ["2026-08-08T05:42"],
    sunset: ["2026-08-08T19:32"]
  }
};

const airQualityPayload = {
  hourly: {
    time: ["2026-08-08T22:00"],
    pm2_5: [12],
    pm10: [24]
  }
};

test("승인된 robom.kr 운영 프록시 두 개만 production 게이트를 통과한다", () => {
  const result = runGate({
    EXPO_PUBLIC_FORECAST_API_URL: "https://weather.robom.kr/api/forecast",
    EXPO_PUBLIC_AIR_QUALITY_API_URL: "https://weather.robom.kr/api/air-quality"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /production API gate: PASS/);
});

test("누락·공개 API 우회·예시·사설망·역할 불명 주소는 차단한다", () => {
  const rejectedPairs = [
    {},
    {
      EXPO_PUBLIC_FORECAST_API_URL: "https://api.open-meteo.com./v1/forecast",
      EXPO_PUBLIC_AIR_QUALITY_API_URL: "https://air-quality-api.open-meteo.com./v1/air-quality"
    },
    {
      EXPO_PUBLIC_FORECAST_API_URL: "https://proxy.example.com/api/forecast",
      EXPO_PUBLIC_AIR_QUALITY_API_URL: "https://proxy.example.com/api/air-quality"
    },
    {
      EXPO_PUBLIC_FORECAST_API_URL: "https://10.0.0.1/api/forecast",
      EXPO_PUBLIC_AIR_QUALITY_API_URL: "https://10.0.0.1/api/air-quality"
    },
    {
      EXPO_PUBLIC_FORECAST_API_URL: "https://weather.robom.kr/",
      EXPO_PUBLIC_AIR_QUALITY_API_URL: "https://weather.robom.kr/"
    },
    {
      EXPO_PUBLIC_FORECAST_API_URL: "https://weather.robom.kr/api/forecast?key=SECRET",
      EXPO_PUBLIC_AIR_QUALITY_API_URL: "https://weather.robom.kr/api/air-quality"
    },
    {
      EXPO_PUBLIC_FORECAST_API_URL: "https://weather.robom.kr/api/forecast#production",
      EXPO_PUBLIC_AIR_QUALITY_API_URL: "https://weather.robom.kr/api/air-quality"
    },
    {
      EXPO_PUBLIC_FORECAST_API_URL: "https://unused-subdomain.robom.kr/v99/weather-test",
      EXPO_PUBLIC_AIR_QUALITY_API_URL: "https://unused-subdomain.robom.kr/v99/air-quality-test"
    },
    {
      EXPO_PUBLIC_FORECAST_API_URL: "https://weather.robom.kr/api/weather",
      EXPO_PUBLIC_AIR_QUALITY_API_URL: "https://weather.robom.kr/api/airquality"
    }
  ];

  for (const environment of rejectedPairs) {
    const result = runGate(environment);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /production API gate: BLOCKED/);
  }
});

test("운영 확인 응답은 앱이 실제 사용하는 예보·대기질 배열을 모두 포함해야 한다", () => {
  assert.equal(validatePreflightPayload("EXPO_PUBLIC_FORECAST_API_URL", forecastPayload), null);
  assert.equal(validatePreflightPayload("EXPO_PUBLIC_AIR_QUALITY_API_URL", airQualityPayload), null);
  assert.match(
    validatePreflightPayload("EXPO_PUBLIC_FORECAST_API_URL", { ...forecastPayload, daily: undefined }),
    /일출·일몰/
  );
  assert.match(
    validatePreflightPayload("EXPO_PUBLIC_AIR_QUALITY_API_URL", { hourly: { time: ["2026-08-08T22:00"], pm2_5: [12] } }),
    /대기질 필수 배열/
  );
});

test("예보 데이터 바로 아래에 Open-Meteo 출처와 라이선스를 표시한다", () => {
  assert.match(appSource, /Weather data by/);
  assert.match(appSource, /Open-Meteo\.com/);
  assert.match(appSource, /https:\/\/open-meteo\.com\/en\/license/);
  assert.ok(appSource.indexOf("styles.sourceCredit") < appSource.indexOf("freshnessBanner"));
});
