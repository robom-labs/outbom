// 활동별 날씨·대기질 점수와 추천 시간, 결측·오래된 예보 처리를 검증한다.
import { describe, expect, it, vi } from "vitest";
import {
  buildForecastSnapshot,
  buildPreparationTips,
  fetchForecastSnapshot,
  getForecastFreshness,
  getRecommendationState,
  isUnsafeOutdoorSlot,
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
    daily: {
      time: ["2026-07-16"],
      sunrise: ["2026-07-16T00:30"],
      sunset: ["2026-07-16T23:30"]
    },
    hourly: {
      time: ["2026-07-16T01:00", "2026-07-16T02:00", "2026-07-16T03:00", "2026-07-16T04:00"],
      temperature_2m: [18, 19, 20, 21],
      apparent_temperature: [18, 19, 20, 21],
      precipitation: [0, 0, 0, 0],
      precipitation_probability: [10, 5, 0, 0],
      wind_speed_10m: [2, 1, 1, 1],
      wind_gusts_10m: [3, 2, 2, 2],
      uv_index: [1, 1, 1, 1],
      relative_humidity_2m: [55, 53, 52, 50],
      weather_code: [1, 1, 1, 1],
      snowfall: [0, 0, 0, 0],
      is_day: [1, 1, 1, 1],
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
  it("웹과 네이티브의 5개 활동 점수 프로필을 동일하게 유지한다", () => {
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
      sunrise: "2026-07-16T00:30",
      sunset: "2026-07-16T23:30",
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

  it("낙뢰·돌풍 시간대를 추천 구간에서 제외한다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({
        time: ["2026-07-16T04:00", "2026-07-16T05:00", "2026-07-16T06:00", "2026-07-16T07:00"],
        weather_code: [95, 95, 1, 1],
        wind_gusts_10m: [16, 16, 2, 2]
      }),
      airResponse(),
      "hike",
      "서울",
      new Date("2026-07-16T04:30:00.000Z")
    );

    expect(snapshot.bestTime).toBe("2026-07-16T06:00");
    expect(getRecommendationState(snapshot)).toBe("recommended");
  });

  it("결빙성 강수는 모든 활동에서 위험으로 차단한다", () => {
    const freezingRain = metrics({ weatherCode: 67, precipitation: 0.1, temperature: 1 });

    expect(isUnsafeOutdoorSlot(freezingRain, "walk")).toBe(true);
    expect(scoreActivityConditions(freezingRain, "walk").score).toBeLessThanOrEqual(15);
    expect(scoreActivityConditions(freezingRain, "walk").detail).toContain("어는 비");
  });

  it("안개·폭설·강한 소나기는 등산과 자전거 추천에서 제외한다", () => {
    expect(isUnsafeOutdoorSlot(metrics({ weatherCode: 45 }), "hike")).toBe(true);
    expect(isUnsafeOutdoorSlot(metrics({ weatherCode: 45 }), "bike")).toBe(true);
    expect(isUnsafeOutdoorSlot(metrics({ weatherCode: 45 }), "walk")).toBe(false);
    expect(isUnsafeOutdoorSlot(metrics({ weatherCode: 86, snowfall: 0.2 }), "bike")).toBe(true);
    expect(isUnsafeOutdoorSlot(metrics({ weatherCode: 82 }), "hike")).toBe(true);
    expect(scoreActivityConditions(metrics({ weatherCode: 82 }), "hike").detail).toContain("강한 비");
  });

  it("등산 추천은 일몰 한 시간 전까지 끝나는 구간만 허용한다", () => {
    const snapshot = buildForecastSnapshot(
      {
        ...weatherResponse({
          time: ["2026-07-16T16:00", "2026-07-16T17:00", "2026-07-16T18:00", "2026-07-16T19:00"],
          is_day: [1, 1, 1, 0]
        }),
        daily: {
          time: ["2026-07-16"],
          sunrise: ["2026-07-16T05:30"],
          sunset: ["2026-07-16T18:30"]
        }
      },
      null,
      "hike",
      "서울",
      new Date("2026-07-16T16:30:00.000Z")
    );

    expect(getRecommendationState(snapshot)).toBe("limited");
    expect(buildPreparationTips(snapshot).some((tip) => tip.includes("일몰 18:30") && tip.includes("헤드랜턴"))).toBe(true);
  });

  it("실제 예보 요청에 위험 기상과 일출·일몰 필드를 빠짐없이 포함한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T01:30:00.000Z"));
    const urls: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      const body = url.includes("air-quality") ? airResponse() : weatherResponse();
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    try {
      await fetchForecastSnapshot({ latitude: 37.5665, longitude: 126.978, locationName: "서울", activity: "walk" });
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }

    const forecastUrl = new URL(urls.find((url) => !url.includes("air-quality")) as string);
    expect(forecastUrl.searchParams.get("daily")).toBe("sunrise,sunset");
    expect(forecastUrl.searchParams.get("hourly")).toContain("wind_gusts_10m");
    expect(forecastUrl.searchParams.get("hourly")).toContain("weather_code");
    expect(forecastUrl.searchParams.get("hourly")).toContain("snowfall");
    expect(forecastUrl.searchParams.get("hourly")).toContain("is_day");
  });

  it("웹과 같은 무강수·시간대·55점·평균 62점 기준으로만 추천한다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({
        time: ["2026-07-16T06:00", "2026-07-16T07:00", "2026-07-16T08:00", "2026-07-16T09:00"]
      }),
      airResponse(),
      "walk",
      "서울",
      new Date("2026-07-16T06:30:00.000Z")
    );
    const belowEach = {
      ...snapshot,
      bestTime: snapshot.slots[0].time,
      slots: snapshot.slots.map((slot, index) => ({ ...slot, score: index === 0 ? 54 : 70 }))
    };
    const belowAverage = {
      ...snapshot,
      bestTime: snapshot.slots[0].time,
      slots: snapshot.slots.map((slot, index) => ({ ...slot, score: index < 2 ? 60 : slot.score }))
    };
    const rainy = {
      ...snapshot,
      bestTime: snapshot.slots[0].time,
      slots: snapshot.slots.map((slot, index) => index < 2 ? { ...slot, precipitation: 0.2 } : slot)
    };

    expect(getRecommendationState(belowEach)).toBe("limited");
    expect(getRecommendationState(belowAverage)).toBe("limited");
    expect(getRecommendationState(rainy)).toBe("limited");
    expect(getRecommendationState(snapshot)).toBe("recommended");
  });

  it("PM10 매우 나쁨도 안전 추천에서 제외한다", () => {
    expect(isUnsafeOutdoorSlot(metrics({ pm25: null, pm10: 151 }), "walk")).toBe(true);
  });

  it("중간 시각이 빠진 슬롯을 연속 2시간 추천으로 묶지 않는다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({
        time: ["2026-07-16T06:00", "2026-07-16T08:00", "2026-07-16T09:00", "2026-07-16T10:00"]
      }),
      airResponse(),
      "walk",
      "서울",
      new Date("2026-07-16T06:30:00.000Z")
    );

    expect(snapshot.bestTime).not.toBe("2026-07-16T06:00");
    expect(getRecommendationState(snapshot)).toBe("recommended");
  });

  it("안전한 연속 구간이 없으면 추천이 아니라 제한 상태로 표시한다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({ weather_code: [95, 95, 95, 95] }),
      airResponse(),
      "bike",
      "서울",
      new Date("2026-07-16T01:30:00.000Z")
    );

    expect(getRecommendationState(snapshot)).toBe("limited");
    expect(snapshot.bestScore).toBeLessThanOrEqual(15);
  });

  it("준비 정보는 현재가 아니라 추천 2시간의 조건을 사용한다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({ apparent_temperature: [35, 20, 20, 20] }),
      airResponse(),
      "run",
      "서울",
      new Date("2026-07-16T01:30:00.000Z")
    );
    const tips = buildPreparationTips(snapshot);

    expect(snapshot.bestTime).not.toBe(snapshot.forecastTime);
    expect(tips.some((tip) => tip.includes("물 한 병"))).toBe(false);
    expect(tips.some((tip) => tip.includes("러닝화"))).toBe(true);
  });

  it("야간 추천에는 조명과 반사 소품을 우선 안내한다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({ is_day: [0, 0, 0, 0] }),
      airResponse(),
      "walk",
      "서울",
      new Date("2026-07-16T01:30:00.000Z")
    );

    expect(buildPreparationTips(snapshot).some((tip) => tip.includes("조명") && tip.includes("반사"))).toBe(true);
  });

  it("저장 시각과 남은 시간축으로 예보 신선도를 구분한다", () => {
    const fresh = buildForecastSnapshot(
      weatherResponse(),
      airResponse(),
      "walk",
      "서울",
      new Date("2026-07-16T01:30:00.000Z")
    );

    expect(getForecastFreshness(fresh, new Date("2026-07-16T02:00:00.000Z")).state).toBe("fresh");
    expect(getForecastFreshness(fresh, new Date("2026-07-16T04:45:00.000Z")).state).toBe("aging");
    expect(getForecastFreshness(fresh, new Date("2026-07-16T10:00:00.000Z")).state).toBe("stale");
  });

  it("자정을 넘긴 저장 예보는 6시간 이내여도 오래된 정보로 강등한다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({
        time: ["2026-07-16T23:00", "2026-07-17T00:00", "2026-07-17T01:00", "2026-07-17T02:00"]
      }),
      airResponse(),
      "walk",
      "서울",
      new Date("2026-07-16T23:30:00.000Z")
    );

    expect(getForecastFreshness(snapshot, new Date("2026-07-17T00:15:00.000Z")).state).toBe("stale");
  });
});
