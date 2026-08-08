// 활동별 날씨·대기질 점수와 추천 시간, 결측·오래된 예보 처리를 검증한다.
import { describe, expect, it } from "vitest";
import {
  buildForecastSnapshot,
  buildPreparationTips,
  rescoreForecastSnapshot,
  scoreActivityConditions,
  type AirQualityApiResponse,
  type ForecastApiResponse,
  type ForecastMetrics
} from "../lib/forecast";
import { ACTIVITIES as MOBILE_ACTIVITIES, ACTIVITY_ORDER } from "../lib/activities";
import { ACTIVITIES as WEB_ACTIVITIES } from "../../../../lib/activity";

function weatherResponse(overrides: Partial<ForecastApiResponse["hourly"]> = {}): ForecastApiResponse {
  return {
    timezone: "UTC",
    hourly: {
      time: ["2026-07-16T01:00", "2026-07-16T02:00", "2026-07-16T03:00", "2026-07-16T04:00"],
      temperature_2m: [18, 19, 20, 21],
      apparent_temperature: [18, 19, 20, 21],
      precipitation: [0, 0, 0, 0],
      precipitation_probability: [10, 5, 0, 0],
      wind_speed_10m: [2, 1, 1, 1],
      uv_index: [1, 1, 1, 1],
      relative_humidity_2m: [55, 53, 52, 50],
      ...overrides
    }
  };
}

function airResponse(pm25 = [12, 13, 14, 15], pm10 = [24, 25, 26, 27]): AirQualityApiResponse {
  return {
    timezone: "UTC",
    hourly: {
      time: ["2026-07-16T01:00", "2026-07-16T02:00", "2026-07-16T03:00", "2026-07-16T04:00"],
      pm2_5: pm25,
      pm10
    }
  };
}

function metrics(overrides: Partial<ForecastMetrics> = {}): ForecastMetrics {
  return {
    temperature: 20,
    apparentTemperature: 20,
    precipitation: 0,
    precipitationProbability: 5,
    windSpeed: 2,
    uvIndex: 2,
    relativeHumidity: 55,
    pm25: 12,
    pm10: 24,
    ...overrides
  };
}

describe("native activity forecast", () => {
  it("웹과 네이티브의 5개 활동 안전 기준을 동일하게 유지한다", () => {
    for (const key of ACTIVITY_ORDER) {
      const mobile = MOBILE_ACTIVITIES[key];
      const web = WEB_ACTIVITIES[key];
      expect(mobile.weights).toEqual(web.weights);
      expect(mobile.temperature).toEqual({
        optimalLow: web.temp.optimalLo,
        optimalHigh: web.temp.optimalHi,
        coldSlope: web.temp.coldSlope,
        hotSlope: web.temp.hotSlope
      });
      expect(mobile.heatCaps).toEqual({
        cautionAt: web.heat.hot1,
        cautionCap: web.heat.hot1Cap,
        dangerAt: web.heat.hot2,
        dangerCap: web.heat.hot2Cap
      });
      expect(mobile.windCap).toEqual({ speed: web.windCap.speed, score: web.windCap.cap });
    }
  });

  it("현재 이후 슬롯과 대기질을 좌표 없는 저장 요약으로 만든다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse(),
      airResponse(),
      "walk",
      "현재 위치",
      new Date("2026-07-16T01:30:00.000Z")
    );

    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      activity: "walk",
      locationName: "현재 위치",
      forecastTime: "2026-07-16T01:00",
      metrics: { pm25: 12, pm10: 24, relativeHumidity: 55 }
    });
    expect(snapshot.score).toBeGreaterThanOrEqual(80);
    expect(snapshot.slots).toHaveLength(4);
    expect(snapshot).not.toHaveProperty("latitude");
    expect(snapshot).not.toHaveProperty("longitude");
  });

  it("폭우와 나쁜 대기질에는 안전 점수 상한을 적용한다", () => {
    const rain = scoreActivityConditions(metrics({ precipitation: 5, precipitationProbability: 95 }), "walk");
    const dust = scoreActivityConditions(metrics({ pm25: 88, pm10: 175 }), "run");

    expect(rain.score).toBeLessThanOrEqual(25);
    expect(rain.judgment).toContain("미루는");
    expect(dust.score).toBeLessThanOrEqual(30);
    expect(dust.detail).toContain("미세먼지");
  });

  it("활동별 위험 기준을 달리 적용한다", () => {
    const hotWalk = scoreActivityConditions(metrics({ apparentTemperature: 29 }), "walk");
    const hotDog = scoreActivityConditions(metrics({ apparentTemperature: 29 }), "dog");
    const windyWalk = scoreActivityConditions(metrics({ windSpeed: 12 }), "walk");
    const windyBike = scoreActivityConditions(metrics({ windSpeed: 12 }), "bike");

    expect(hotDog.score).toBeLessThan(hotWalk.score);
    expect(hotDog.score).toBeLessThanOrEqual(55);
    expect(windyBike.score).toBeLessThan(windyWalk.score);
    expect(windyBike.score).toBeLessThanOrEqual(38);
  });

  it("대기질 API가 실패해도 날씨만으로 예보를 만든다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse(),
      null,
      "hike",
      "서울",
      new Date("2026-07-16T01:30:00.000Z")
    );

    expect(snapshot.metrics.pm25).toBeNull();
    expect(snapshot.metrics.pm10).toBeNull();
    expect(snapshot.score).toBeGreaterThan(0);
  });

  it("저장 예보를 네트워크 없이 다른 활동 기준으로 다시 계산한다", () => {
    const walking = buildForecastSnapshot(
      weatherResponse({ apparent_temperature: [29, 29, 29, 29] }),
      airResponse(),
      "walk",
      "현재 위치",
      new Date("2026-07-16T01:30:00.000Z")
    );
    const dog = rescoreForecastSnapshot(walking, "dog");

    expect(dog.activity).toBe("dog");
    expect(dog.score).toBeLessThan(walking.score);
    expect(dog.generatedAt).toBe(walking.generatedAt);
  });

  it("현재 이후 예보가 없으면 오래된 첫 슬롯으로 되돌아가지 않는다", () => {
    expect(() => buildForecastSnapshot(
      weatherResponse(),
      null,
      "walk",
      "서울",
      new Date("2026-07-17T01:00:00.000Z")
    )).toThrow("현재 이후 예보");
  });

  it("활동과 위험 조건에 맞는 준비 정보를 중복 없이 만든다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({
        apparent_temperature: [28, 28, 28, 28],
        precipitation_probability: [70, 70, 70, 70],
        uv_index: [7, 7, 7, 7]
      }),
      airResponse([42, 42, 42, 42], [90, 90, 90, 90]),
      "run",
      "서울",
      new Date("2026-07-16T01:30:00.000Z")
    );
    const tips = buildPreparationTips(snapshot);

    expect(tips).toHaveLength(3);
    expect(tips.some((tip) => tip.includes("방수"))).toBe(true);
    expect(tips.some((tip) => tip.includes("러닝화"))).toBe(true);
    expect(new Set(tips).size).toBe(tips.length);
  });

  it("빈 시간별 예보는 명확히 실패해 이전 저장값을 덮지 않게 한다", () => {
    expect(() => buildForecastSnapshot({ hourly: { time: [] } }, null, "walk", "서울")).toThrow("시간별 예보");
  });
});
