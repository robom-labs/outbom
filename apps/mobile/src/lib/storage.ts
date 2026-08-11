// 마지막 예보와 선택 활동을 좌표 없이 저장하고 이전 저장 형식을 안전하게 마이그레이션한다.
import Storage from "expo-sqlite/kv-store";
import { isActivityKey, type ActivityKey } from "./activities";
import { scoreActivityConditions, type ForecastMetrics, type ForecastSlot, type ForecastSnapshot } from "./forecast";
import { isSavedLocation, type SavedLocation } from "./locations";

export const LAST_FORECAST_KEY = "outbom:native:last-forecast:v2";
export const LEGACY_LAST_FORECAST_KEY = "outbom:native:last-forecast:v1";
export const SELECTED_ACTIVITY_KEY = "outbom:native:activity:v1";
export const SAVED_LOCATIONS_KEY = "outbom:native:saved-locations:v1";
export const PREPARATION_CHECKS_KEY = "outbom:native:preparation-checks:v1";

type LegacyForecastSnapshot = {
  schemaVersion: 1;
  locationName: string;
  generatedAt: string;
  forecastTime: string;
  score: number;
  judgment: string;
  detail: string;
  bestTime: string;
  bestScore: number;
  metrics: Omit<ForecastMetrics, "relativeHumidity" | "pm25" | "pm10">;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isOptionalNullableNumber(value: unknown): value is number | null | undefined {
  return value === undefined || isNullableNumber(value);
}

function isOptionalNullableBoolean(value: unknown): value is boolean | null | undefined {
  return value === undefined || value === null || typeof value === "boolean";
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function isMetrics(value: unknown): value is ForecastMetrics {
  if (!value || typeof value !== "object") return false;
  const metrics = value as Partial<ForecastMetrics>;
  return isFiniteNumber(metrics.temperature)
    && isFiniteNumber(metrics.apparentTemperature)
    && isFiniteNumber(metrics.precipitation)
    && isNullableNumber(metrics.precipitationProbability)
    && isFiniteNumber(metrics.windSpeed)
    && isFiniteNumber(metrics.uvIndex)
    && isNullableNumber(metrics.relativeHumidity)
    && isNullableNumber(metrics.pm25)
    && isNullableNumber(metrics.pm10)
    && isOptionalNullableNumber(metrics.windGust)
    && isOptionalNullableNumber(metrics.visibility)
    && isOptionalNullableNumber(metrics.weatherCode)
    && isOptionalNullableNumber(metrics.snowfall)
    && isOptionalNullableBoolean(metrics.isDay);
}

function isForecastSlot(value: unknown): value is ForecastSlot {
  if (!isMetrics(value)) return false;
  const slot = value as Partial<ForecastSlot>;
  return typeof slot.time === "string"
    && isOptionalNullableString(slot.sunrise)
    && isOptionalNullableString(slot.sunset)
    && isFiniteNumber(slot.score)
    && typeof slot.judgment === "string"
    && typeof slot.detail === "string";
}

export function isForecastSnapshot(value: unknown): value is ForecastSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ForecastSnapshot>;
  return snapshot.schemaVersion === 2
    && isActivityKey(snapshot.activity)
    && typeof snapshot.locationName === "string"
    && typeof snapshot.generatedAt === "string"
    && typeof snapshot.timezone === "string"
    && typeof snapshot.forecastTime === "string"
    && isFiniteNumber(snapshot.score)
    && typeof snapshot.judgment === "string"
    && typeof snapshot.detail === "string"
    && typeof snapshot.bestTime === "string"
    && typeof snapshot.bestEndTime === "string"
    && isFiniteNumber(snapshot.bestScore)
    && isOptionalNullableString(snapshot.sunrise)
    && isOptionalNullableString(snapshot.sunset)
    && isMetrics(snapshot.metrics)
    && Array.isArray(snapshot.slots)
    && snapshot.slots.length > 0
    && snapshot.slots.every(isForecastSlot)
    && (snapshot.timelineSlots === undefined
      || (Array.isArray(snapshot.timelineSlots) && snapshot.timelineSlots.length > 0 && snapshot.timelineSlots.every(isForecastSlot)));
}

function isLegacySnapshot(value: unknown): value is LegacyForecastSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<LegacyForecastSnapshot>;
  const metrics = snapshot.metrics as Partial<LegacyForecastSnapshot["metrics"]> | undefined;
  return snapshot.schemaVersion === 1
    && typeof snapshot.locationName === "string"
    && typeof snapshot.generatedAt === "string"
    && typeof snapshot.forecastTime === "string"
    && isFiniteNumber(snapshot.score)
    && typeof snapshot.judgment === "string"
    && typeof snapshot.detail === "string"
    && typeof snapshot.bestTime === "string"
    && isFiniteNumber(snapshot.bestScore)
    && isFiniteNumber(metrics?.temperature)
    && isFiniteNumber(metrics?.apparentTemperature)
    && isFiniteNumber(metrics?.precipitation)
    && isNullableNumber(metrics?.precipitationProbability)
    && isFiniteNumber(metrics?.windSpeed)
    && isFiniteNumber(metrics?.uvIndex);
}

function nextHour(value: string) {
  const date = new Date(`${value.slice(0, 13)}:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCHours(date.getUTCHours() + 1);
  return date.toISOString().slice(0, 16);
}

export function migrateLegacySnapshot(legacy: LegacyForecastSnapshot): ForecastSnapshot {
  const metrics: ForecastMetrics = {
    ...legacy.metrics,
    relativeHumidity: null,
    pm25: null,
    pm10: null,
    windGust: null,
    visibility: null,
    weatherCode: null,
    snowfall: null,
    isDay: null
  };
  const scored = scoreActivityConditions(metrics, "walk");
  const slot: ForecastSlot = { time: legacy.forecastTime, ...metrics, ...scored };
  return {
    schemaVersion: 2,
    activity: "walk",
    locationName: legacy.locationName,
    generatedAt: legacy.generatedAt,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    forecastTime: legacy.forecastTime,
    score: scored.score,
    judgment: scored.judgment,
    detail: scored.detail,
    bestTime: legacy.bestTime,
    bestEndTime: nextHour(legacy.bestTime),
    bestScore: scored.score,
    metrics,
    slots: [slot]
  };
}

async function readJson(key: string) {
  const raw = await Storage.getItem(key);
  return raw ? JSON.parse(raw) as unknown : null;
}

export async function loadForecastSnapshot() {
  try {
    const current = await readJson(LAST_FORECAST_KEY);
    if (isForecastSnapshot(current)) return current;

    const legacy = await readJson(LEGACY_LAST_FORECAST_KEY);
    if (!isLegacySnapshot(legacy)) return null;
    const migrated = migrateLegacySnapshot(legacy);
    await Storage.setItem(LAST_FORECAST_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return null;
  }
}

export async function saveForecastSnapshot(snapshot: ForecastSnapshot) {
  try {
    await Storage.setItem(LAST_FORECAST_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export async function loadSelectedActivity(): Promise<ActivityKey> {
  try {
    const value = await Storage.getItem(SELECTED_ACTIVITY_KEY);
    return isActivityKey(value) ? value : "walk";
  } catch {
    return "walk";
  }
}

export async function saveSelectedActivity(activity: ActivityKey) {
  try {
    await Storage.setItem(SELECTED_ACTIVITY_KEY, activity);
    return true;
  } catch {
    return false;
  }
}

export async function loadSavedLocations(): Promise<SavedLocation[]> {
  try {
    const value = await readJson(SAVED_LOCATIONS_KEY);
    return Array.isArray(value) ? value.filter(isSavedLocation).slice(0, 24) : [];
  } catch {
    return [];
  }
}

export async function saveSavedLocations(locations: SavedLocation[]) {
  try {
    await Storage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(locations.filter(isSavedLocation).slice(0, 24)));
    return true;
  } catch {
    return false;
  }
}

function sanitizeCheckMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key, items]) => key.length > 0 && Array.isArray(items))
    .map(([key, items]) => [key, (items as unknown[]).filter((item): item is string => typeof item === "string")]));
}

export async function loadPreparationChecks() {
  try {
    const value = await readJson(PREPARATION_CHECKS_KEY);
    return sanitizeCheckMap(value);
  } catch {
    return {};
  }
}

export async function savePreparationChecks(checks: Record<string, string[]>) {
  try {
    await Storage.setItem(PREPARATION_CHECKS_KEY, JSON.stringify(checks));
    return true;
  } catch {
    return false;
  }
}
