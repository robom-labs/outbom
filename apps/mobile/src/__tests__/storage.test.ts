// 예보 저장, 손상 데이터 방어, 이전 형식 마이그레이션과 활동 선호 보존을 검증한다.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LAST_FORECAST_KEY,
  LEGACY_LAST_FORECAST_KEY,
  PREPARATION_CHECKS_KEY,
  SAVED_LOCATIONS_KEY,
  SELECTED_ACTIVITY_KEY,
  isForecastSnapshot,
  loadForecastSnapshot,
  loadPreparationChecks,
  loadSavedLocations,
  loadSelectedActivity,
  saveForecastSnapshot,
  savePreparationChecks,
  saveSavedLocations,
  saveSelectedActivity
} from "../lib/storage";
import { buildForecastSnapshot, type ForecastApiResponse } from "../lib/forecast";

const mockStorage = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItem: vi.fn(async (key: string) => mockStorage.values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      mockStorage.values.set(key, value);
    })
  }
}));

const response: ForecastApiResponse = {
  timezone: "UTC",
  daily: {
    time: ["2026-07-16"],
    sunrise: ["2026-07-16T05:30"],
    sunset: ["2026-07-16T19:30"]
  },
  hourly: {
    time: ["2026-07-16T01:00", "2026-07-16T02:00"],
    temperature_2m: [18, 19],
    apparent_temperature: [18, 19],
    precipitation: [0, 0],
    precipitation_probability: [10, 5],
    wind_speed_10m: [2, 1],
    visibility: [12000, 11000],
    uv_index: [1, 1],
    relative_humidity_2m: [55, 53]
  }
};

describe("native local storage", () => {
  beforeEach(() => mockStorage.values.clear());

  it("새 형식 예보를 좌표 없이 저장하고 다시 읽는다", async () => {
    const snapshot = buildForecastSnapshot(response, null, "bike", "서울", new Date("2026-07-16T01:30:00.000Z"));

    expect(await saveForecastSnapshot(snapshot)).toBe(true);
    await expect(loadForecastSnapshot()).resolves.toEqual(snapshot);
    expect(snapshot.sunset).toBe("2026-07-16T19:30");
    expect(snapshot.metrics.visibility).toBe(12000);
    expect(mockStorage.values.get(LAST_FORECAST_KEY)).not.toContain("latitude");
  });

  it("이전 v1 저장값을 걷기 기준 v2로 마이그레이션한다", async () => {
    mockStorage.values.set(LEGACY_LAST_FORECAST_KEY, JSON.stringify({
      schemaVersion: 1,
      locationName: "현재 위치",
      generatedAt: "2026-07-16T01:30:00.000Z",
      forecastTime: "2026-07-16T01:00",
      score: 88,
      judgment: "지금 출발하기 좋아요",
      detail: "기존 설명",
      bestTime: "2026-07-16T02:00",
      bestScore: 90,
      metrics: {
        temperature: 18,
        apparentTemperature: 18,
        precipitation: 0,
        precipitationProbability: 10,
        windSpeed: 2,
        uvIndex: 1
      }
    }));

    const migrated = await loadForecastSnapshot();
    expect(migrated).toMatchObject({ schemaVersion: 2, activity: "walk", locationName: "현재 위치" });
    expect(migrated?.bestTime).toBe("2026-07-16T02:00");
    expect(migrated?.bestEndTime).toBe("2026-07-16T03:00");
    expect(migrated?.timezone).not.toBe("");
    expect(isForecastSnapshot(migrated)).toBe(true);
    expect(mockStorage.values.has(LAST_FORECAST_KEY)).toBe(true);
  });

  it("손상된 저장값은 앱을 깨뜨리지 않고 무시한다", async () => {
    mockStorage.values.set(LAST_FORECAST_KEY, "{not-json");
    await expect(loadForecastSnapshot()).resolves.toBeNull();
  });

  it("선택 활동만 허용하고 잘못된 값은 걷기로 복구한다", async () => {
    expect(await saveSelectedActivity("hike")).toBe(true);
    await expect(loadSelectedActivity()).resolves.toBe("hike");

    mockStorage.values.set(SELECTED_ACTIVITY_KEY, "unknown");
    await expect(loadSelectedActivity()).resolves.toBe("walk");
  });

  it("저장 위치는 유효한 항목만 보존한다", async () => {
    const location = {
      id: "37.5:127.0",
      name: "고척동",
      detail: "서울 구로구",
      latitude: 37.5,
      longitude: 127,
      kind: "favorite" as const,
      lastUsedAt: "2026-08-11T10:00:00.000Z"
    };

    expect(await saveSavedLocations([location])).toBe(true);
    await expect(loadSavedLocations()).resolves.toEqual([location]);

    mockStorage.values.set(SAVED_LOCATIONS_KEY, JSON.stringify([location, { name: "손상 위치" }]));
    await expect(loadSavedLocations()).resolves.toEqual([location]);
  });

  it("준비물 체크 상태는 문자열 배열만 복구한다", async () => {
    const checks = { "2026-08-11:run:18:00:long": ["water", "reflective"] };
    expect(await savePreparationChecks(checks)).toBe(true);
    await expect(loadPreparationChecks()).resolves.toEqual(checks);

    mockStorage.values.set(PREPARATION_CHECKS_KEY, JSON.stringify({ valid: ["water", 1], broken: "water" }));
    await expect(loadPreparationChecks()).resolves.toEqual({ valid: ["water"] });
  });
});
