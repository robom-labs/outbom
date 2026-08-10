// 활동별 날씨·대기질 점수와 추천 시간, 결측·오래된 예보 처리를 검증한다.
import { describe, expect, it, vi } from "vitest";
import {
  buildForecastSnapshot,
  buildPreparationTips,
  fetchForecastSnapshot,
  getAirQualityCoverage,
  getCurrentForecastSnapshot,
  getForecastAvailability,
  getForecastFreshness,
  getRankedForecastWindows,
  getRecommendationState,
  hasIncompleteCurrentSafetyData,
  hasIncompleteSafetyData,
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
      visibility: [20000, 20000, 20000, 20000],
      uv_index: [1, 1, 1, 1],
      relative_humidity_2m: [55, 53, 52, 50],
      weather_code: [1, 1, 1, 1],
      snowfall: [0, 0, 0, 0],
      is_day: [1, 1, 1, 1],
      ...overrides
    }
  };
}

function airResponse(
  pm25: (number | null)[] = [12, 13, 14, 15],
  pm10: (number | null)[] = [24, 25, 26, 27],
  times: string[] = ["2026-07-16T01:00", "2026-07-16T02:00", "2026-07-16T03:00", "2026-07-16T04:00"]
): AirQualityApiResponse {
  return {
    timezone: "UTC",
    hourly: {
      time: times,
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
    expect(snapshot.timelineSlots).toHaveLength(4);
    expect(snapshot).not.toHaveProperty("latitude");
    expect(snapshot).not.toHaveProperty("longitude");
  });

  it("늦은 시각에도 오늘 그래프용 전체 시간대는 보존하고 추천은 현재 이후만 사용한다", () => {
    const times = ["2026-07-16T20:00", "2026-07-16T21:00", "2026-07-16T22:00", "2026-07-16T23:00", "2026-07-17T00:00"];
    const snapshot = buildForecastSnapshot(
      weatherResponse({
        time: times,
        temperature_2m: [24, 23, 22, 21, 20],
        apparent_temperature: [25, 24, 23, 22, 21],
        precipitation: [0, 0, 0, 0, 0],
        precipitation_probability: [20, 15, 10, 5, 5],
        wind_speed_10m: [3, 2, 2, 1, 1],
        wind_gusts_10m: [5, 4, 3, 2, 2],
        visibility: [20000, 20000, 20000, 20000, 20000],
        uv_index: [0, 0, 0, 0, 0],
        relative_humidity_2m: [70, 68, 65, 62, 60],
        weather_code: [1, 1, 1, 1, 1],
        snowfall: [0, 0, 0, 0, 0],
        is_day: [0, 0, 0, 0, 0]
      }),
      airResponse([12, 12, 12, 12, 12], [24, 24, 24, 24, 24], times),
      "walk",
      "서울",
      new Date("2026-07-16T23:30:00.000Z")
    );

    expect(snapshot.forecastTime).toBe("2026-07-16T23:00");
    expect(snapshot.slots.map((slot) => slot.time)).toEqual(["2026-07-16T23:00", "2026-07-17T00:00"]);
    expect(snapshot.timelineSlots?.map((slot) => slot.time)).toEqual(times);
  });

  it("폭우와 나쁜 대기질에는 안전 점수 상한을 적용한다", () => {
    const rain = scoreActivityConditions(metrics({ precipitation: 5, precipitationProbability: 95 }), "walk");
    const dust = scoreActivityConditions(metrics({ pm25: 88, pm10: 175 }), "run");

    expect(rain.score).toBeLessThanOrEqual(25);
    expect(rain.judgment).toContain("미루는");
    expect(dust.score).toBeLessThanOrEqual(30);
    expect(dust.detail).toContain("미세먼지");
  });

  it("미세먼지 나쁨 단계에는 2시간 추천이 뜨지 않게 60점으로 제한한다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({
        time: ["2026-07-16T06:00", "2026-07-16T07:00", "2026-07-16T08:00", "2026-07-16T09:00"]
      }),
      airResponse(
        [36, 36, 36, 36],
        [81, 81, 81, 81],
        ["2026-07-16T06:00", "2026-07-16T07:00", "2026-07-16T08:00", "2026-07-16T09:00"]
      ),
      "run",
      "서울",
      new Date("2026-07-16T06:30:00.000Z")
    );

    expect(snapshot.score).toBe(60);
    expect(snapshot.detail).toContain("시간대 기준 미세먼지 수치");
    expect(getRecommendationState(snapshot)).toBe("limited");
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
    expect(getAirQualityCoverage(snapshot)).toBe("missing");
    expect(hasIncompleteCurrentSafetyData(snapshot)).toBe(true);
    expect(getRecommendationState(snapshot)).toBe("limited");
  });

  it("대기질 일부 시간·항목이 누락되면 안전 추천으로 확정하지 않는다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({
        time: ["2026-07-16T06:00", "2026-07-16T07:00", "2026-07-16T08:00", "2026-07-16T09:00"]
      }),
      airResponse(
        [12, 13, 14, 15],
        [null, null, null, null],
        ["2026-07-16T06:00", "2026-07-16T07:00", "2026-07-16T08:00", "2026-07-16T09:00"]
      ),
      "walk",
      "서울",
      new Date("2026-07-16T06:30:00.000Z")
    );

    expect(getAirQualityCoverage(snapshot)).toBe("partial");
    expect(hasIncompleteCurrentSafetyData(snapshot)).toBe(true);
    expect(getRecommendationState(snapshot)).toBe("limited");
  });

  it("돌풍·가시거리·기상 상태·주야간 정보가 하나라도 누락되면 안전 추천으로 확정하지 않는다", () => {
    const missingSignals: Partial<ForecastApiResponse["hourly"]>[] = [
      { wind_gusts_10m: [null, null, null, null] },
      { visibility: [null, null, null, null] },
      { weather_code: [null, null, null, null] },
      { snowfall: [null, null, null, null] },
      { is_day: [null, null, null, null] }
    ];

    for (const override of missingSignals) {
      const snapshot = buildForecastSnapshot(
        weatherResponse({
          time: ["2026-07-16T06:00", "2026-07-16T07:00", "2026-07-16T08:00", "2026-07-16T09:00"],
          ...override
        }),
        airResponse(
          [12, 13, 14, 15],
          [24, 25, 26, 27],
          ["2026-07-16T06:00", "2026-07-16T07:00", "2026-07-16T08:00", "2026-07-16T09:00"]
        ),
        "walk",
        "서울",
        new Date("2026-07-16T06:30:00.000Z")
      );

      expect(hasIncompleteSafetyData(snapshot)).toBe(true);
      expect(hasIncompleteCurrentSafetyData(snapshot)).toBe(true);
      expect(getRecommendationState(snapshot)).toBe("limited");
    }
  });

  it("등산은 일몰 정보가 누락되면 안전 추천으로 확정하지 않는다", () => {
    const snapshot = buildForecastSnapshot(
      {
        ...weatherResponse({
          time: ["2026-07-16T06:00", "2026-07-16T07:00", "2026-07-16T08:00", "2026-07-16T09:00"]
        }),
        daily: { time: ["2026-07-16"], sunrise: ["2026-07-16T05:30"], sunset: [null] }
      },
      airResponse(
        [12, 13, 14, 15],
        [24, 25, 26, 27],
        ["2026-07-16T06:00", "2026-07-16T07:00", "2026-07-16T08:00", "2026-07-16T09:00"]
      ),
      "hike",
      "서울",
      new Date("2026-07-16T06:30:00.000Z")
    );

    expect(hasIncompleteSafetyData(snapshot)).toBe(true);
    expect(hasIncompleteCurrentSafetyData(snapshot)).toBe(true);
    expect(getRecommendationState(snapshot)).toBe("limited");
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

  it("현재 시각 핵심값이 누락되면 다음 시간을 현재 조건으로 승격하지 않는다", () => {
    const response = weatherResponse({
      time: ["2026-07-16T10:00", "2026-07-16T11:00", "2026-07-16T12:00", "2026-07-16T13:00"],
      uv_index: [null, 1, 1, 1]
    });
    const air = airResponse(
      [12, 12, 12, 12],
      [24, 24, 24, 24],
      ["2026-07-16T10:00", "2026-07-16T11:00", "2026-07-16T12:00", "2026-07-16T13:00"]
    );

    expect(() => buildForecastSnapshot(response, air, "walk", "서울", new Date("2026-07-16T10:59:59.000Z"))).toThrow("현재 시각 예보의 핵심 정보");
    expect(buildForecastSnapshot(response, air, "walk", "서울", new Date("2026-07-16T11:00:00.000Z")).forecastTime).toBe("2026-07-16T11:00");
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
      airResponse(
        [12, 13, 14, 15],
        [24, 25, 26, 27],
        ["2026-07-16T04:00", "2026-07-16T05:00", "2026-07-16T06:00", "2026-07-16T07:00"]
      ),
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

  it("가시거리 200m 미만은 모든 활동, 1km 미만은 등산·자전거에서 차단한다", () => {
    expect(isUnsafeOutdoorSlot(metrics({ visibility: 199 }), "walk")).toBe(true);
    expect(scoreActivityConditions(metrics({ visibility: 199 }), "walk").score).toBeLessThanOrEqual(40);
    expect(isUnsafeOutdoorSlot(metrics({ visibility: 999 }), "hike")).toBe(true);
    expect(isUnsafeOutdoorSlot(metrics({ visibility: 999 }), "bike")).toBe(true);
    expect(isUnsafeOutdoorSlot(metrics({ visibility: 1_000 }), "hike")).toBe(false);
  });

  it("자외선 지수 3부터 보호 준비를 안내한다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({ uv_index: [3, 3, 3, 3] }),
      airResponse(),
      "walk",
      "서울",
      new Date("2026-07-16T01:30:00.000Z")
    );

    expect(snapshot.detail).toContain("자외선 차단");
    expect(buildPreparationTips(snapshot).some((tip) => tip.includes("선글라스") && tip.includes("차단제"))).toBe(true);
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
    const airQualityUrl = new URL(urls.find((url) => url.includes("air-quality")) as string);
    expect(forecastUrl.searchParams.get("forecast_days")).toBe("2");
    expect(airQualityUrl.searchParams.get("forecast_days")).toBe("2");
    expect(forecastUrl.searchParams.has("forecast_hours")).toBe(false);
    expect(forecastUrl.searchParams.get("daily")).toBe("sunrise,sunset");
    expect(forecastUrl.searchParams.get("hourly")).toContain("wind_gusts_10m");
    expect(forecastUrl.searchParams.get("hourly")).toContain("visibility");
    expect(forecastUrl.searchParams.get("hourly")).toContain("weather_code");
    expect(forecastUrl.searchParams.get("hourly")).toContain("snowfall");
    expect(forecastUrl.searchParams.get("hourly")).toContain("is_day");
  });

  it("대기질 응답이 멈춰도 4초 뒤 날씨 예보를 먼저 사용할 수 있다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T01:30:00.000Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (!String(input).includes("air-quality")) {
        return new Response(JSON.stringify(weatherResponse()), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return await new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });

    try {
      const pending = fetchForecastSnapshot({ latitude: 37.5665, longitude: 126.978, locationName: "서울", activity: "walk" });
      await vi.advanceTimersByTimeAsync(4_001);
      const snapshot = await pending;
      expect(getAirQualityCoverage(snapshot)).toBe("missing");
      expect(snapshot.metrics.temperature).toBe(18);
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("웹과 같은 무강수·시간대·55점·평균 62점 기준으로만 추천한다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({
        time: ["2026-07-16T06:00", "2026-07-16T07:00", "2026-07-16T08:00", "2026-07-16T09:00"]
      }),
      airResponse(
        [12, 13, 14, 15],
        [24, 25, 26, 27],
        ["2026-07-16T06:00", "2026-07-16T07:00", "2026-07-16T08:00", "2026-07-16T09:00"]
      ),
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

  it("추천 화면은 연속된 두 시간만 안전 여부와 점수 순으로 정렬한다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({
        time: ["2026-07-16T06:00", "2026-07-16T07:00", "2026-07-16T08:00", "2026-07-16T09:00"]
      }),
      airResponse(
        [12, 13, 14, 15],
        [24, 25, 26, 27],
        ["2026-07-16T06:00", "2026-07-16T07:00", "2026-07-16T08:00", "2026-07-16T09:00"]
      ),
      "walk",
      "서울",
      new Date("2026-07-16T06:30:00.000Z")
    );
    const windows = getRankedForecastWindows(snapshot, "2026-07-16");

    expect(windows).toHaveLength(3);
    expect(windows[0].recommended).toBe(true);
    expect(windows[0].start).toMatch(/T\d{2}:00$/);
    expect(windows[0].end).toMatch(/T\d{2}:00$/);
    expect(windows.map((window) => window.score)).toEqual([...windows.map((window) => window.score)].sort((left, right) => right - left));
  });

  it("PM10 매우 나쁨도 안전 추천에서 제외한다", () => {
    expect(isUnsafeOutdoorSlot(metrics({ pm25: null, pm10: 151 }), "walk")).toBe(true);
  });

  it("시간대 미세먼지 경계값을 소수점 입력까지 동일하게 적용한다", () => {
    expect(isUnsafeOutdoorSlot(metrics({ pm25: 35, pm10: 80 }), "walk")).toBe(false);
    expect(isUnsafeOutdoorSlot(metrics({ pm25: 35.01, pm10: 80 }), "walk")).toBe(false);
    expect(isUnsafeOutdoorSlot(metrics({ pm25: 35.06, pm10: 80 }), "walk")).toBe(true);
    expect(isUnsafeOutdoorSlot(metrics({ pm25: 35, pm10: 80.01 }), "walk")).toBe(false);
    expect(isUnsafeOutdoorSlot(metrics({ pm25: 35, pm10: 80.06 }), "walk")).toBe(true);
    expect(scoreActivityConditions(metrics({ pm25: 75, pm10: 150 }), "walk").score).toBeLessThanOrEqual(60);
    expect(scoreActivityConditions(metrics({ pm25: 75.01, pm10: 150 }), "walk").score).toBeGreaterThan(30);
    expect(scoreActivityConditions(metrics({ pm25: 75.06, pm10: 150 }), "walk").score).toBeLessThanOrEqual(30);
    expect(scoreActivityConditions(metrics({ pm25: 35, pm10: 150.01 }), "walk").score).toBeGreaterThan(30);
    expect(scoreActivityConditions(metrics({ pm25: 35, pm10: 150.06 }), "walk").score).toBeLessThanOrEqual(30);
  });

  it("두 시간 중 한 시간만 미세먼지 수치가 높아도 추천하지 않는다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({ time: ["2026-07-16T06:00", "2026-07-16T07:00"] }),
      airResponse(
        [35.06, 12],
        [24, 24],
        ["2026-07-16T06:00", "2026-07-16T07:00"]
      ),
      "walk",
      "서울",
      new Date("2026-07-16T06:30:00.000Z")
    );

    expect(getRecommendationState(snapshot)).toBe("limited");
  });

  it("중간 시각이 빠진 슬롯을 연속 2시간 추천으로 묶지 않는다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({
        time: ["2026-07-16T06:00", "2026-07-16T08:00", "2026-07-16T09:00", "2026-07-16T10:00"]
      }),
      airResponse(
        [12, 13, 14, 15],
        [24, 25, 26, 27],
        ["2026-07-16T06:00", "2026-07-16T08:00", "2026-07-16T09:00", "2026-07-16T10:00"]
      ),
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

  it("준비 정보는 위험 코드 순서와 무관하게 결빙·안개·강한 비를 보존한다", () => {
    const base = buildForecastSnapshot(
      weatherResponse(),
      airResponse(),
      "hike",
      "서울",
      new Date("2026-07-16T01:30:00.000Z")
    );
    const tipsFor = (codes: number[]) => buildPreparationTips({
      ...base,
      bestTime: base.slots[0].time,
      slots: base.slots.map((slot, index) => ({ ...slot, weatherCode: codes[index] ?? 1 }))
    });

    for (const codes of [[67, 71, 1, 1], [71, 67, 1, 1]]) {
      expect(tipsFor(codes).some((tip) => tip.includes("어는 비"))).toBe(true);
    }
    for (const codes of [[45, 82, 1, 1], [82, 45, 1, 1]]) {
      const tips = tipsFor(codes);
      expect(tips.some((tip) => tip.includes("안개"))).toBe(true);
      expect(tips.some((tip) => tip.includes("강한 비"))).toBe(true);
    }
  });

  it("준비 정보는 두 시간 중 한 시간만 영하여도 보온을 안내한다", () => {
    const base = buildForecastSnapshot(
      weatherResponse(),
      airResponse(),
      "walk",
      "서울",
      new Date("2026-07-16T01:30:00.000Z")
    );

    for (const temperatures of [[-5, 2, 20, 21], [2, -5, 20, 21]]) {
      const tips = buildPreparationTips({
        ...base,
        bestTime: base.slots[0].time,
        slots: base.slots.map((slot, index) => ({ ...slot, apparentTemperature: temperatures[index] }))
      });
      expect(tips.some((tip) => tip.includes("보온 겉옷"))).toBe(true);
    }
  });

  it("준비 정보는 다른 선택 팁이 많아도 위험한 더위와 미세먼지를 생략하지 않는다", () => {
    const base = buildForecastSnapshot(
      weatherResponse(),
      airResponse(),
      "walk",
      "서울",
      new Date("2026-07-16T01:30:00.000Z")
    );
    const hazardous = {
      ...base,
      bestTime: base.slots[0].time,
      slots: base.slots.map((slot, index) => index === 1
        ? {
            ...slot,
            apparentTemperature: 38,
            pm25: 35.06,
            precipitationProbability: 80,
            windGust: 11,
            uvIndex: 8
          }
        : slot)
    };
    const tips = buildPreparationTips(hazardous);

    expect(tips.some((tip) => tip.includes("미세먼지 수치가 높아요"))).toBe(true);
    expect(tips.some((tip) => tip.includes("체감온도가 위험하게 높아요"))).toBe(true);
  });

  it("다음 날 추천 등산 준비에는 추천일의 일몰을 사용한다", () => {
    const base = buildForecastSnapshot(
      weatherResponse(),
      airResponse(),
      "hike",
      "서울",
      new Date("2026-07-16T01:30:00.000Z")
    );
    const nextDay = {
      ...base,
      bestTime: "2026-07-17T06:00",
      slots: base.slots.map((slot, index) => ({
        ...slot,
        time: index === 0 ? "2026-07-16T23:00" : `2026-07-17T${String(index + 5).padStart(2, "0")}:00`,
        sunset: index === 0 ? "2026-07-16T18:30" : "2026-07-17T18:31"
      }))
    };
    const tips = buildPreparationTips(nextDay);

    expect(tips.some((tip) => tip.includes("7/17 일몰 18:31"))).toBe(true);
    expect(tips.every((tip) => !tip.includes("일몰 18:30"))).toBe(true);
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

  it("저장 후 정확히 6시간까지는 노화 상태, 1밀리초 뒤에는 오래된 상태로 구분한다", () => {
    const base = buildForecastSnapshot(
      weatherResponse(),
      airResponse(),
      "walk",
      "서울",
      new Date("2026-07-16T01:30:00.000Z")
    );
    const extended = {
      ...base,
      slots: Array.from({ length: 9 }, (_, index) => ({
        ...base.slots[Math.min(index, base.slots.length - 1)],
        time: `2026-07-16T${String(index + 1).padStart(2, "0")}:00`
      }))
    };

    expect(getForecastFreshness(extended, new Date("2026-07-16T07:30:00.000Z")).state).toBe("aging");
    expect(getForecastFreshness(extended, new Date("2026-07-16T07:30:00.001Z")).state).toBe("stale");
  });

  it("시간이 다음 정시로 넘어가면 현재 슬롯과 추천 구간을 남은 예보로 다시 계산한다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({
        time: ["2026-07-16T10:00", "2026-07-16T11:00", "2026-07-16T12:00", "2026-07-16T13:00"],
        weather_code: [1, 1, 95, 95]
      }),
      airResponse(
        [12, 12, 12, 12],
        [24, 24, 24, 24],
        ["2026-07-16T10:00", "2026-07-16T11:00", "2026-07-16T12:00", "2026-07-16T13:00"]
      ),
      "walk",
      "서울",
      new Date("2026-07-16T10:30:00.000Z")
    );
    const before = getCurrentForecastSnapshot(snapshot, new Date("2026-07-16T10:59:59.000Z"));
    const after = getCurrentForecastSnapshot(snapshot, new Date("2026-07-16T11:00:00.000Z"));

    expect(before?.forecastTime).toBe("2026-07-16T10:00");
    expect(after?.forecastTime).toBe("2026-07-16T11:00");
    expect(after?.generatedAt).toBe(snapshot.generatedAt);
    expect(getRecommendationState(before as NonNullable<typeof before>)).toBe("recommended");
    expect(getRecommendationState(after as NonNullable<typeof after>)).toBe("limited");
    expect(getCurrentForecastSnapshot(snapshot, new Date("2026-07-16T14:00:00.000Z"))).toBeNull();
  });

  it("저장 예보의 현재 시간이 비면 다음 시간을 현재 조건으로 승격하지 않는다", () => {
    const snapshot = buildForecastSnapshot(
      weatherResponse({
        time: ["2026-07-16T10:00", "2026-07-16T11:00", "2026-07-16T12:00", "2026-07-16T13:00"]
      }),
      airResponse(
        [12, 12, 12, 12],
        [24, 24, 24, 24],
        ["2026-07-16T10:00", "2026-07-16T11:00", "2026-07-16T12:00", "2026-07-16T13:00"]
      ),
      "walk",
      "서울",
      new Date("2026-07-16T10:30:00.000Z")
    );
    const gap = {
      ...snapshot,
      slots: snapshot.slots.filter((slot) => slot.time !== "2026-07-16T11:00")
    };

    expect(getForecastAvailability(gap, new Date("2026-07-16T10:59:59.000Z"))).toBe("active");
    expect(getCurrentForecastSnapshot(gap, new Date("2026-07-16T10:59:59.000Z"))?.forecastTime).toBe("2026-07-16T10:00");
    expect(getForecastAvailability(gap, new Date("2026-07-16T11:00:00.000Z"))).toBe("current-missing");
    expect(getCurrentForecastSnapshot(gap, new Date("2026-07-16T11:00:00.000Z"))).toBeNull();
    expect(getForecastAvailability(gap, new Date("2026-07-16T12:00:00.000Z"))).toBe("active");
    expect(getCurrentForecastSnapshot(gap, new Date("2026-07-16T12:00:00.000Z"))?.forecastTime).toBe("2026-07-16T12:00");
    expect(getForecastAvailability(gap, new Date("2026-07-16T14:00:00.000Z"))).toBe("expired");
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
