// Open-Meteo 예보와 대기질을 활동별 출발 판단, 추천 시간, 준비 정보로 변환한다.
import { ACTIVITIES, type ActivityKey, type ActivityProfile } from "./activities";

export type ForecastMetrics = {
  temperature: number;
  apparentTemperature: number;
  precipitation: number;
  precipitationProbability: number | null;
  windSpeed: number;
  windGust?: number | null;
  visibility?: number | null;
  uvIndex: number;
  relativeHumidity: number | null;
  pm25: number | null;
  pm10: number | null;
  weatherCode?: number | null;
  snowfall?: number | null;
  isDay?: boolean | null;
};

export type ForecastSlot = ForecastMetrics & {
  time: string;
  sunrise?: string | null;
  sunset?: string | null;
  score: number;
  judgment: string;
  detail: string;
};

export type ForecastSnapshot = {
  schemaVersion: 2;
  activity: ActivityKey;
  locationName: string;
  generatedAt: string;
  timezone: string;
  forecastTime: string;
  score: number;
  judgment: string;
  detail: string;
  bestTime: string;
  bestEndTime: string;
  bestScore: number;
  sunrise?: string | null;
  sunset?: string | null;
  metrics: ForecastMetrics;
  slots: ForecastSlot[];
};

export type RankedForecastWindow = {
  start: string;
  secondHour: string;
  end: string;
  score: number;
  recommended: boolean;
  apparentTemperature: number;
  precipitationProbability: number;
};

export type ForecastApiResponse = {
  timezone?: string;
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    apparent_temperature?: (number | null)[];
    precipitation?: (number | null)[];
    precipitation_probability?: (number | null)[];
    wind_speed_10m?: (number | null)[];
    wind_gusts_10m?: (number | null)[];
    visibility?: (number | null)[];
    uv_index?: (number | null)[];
    relative_humidity_2m?: (number | null)[];
    weather_code?: (number | null)[];
    snowfall?: (number | null)[];
    is_day?: (number | null)[];
  };
  daily?: {
    time?: string[];
    sunrise?: (string | null)[];
    sunset?: (string | null)[];
  };
};

export type AirQualityApiResponse = {
  timezone?: string;
  hourly?: {
    time?: string[];
    pm2_5?: (number | null)[];
    pm10?: (number | null)[];
  };
};

export type AirQualityCoverage = "complete" | "partial" | "missing";
export type ForecastAvailability = "active" | "current-missing" | "expired";

type ScoreResult = Pick<ForecastSlot, "score" | "judgment" | "detail">;

const DEFAULT_FORECAST_API = "https://api.open-meteo.com/v1/forecast";
const DEFAULT_AIR_QUALITY_API = "https://air-quality-api.open-meteo.com/v1/air-quality";
const RECOMMENDATION_MIN_EACH = 55;
const RECOMMENDATION_MIN_AVERAGE = 62;
const FREEZING_PRECIPITATION_CODES = new Set([56, 57, 66, 67]);
const FOG_CODES = new Set([45, 48]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const SEVERE_RAIN_CODES = new Set([65, 82]);

function hasWeatherCode(metrics: ForecastMetrics, codes: Set<number>) {
  return metrics.weatherCode !== null
    && metrics.weatherCode !== undefined
    && codes.has(metrics.weatherCode);
}

function hasSnowRisk(metrics: ForecastMetrics) {
  return (metrics.snowfall ?? 0) > 0 || hasWeatherCode(metrics, SNOW_CODES);
}

function hasVisibilityBelow(metrics: ForecastMetrics, metres: number) {
  return metrics.visibility !== null
    && metrics.visibility !== undefined
    && metrics.visibility < metres;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function linearScore(value: number, points: [number, number][]) {
  if (value <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const [rightX, rightY] = points[index];
    const [leftX, leftY] = points[index - 1];
    if (value <= rightX) {
      const ratio = (value - leftX) / (rightX - leftX);
      return leftY + ratio * (rightY - leftY);
    }
  }
  return points[points.length - 1][1];
}

function scoreTemperature(apparentTemperature: number, profile: ActivityProfile) {
  const curve = profile.temperature;
  if (apparentTemperature >= curve.optimalLow && apparentTemperature <= curve.optimalHigh) return 100;
  return clamp(
    apparentTemperature < curve.optimalLow
      ? 100 - (curve.optimalLow - apparentTemperature) * curve.coldSlope
      : 100 - (apparentTemperature - curve.optimalHigh) * curve.hotSlope
  );
}

function scorePrecipitation(amount: number, probability: number | null) {
  const amountScore = linearScore(amount, [[0, 100], [0.2, 86], [1, 52], [3, 22], [6, 0]]);
  if (probability === null) return clamp(amountScore);
  const probabilityScore = linearScore(probability, [[0, 100], [30, 90], [50, 68], [70, 42], [90, 12], [100, 0]]);
  return clamp(amountScore * 0.6 + probabilityScore * 0.4);
}

function scoreWind(speed: number) {
  return clamp(linearScore(speed, [[0, 100], [2, 100], [4, 88], [6, 72], [9, 50], [12, 28], [15, 8], [18, 0]]));
}

function scoreUv(uvIndex: number) {
  return clamp(linearScore(uvIndex, [[0, 100], [2, 100], [5, 82], [7, 54], [10, 20], [12, 0]]));
}

function scoreHumidity(humidity: number | null) {
  if (humidity === null) return null;
  if (humidity >= 40 && humidity <= 60) return 100;
  return clamp(humidity < 40 ? 100 - (40 - humidity) * 2.5 : 100 - (humidity - 60) * 3);
}

function scoreDust(pm25: number | null, pm10: number | null) {
  const pm25Score = pm25 === null ? null : linearScore(pm25, [[0, 100], [15, 100], [35, 78], [55, 48], [75, 22], [100, 0]]);
  const pm10Score = pm10 === null ? null : linearScore(pm10, [[0, 100], [30, 100], [80, 76], [150, 36], [250, 0]]);
  if (pm25Score === null && pm10Score === null) return null;
  if (pm25Score === null) return clamp(pm10Score as number);
  if (pm10Score === null) return clamp(pm25Score);
  return clamp(pm25Score * 0.65 + pm10Score * 0.35);
}

function displayedAirValue(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10;
}

function isBadAir(metrics: ForecastMetrics) {
  const pm25 = displayedAirValue(metrics.pm25);
  const pm10 = displayedAirValue(metrics.pm10);
  return (pm25 !== null && pm25 > 35)
    || (pm10 !== null && pm10 > 80);
}

function isVeryBadAir(metrics: ForecastMetrics) {
  const pm25 = displayedAirValue(metrics.pm25);
  const pm10 = displayedAirValue(metrics.pm10);
  return (pm25 !== null && pm25 > 75)
    || (pm10 !== null && pm10 > 150);
}

function judgmentFor(score: number, activity: ActivityKey) {
  const label = ACTIVITIES[activity].shortLabel;
  if (score >= 80) return `${label} 지금 좋아요`;
  if (score >= 65) return `${label} 무난하게 좋아요`;
  if (score >= 45) return `${label} 짧게 준비해서 다녀오세요`;
  return `${label} 지금은 미루는 편이 좋아요`;
}

function detailFor(metrics: ForecastMetrics, activity: ActivityKey) {
  if ((metrics.weatherCode ?? 0) >= 95) {
    return "낙뢰 가능성이 있어요. 야외활동을 미루고 실내로 이동하세요.";
  }
  if (hasWeatherCode(metrics, FREEZING_PRECIPITATION_CODES)) {
    return "어는 비나 이슬비로 노면이 얼 수 있어요. 야외활동을 미루고 결빙 정보를 다시 확인하세요.";
  }
  if ((metrics.windGust ?? 0) >= 14) {
    return "순간 돌풍이 강해요. 낙하물과 균형 상실 위험이 있어 야외활동을 미루는 편이 좋아요.";
  }
  if (hasVisibilityBelow(metrics, 200)) {
    return "짙은 안개로 바로 앞 시야도 제한될 수 있어요. 이동을 미루고 가시거리를 다시 확인하세요.";
  }
  if ((activity === "hike" || activity === "bike") && (hasWeatherCode(metrics, FOG_CODES) || hasVisibilityBelow(metrics, 1_000))) {
    return "가시거리 1km 미만의 안개로 길 찾기가 어려울 수 있어요. 등산·자전거는 미루는 편이 좋아요.";
  }
  if ((activity === "hike" || activity === "bike") && hasWeatherCode(metrics, SEVERE_RAIN_CODES)) {
    return "강한 비나 소나기로 노면과 시야가 위험할 수 있어요. 등산·자전거는 미루는 편이 좋아요.";
  }
  if (hasSnowRisk(metrics)) {
    return "눈과 결빙 가능성이 있어요. 미끄러운 노면에 대비하고 경로를 다시 확인하세요.";
  }
  if (isVeryBadAir(metrics)) {
    return "시간대 미세먼지 수치가 매우 높아요. 야외활동을 미루고 공기 상태를 다시 확인하세요.";
  }
  if (isBadAir(metrics)) {
    return "야외봄 시간대 기준 미세먼지 수치가 높아요. 2시간 활동은 미루고 짧고 낮은 강도로 조정하세요.";
  }
  if (metrics.precipitation >= 1 || (metrics.precipitationProbability ?? 0) >= 70) {
    return "비 가능성이 높아요. 미끄러운 노면과 젖은 장비에 대비하세요.";
  }
  const hotThreshold = activity === "dog" ? 28 : activity === "run" ? 30 : 32;
  if (metrics.apparentTemperature >= hotThreshold) {
    return activity === "dog"
      ? "노면 열기와 강아지 호흡을 확인하고, 물과 그늘 휴식을 챙기세요."
      : "체감온도가 높아요. 물과 그늘 휴식을 챙기고 강도를 낮추세요.";
  }
  if (metrics.apparentTemperature <= 0) return "체감온도가 낮아요. 보온과 노면 상태를 확인하세요.";
  if (metrics.windSpeed >= ACTIVITIES[activity].windCap.speed) return "바람이 강해요. 방풍 준비와 이동 경로를 다시 확인하세요.";
  if (metrics.uvIndex >= 8) return "자외선이 매우 강해요. 한낮 활동을 줄이고 그늘·긴 옷·모자·선글라스·차단제를 준비하세요.";
  if (metrics.uvIndex >= 3) return "자외선 차단이 필요한 수준이에요. 그늘·긴 옷·모자·선글라스·차단제를 준비하세요.";
  if ((metrics.relativeHumidity ?? 0) >= 80) return "습도가 높아요. 속도를 낮추고 수분을 자주 보충하세요.";
  return "체감온도·비·바람·자외선·대기질 기준으로 큰 부담이 적어요.";
}

export function scoreActivityConditions(metrics: ForecastMetrics, activity: ActivityKey): ScoreResult {
  const profile = ACTIVITIES[activity];
  const factors = [
    { value: scoreDust(metrics.pm25, metrics.pm10), weight: profile.weights.dust },
    { value: scoreTemperature(metrics.apparentTemperature, profile), weight: profile.weights.temperature },
    { value: scorePrecipitation(metrics.precipitation, metrics.precipitationProbability), weight: profile.weights.precipitation },
    { value: scoreUv(metrics.uvIndex), weight: profile.weights.uv },
    { value: scoreHumidity(metrics.relativeHumidity), weight: profile.weights.humidity },
    { value: scoreWind(metrics.windSpeed), weight: profile.weights.wind }
  ].filter((factor): factor is { value: number; weight: number } => factor.value !== null);
  const weightTotal = factors.reduce((total, factor) => total + factor.weight, 0);
  let score = clamp(factors.reduce((total, factor) => total + factor.value * factor.weight, 0) / weightTotal);

  if (metrics.precipitation >= 4) score = Math.min(score, 25);
  else if (metrics.precipitation >= 1) score = Math.min(score, 45);
  else if ((metrics.precipitationProbability ?? 0) >= 80) score = Math.min(score, 60);

  if (metrics.apparentTemperature >= profile.heatCaps.dangerAt) score = Math.min(score, profile.heatCaps.dangerCap);
  else if (metrics.apparentTemperature >= profile.heatCaps.cautionAt) score = Math.min(score, profile.heatCaps.cautionCap);
  if (metrics.apparentTemperature <= -10) score = Math.min(score, 35);
  else if (metrics.apparentTemperature <= -5) score = Math.min(score, 55);
  if (isVeryBadAir(metrics)) score = Math.min(score, 30);
  else if (isBadAir(metrics)) score = Math.min(score, 60);
  if (metrics.windSpeed >= profile.windCap.speed) score = Math.min(score, profile.windCap.score);
  if ((metrics.windGust ?? 0) >= 14) score = Math.min(score, 30);
  if (hasVisibilityBelow(metrics, 200)) score = Math.min(score, 40);
  else if ((activity === "hike" || activity === "bike") && hasVisibilityBelow(metrics, 1_000)) score = Math.min(score, 40);
  if ((metrics.weatherCode ?? 0) >= 95) score = Math.min(score, 15);
  if (hasWeatherCode(metrics, FREEZING_PRECIPITATION_CODES)) score = Math.min(score, 15);
  if (activity === "bike" && (metrics.precipitation >= 0.5 || (metrics.precipitationProbability ?? 0) >= 70)) {
    score = Math.min(score, 35);
  }
  if ((activity === "hike" || activity === "bike") && hasSnowRisk(metrics)) score = Math.min(score, 30);
  if ((activity === "hike" || activity === "bike") && hasWeatherCode(metrics, FOG_CODES)) score = Math.min(score, 40);
  if ((activity === "hike" || activity === "bike") && hasWeatherCode(metrics, SEVERE_RAIN_CODES)) score = Math.min(score, 25);
  if (metrics.uvIndex >= 11) score = Math.min(score, 50);

  return { score, judgment: judgmentFor(score, activity), detail: detailFor(metrics, activity) };
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hourKey(now: Date, timezone: string | undefined) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone && timezone !== "auto" ? timezone : "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}`;
  } catch {
    return now.toISOString().slice(0, 13);
  }
}

function buildAirQualityMap(response: AirQualityApiResponse | null) {
  const result = new Map<string, { pm25: number | null; pm10: number | null }>();
  const times = response?.hourly?.time ?? [];
  times.forEach((time, index) => {
    result.set(time, {
      pm25: finiteNumber(response?.hourly?.pm2_5?.[index]),
      pm10: finiteNumber(response?.hourly?.pm10?.[index])
    });
  });
  return result;
}

function buildSunTimesMap(response: ForecastApiResponse) {
  const result = new Map<string, { sunrise: string | null; sunset: string | null }>();
  const dates = response.daily?.time ?? [];
  dates.forEach((date, index) => {
    result.set(date, {
      sunrise: response.daily?.sunrise?.[index] ?? null,
      sunset: response.daily?.sunset?.[index] ?? null
    });
  });
  return result;
}

function readSlot(
  response: ForecastApiResponse,
  airQuality: Map<string, { pm25: number | null; pm10: number | null }>,
  sunTimes: Map<string, { sunrise: string | null; sunset: string | null }>,
  activity: ActivityKey,
  index: number
): ForecastSlot | null {
  const hourly = response.hourly;
  const time = hourly?.time?.[index];
  const temperature = finiteNumber(hourly?.temperature_2m?.[index]);
  const apparentTemperature = finiteNumber(hourly?.apparent_temperature?.[index]);
  const precipitation = finiteNumber(hourly?.precipitation?.[index]);
  const windSpeed = finiteNumber(hourly?.wind_speed_10m?.[index]);
  const uvIndex = finiteNumber(hourly?.uv_index?.[index]);
  if (!time || temperature === null || apparentTemperature === null || precipitation === null || windSpeed === null || uvIndex === null) {
    return null;
  }
  const air = airQuality.get(time);
  const metrics: ForecastMetrics = {
    temperature,
    apparentTemperature,
    precipitation,
    precipitationProbability: finiteNumber(hourly?.precipitation_probability?.[index]),
    windSpeed,
    windGust: finiteNumber(hourly?.wind_gusts_10m?.[index]),
    visibility: finiteNumber(hourly?.visibility?.[index]),
    uvIndex,
    relativeHumidity: finiteNumber(hourly?.relative_humidity_2m?.[index]),
    pm25: air?.pm25 ?? null,
    pm10: air?.pm10 ?? null,
    weatherCode: finiteNumber(hourly?.weather_code?.[index]),
    snowfall: finiteNumber(hourly?.snowfall?.[index]),
    isDay: finiteNumber(hourly?.is_day?.[index]) === null ? null : hourly?.is_day?.[index] === 1
  };
  const daylight = sunTimes.get(time.slice(0, 10));
  return {
    time,
    sunrise: daylight?.sunrise ?? null,
    sunset: daylight?.sunset ?? null,
    ...metrics,
    ...scoreActivityConditions(metrics, activity)
  };
}

function shiftLocalMinutes(value: string, minutes: number) {
  const date = new Date(`${value.slice(0, 16)}:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString().slice(0, 16);
}

function shiftLocalHour(value: string, hours: number) {
  return shiftLocalMinutes(value, hours * 60);
}

function areConsecutiveHours(current: string, next: string) {
  return shiftLocalHour(current, 1) === next.slice(0, 16);
}

export function isUnsafeOutdoorSlot(slot: ForecastMetrics, activity: ActivityKey) {
  if ((slot.weatherCode ?? 0) >= 95) return true;
  if (hasWeatherCode(slot, FREEZING_PRECIPITATION_CODES)) return true;
  if ((slot.windGust ?? 0) >= 14) return true;
  if (hasVisibilityBelow(slot, 200)) return true;
  if (slot.apparentTemperature >= 38) return true;
  if (isBadAir(slot)) return true;
  if (activity === "bike" && (slot.precipitation >= 0.5 || (slot.precipitationProbability ?? 0) >= 70)) return true;
  if ((activity === "hike" || activity === "bike") && hasSnowRisk(slot)) return true;
  if ((activity === "hike" || activity === "bike") && hasWeatherCode(slot, FOG_CODES)) return true;
  if ((activity === "hike" || activity === "bike") && hasVisibilityBelow(slot, 1_000)) return true;
  if ((activity === "hike" || activity === "bike") && hasWeatherCode(slot, SEVERE_RAIN_CODES)) return true;
  if (activity === "hike" && slot.isDay === false) return true;
  return false;
}

function hasCompleteAirQuality(slot: ForecastMetrics) {
  return slot.pm25 !== null && slot.pm10 !== null;
}

function hasCompleteSafetySignals(slot: ForecastSlot, activity: ActivityKey) {
  return slot.windGust !== null
    && slot.windGust !== undefined
    && slot.visibility !== null
    && slot.visibility !== undefined
    && slot.weatherCode !== null
    && slot.weatherCode !== undefined
    && slot.snowfall !== null
    && slot.snowfall !== undefined
    && slot.isDay !== null
    && slot.isDay !== undefined
    && (activity !== "hike" || Boolean(slot.sunset));
}

export function getAirQualityCoverage(snapshot: ForecastSnapshot): AirQualityCoverage {
  const slots = snapshot.slots.slice(0, 12);
  if (slots.every((slot) => slot.pm25 === null && slot.pm10 === null)) return "missing";
  if (slots.every(hasCompleteAirQuality)) return "complete";
  return "partial";
}

export function hasIncompleteSafetyData(snapshot: ForecastSnapshot) {
  return snapshot.slots.slice(0, 12).some((slot) => !hasCompleteSafetySignals(slot, snapshot.activity));
}

export function hasIncompleteCurrentSafetyData(snapshot: ForecastSnapshot) {
  const current = snapshot.slots[0];
  return !current || !hasCompleteAirQuality(current) || !hasCompleteSafetySignals(current, snapshot.activity);
}

function isRecommendedWindow(slot: ForecastSlot, next: ForecastSlot, activity: ActivityKey) {
  const startHour = Number(slot.time.slice(11, 13));
  const earliestHour = activity === "hike" ? 4 : 6;
  const latestHour = activity === "hike" ? 18 : 22;
  const average = (slot.score + next.score) / 2;
  const rainy = slot.precipitation >= 0.2
    || next.precipitation >= 0.2
    || (slot.precipitationProbability ?? 0) >= 60
    || (next.precipitationProbability ?? 0) >= 60;
  const windowEnd = shiftLocalHour(next.time, 1);
  const hikeSunsetCutoff = activity === "hike" && slot.sunset
    ? windowEnd <= shiftLocalMinutes(slot.sunset, -60)
    : true;
  return Number.isFinite(startHour)
    && areConsecutiveHours(slot.time, next.time)
    && startHour >= earliestHour
    && startHour <= latestHour
    && hikeSunsetCutoff
    && !rainy
    && hasCompleteAirQuality(slot)
    && hasCompleteAirQuality(next)
    && hasCompleteSafetySignals(slot, activity)
    && hasCompleteSafetySignals(next, activity)
    && !isUnsafeOutdoorSlot(slot, activity)
    && !isUnsafeOutdoorSlot(next, activity)
    && slot.score >= RECOMMENDATION_MIN_EACH
    && next.score >= RECOMMENDATION_MIN_EACH
    && average >= RECOMMENDATION_MIN_AVERAGE;
}

function bestWindow(slots: ForecastSlot[], activity: ActivityKey) {
  if (slots.length === 1) {
    return {
      start: slots[0].time,
      end: shiftLocalHour(slots[0].time, 1),
      score: slots[0].score,
      recommended: false
    };
  }
  const windows = slots.slice(0, -1).map((slot, index) => {
    const next = slots[index + 1];
    const score = (slot.score + next.score) / 2;
    const recommended = isRecommendedWindow(slot, next, activity);
    return { index, score, recommended, consecutive: areConsecutiveHours(slot.time, next.time) };
  }).filter((window) => window.consecutive);
  if (windows.length === 0) {
    return {
      start: slots[0].time,
      end: shiftLocalHour(slots[0].time, 1),
      score: slots[0].score,
      recommended: false
    };
  }
  const recommended = windows.filter((window) => window.recommended);
  const pool = recommended.length > 0 ? recommended : windows;
  const best = pool.reduce((current, candidate) => candidate.score > current.score ? candidate : current);
  return {
    start: slots[best.index].time,
    end: shiftLocalHour(slots[best.index + 1].time, 1),
    score: clamp(best.score),
    recommended: best.recommended
  };
}

export function getRankedForecastWindows(snapshot: ForecastSnapshot, date?: string): RankedForecastWindow[] {
  const slots = date ? snapshot.slots.filter((slot) => slot.time.slice(0, 10) === date) : snapshot.slots;
  return slots.slice(0, -1).map((slot, index) => {
    const next = slots[index + 1];
    return {
      start: slot.time,
      secondHour: next.time,
      end: shiftLocalHour(next.time, 1),
      score: clamp((slot.score + next.score) / 2),
      recommended: isRecommendedWindow(slot, next, snapshot.activity),
      apparentTemperature: (slot.apparentTemperature + next.apparentTemperature) / 2,
      precipitationProbability: Math.max(slot.precipitationProbability ?? 0, next.precipitationProbability ?? 0),
      consecutive: areConsecutiveHours(slot.time, next.time)
    };
  })
    .filter((window) => window.consecutive)
    .sort((left, right) => Number(right.recommended) - Number(left.recommended) || right.score - left.score)
    .map(({ consecutive: _consecutive, ...window }) => window);
}

function assembleSnapshot(options: {
  activity: ActivityKey;
  locationName: string;
  generatedAt: string;
  timezone: string;
  slots: ForecastSlot[];
}): ForecastSnapshot {
  if (options.slots.length === 0) throw new Error("사용 가능한 예보가 없습니다.");
  const current = options.slots[0];
  const best = bestWindow(options.slots, options.activity);
  return {
    schemaVersion: 2,
    activity: options.activity,
    locationName: options.locationName,
    generatedAt: options.generatedAt,
    timezone: options.timezone,
    forecastTime: current.time,
    score: current.score,
    judgment: current.judgment,
    detail: current.detail,
    bestTime: best.start,
    bestEndTime: best.end,
    bestScore: best.score,
    sunrise: current.sunrise ?? null,
    sunset: current.sunset ?? null,
    metrics: {
      temperature: current.temperature,
      apparentTemperature: current.apparentTemperature,
      precipitation: current.precipitation,
      precipitationProbability: current.precipitationProbability,
      windSpeed: current.windSpeed,
      windGust: current.windGust ?? null,
      visibility: current.visibility ?? null,
      uvIndex: current.uvIndex,
      relativeHumidity: current.relativeHumidity,
      pm25: current.pm25,
      pm10: current.pm10,
      weatherCode: current.weatherCode ?? null,
      snowfall: current.snowfall ?? null,
      isDay: current.isDay ?? null
    },
    slots: options.slots
  };
}

export function buildForecastSnapshot(
  response: ForecastApiResponse,
  airQualityResponse: AirQualityApiResponse | null,
  activity: ActivityKey,
  locationName: string,
  now = new Date()
): ForecastSnapshot {
  const times = response.hourly?.time ?? [];
  if (times.length === 0) throw new Error("시간별 예보가 없습니다.");
  const currentHour = hourKey(now, response.timezone);
  const startIndex = times.findIndex((time) => time.slice(0, 13) >= currentHour);
  if (startIndex < 0) throw new Error("현재 이후 예보가 없습니다.");
  const airQuality = buildAirQualityMap(airQualityResponse);
  const sunTimes = buildSunTimesMap(response);
  if (times[startIndex].slice(0, 13) !== currentHour) throw new Error("현재 시각 예보가 없습니다.");
  const currentSlot = readSlot(response, airQuality, sunTimes, activity, startIndex);
  if (!currentSlot) throw new Error("현재 시각 예보의 핵심 정보가 누락됐습니다.");
  const futureSlots = times
    .slice(startIndex + 1, startIndex + 13)
    .map((_, offset) => readSlot(response, airQuality, sunTimes, activity, startIndex + 1 + offset))
    .filter((slot): slot is ForecastSlot => slot !== null);
  const slots = [currentSlot, ...futureSlots];
  return assembleSnapshot({
    activity,
    locationName,
    generatedAt: now.toISOString(),
    timezone: response.timezone ?? "UTC",
    slots
  });
}

export function rescoreForecastSnapshot(snapshot: ForecastSnapshot, activity: ActivityKey) {
  const slots = snapshot.slots.map((slot) => ({
    ...slot,
    ...scoreActivityConditions(slot, activity)
  }));
  return assembleSnapshot({
    activity,
    locationName: snapshot.locationName,
    generatedAt: snapshot.generatedAt,
    timezone: snapshot.timezone,
    slots
  });
}

export function getForecastAvailability(snapshot: ForecastSnapshot, now = new Date()): ForecastAvailability {
  const currentHour = hourKey(now, snapshot.timezone);
  if (snapshot.slots.some((slot) => slot.time.slice(0, 13) === currentHour)) return "active";
  if (snapshot.slots.some((slot) => slot.time.slice(0, 13) > currentHour)) return "current-missing";
  return "expired";
}

export function getCurrentForecastSnapshot(snapshot: ForecastSnapshot, now = new Date()) {
  if (getForecastAvailability(snapshot, now) !== "active") return null;
  const currentHour = hourKey(now, snapshot.timezone);
  const slots = snapshot.slots.filter((slot) => slot.time.slice(0, 13) >= currentHour);
  return assembleSnapshot({
    activity: snapshot.activity,
    locationName: snapshot.locationName,
    generatedAt: snapshot.generatedAt,
    timezone: snapshot.timezone,
    slots
  });
}

export function buildPreparationTips(snapshot: ForecastSnapshot) {
  const startIndex = snapshot.slots.findIndex((slot) => slot.time === snapshot.bestTime);
  const recommendationSlots = startIndex >= 0 ? snapshot.slots.slice(startIndex, startIndex + 2) : [snapshot.slots[0]];
  const daylight = recommendationSlots.some((item) => item.isDay === false)
    ? false
    : recommendationSlots.some((item) => item.isDay === true)
      ? true
      : null;
  const metrics = recommendationSlots.reduce<ForecastMetrics>((result, slot) => ({
    temperature: slot.temperature > result.temperature ? slot.temperature : result.temperature,
    apparentTemperature: slot.apparentTemperature > result.apparentTemperature ? slot.apparentTemperature : result.apparentTemperature,
    precipitation: Math.max(result.precipitation, slot.precipitation),
    precipitationProbability: Math.max(result.precipitationProbability ?? 0, slot.precipitationProbability ?? 0),
    windSpeed: Math.max(result.windSpeed, slot.windSpeed),
    windGust: Math.max(result.windGust ?? 0, slot.windGust ?? 0),
    visibility: result.visibility === null || result.visibility === undefined
      ? slot.visibility ?? null
      : slot.visibility === null || slot.visibility === undefined
        ? result.visibility
        : Math.min(result.visibility, slot.visibility),
    uvIndex: Math.max(result.uvIndex, slot.uvIndex),
    relativeHumidity: Math.max(result.relativeHumidity ?? 0, slot.relativeHumidity ?? 0),
    pm25: Math.max(result.pm25 ?? 0, slot.pm25 ?? 0),
    pm10: Math.max(result.pm10 ?? 0, slot.pm10 ?? 0),
    weatherCode: Math.max(result.weatherCode ?? 0, slot.weatherCode ?? 0),
    snowfall: Math.max(result.snowfall ?? 0, slot.snowfall ?? 0),
    isDay: daylight
  }), recommendationSlots[0]);
  const minimumApparentTemperature = Math.min(...recommendationSlots.map((slot) => slot.apparentTemperature));
  const hasThunder = recommendationSlots.some((slot) => (slot.weatherCode ?? 0) >= 95);
  const hasFreezingPrecipitation = recommendationSlots.some((slot) => hasWeatherCode(slot, FREEZING_PRECIPITATION_CODES));
  const hasFog = recommendationSlots.some((slot) => hasWeatherCode(slot, FOG_CODES));
  const hasSnow = recommendationSlots.some(hasSnowRisk);
  const hasSevereRain = recommendationSlots.some((slot) => hasWeatherCode(slot, SEVERE_RAIN_CODES));
  const recommendationSunset = recommendationSlots.find((slot) => slot.sunset)?.sunset ?? null;
  const recommendationDate = recommendationSlots[0]?.time.slice(0, 10) ?? snapshot.forecastTime.slice(0, 10);
  const datePrefix = recommendationDate === snapshot.forecastTime.slice(0, 10)
    ? ""
    : `${Number(recommendationDate.slice(5, 7))}/${Number(recommendationDate.slice(8, 10))} `;
  const priorityTips: string[] = [];
  const optionalTips: string[] = [];
  if (hasThunder) priorityTips.push("낙뢰가 예상되면 출발하지 말고 실내에서 기다리세요.");
  if (hasFreezingPrecipitation) priorityTips.push("어는 비나 이슬비가 예상돼요. 결빙 노면을 피하고 출발을 미루세요.");
  if ((metrics.windGust ?? 0) >= 14) priorityTips.push("강한 돌풍이 예상돼요. 나무·간판 주변을 피하고 출발을 다시 판단하세요.");
  else if ((metrics.windGust ?? 0) >= 10) optionalTips.push("돌풍에 대비해 나무·간판 주변을 피하고 헐거운 장비를 고정하세요.");
  if (hasVisibilityBelow(metrics, 200)) priorityTips.push("가시거리가 200m 미만으로 짧아요. 이동을 미루고 안개가 걷힌 뒤 다시 확인하세요.");
  else if ((snapshot.activity === "hike" || snapshot.activity === "bike") && (hasVisibilityBelow(metrics, 1_000) || hasFog)) priorityTips.push("안개로 가시거리가 짧아요. 등산·자전거 출발을 미루고 경로를 다시 확인하세요.");
  if (hasSnow) priorityTips.push("눈과 결빙 가능성이 있어요. 미끄럼 방지 장비와 우회 경로를 준비하세요.");
  if ((snapshot.activity === "hike" || snapshot.activity === "bike") && hasSevereRain) priorityTips.push("강한 비나 소나기가 예상돼요. 등산·자전거 출발을 미루세요.");
  if (metrics.isDay === false) priorityTips.push("야간 활동에는 밝은 조명과 반사 소품을 반드시 챙기세요.");
  if (isVeryBadAir(metrics)) priorityTips.push("시간대 미세먼지 수치가 매우 높아요. 야외활동을 미루고 공기 상태가 나아진 뒤 다시 확인하세요.");
  else if (isBadAir(metrics)) priorityTips.push("시간대 미세먼지 수치가 높아요. 2시간 활동은 미루고 더 짧고 낮은 강도로 조정하세요.");
  if (metrics.apparentTemperature >= 38) priorityTips.push("체감온도가 위험하게 높아요. 야외활동을 미루고 시원한 곳에서 수분을 보충하세요.");
  if (metrics.precipitation >= 0.3 || (metrics.precipitationProbability ?? 0) >= 60) {
    optionalTips.push("방수 겉옷이나 우산을 챙기고 미끄러운 노면을 피하세요.");
  }
  if ((metrics.apparentTemperature >= 26 && metrics.apparentTemperature < 38) || (metrics.relativeHumidity ?? 0) >= 80) {
    optionalTips.push("물 한 병을 챙기고 그늘에서 쉬는 간격을 미리 정하세요.");
  }
  if (minimumApparentTemperature <= 0) optionalTips.push("체감온도가 낮아요. 보온 겉옷과 미끄러운 노면 대비를 챙기세요.");
  if (metrics.uvIndex >= 3) optionalTips.push("그늘을 우선하고 긴 옷·모자·선글라스·자외선 차단제를 챙기세요.");
  if (metrics.windSpeed >= 8) optionalTips.push("바람을 막는 얇은 겉옷과 안전한 경로를 준비하세요.");

  const activityTip: Record<ActivityKey, string> = {
    walk: "쿠션 좋은 신발을 신고 휴대폰 배터리를 확인하세요.",
    dog: "리드줄 연결부와 노면 온도를 확인하고 강아지 물을 챙기세요.",
    run: "러닝화 끈을 확인하고 출발 전 5분간 천천히 몸을 푸세요.",
    hike: recommendationSunset
      ? `${datePrefix}일몰 ${recommendationSunset.slice(11, 16)}보다 1–2시간 일찍 하산하고 헤드랜턴·보조배터리를 챙기세요.`
      : "하산 시간과 경로를 공유하고 헤드랜턴·보조배터리를 챙기세요.",
    bike: "헬멧을 쓰고 브레이크·타이어 공기압을 출발 전에 확인하세요."
  };
  const required = [...new Set(priorityTips)];
  const optional = [...new Set(optionalTips)].filter((tip) => !required.includes(tip));
  const riskTips = [...required, ...optional.slice(0, Math.max(0, 2 - required.length))];
  return [...new Set([...riskTips, activityTip[snapshot.activity]])];
}

export function getRecommendationState(snapshot: ForecastSnapshot) {
  const index = snapshot.slots.findIndex((slot) => slot.time === snapshot.bestTime);
  if (index < 0) return "limited" as const;
  const slots = snapshot.slots.slice(index, index + 2);
  return slots.length === 2 && isRecommendedWindow(slots[0], slots[1], snapshot.activity)
    ? "recommended" as const
    : "limited" as const;
}

export function getForecastFreshness(snapshot: ForecastSnapshot, now = new Date()) {
  const generatedAt = new Date(snapshot.generatedAt).getTime();
  const age = now.getTime() - generatedAt;
  const currentHour = hourKey(now, snapshot.timezone);
  const hasFutureSlot = snapshot.slots.some((slot) => slot.time.slice(0, 13) >= currentHour);
  const sameForecastDate = snapshot.forecastTime.slice(0, 10) === currentHour.slice(0, 10);
  if (!Number.isFinite(generatedAt) || age < -5 * 60 * 1000 || !hasFutureSlot || !sameForecastDate || age > 6 * 60 * 60 * 1000) {
    return { state: "stale" as const, label: "오래된 저장 예보", ageHours: null };
  }
  const ageHours = Math.max(0, age / (60 * 60 * 1000));
  if (ageHours > 3) return { state: "aging" as const, label: `${Math.floor(ageHours)}시간 전 저장`, ageHours };
  if (ageHours >= 1) return { state: "fresh" as const, label: `${Math.floor(ageHours)}시간 전 저장`, ageHours };
  return { state: "fresh" as const, label: "최근 저장", ageHours };
}

async function fetchJson<T>(url: URL, signal: AbortSignal) {
  const response = await fetch(url.toString(), {
    signal,
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`API 요청 실패 ${response.status}`);
  return await response.json() as T;
}

async function fetchJsonWithTimeout<T>(url: URL, milliseconds: number) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), milliseconds);
  try {
    return await fetchJson<T>(url, controller.signal);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function fetchForecastSnapshot(options: {
  latitude: number;
  longitude: number;
  locationName: string;
  activity: ActivityKey;
}) {
  const forecastEndpoint = process.env.EXPO_PUBLIC_FORECAST_API_URL?.trim() || DEFAULT_FORECAST_API;
  const airQualityEndpoint = process.env.EXPO_PUBLIC_AIR_QUALITY_API_URL?.trim() || DEFAULT_AIR_QUALITY_API;
  const forecastUrl = new URL(forecastEndpoint);
  const airQualityUrl = new URL(airQualityEndpoint);
  for (const url of [forecastUrl, airQualityUrl]) {
    url.searchParams.set("latitude", String(options.latitude));
    url.searchParams.set("longitude", String(options.longitude));
    url.searchParams.set("forecast_hours", "18");
    url.searchParams.set("timezone", "auto");
  }
  forecastUrl.searchParams.set(
    "hourly",
    "temperature_2m,apparent_temperature,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,visibility,uv_index,relative_humidity_2m,weather_code,snowfall,is_day"
  );
  forecastUrl.searchParams.set("daily", "sunrise,sunset");
  forecastUrl.searchParams.set("wind_speed_unit", "ms");
  airQualityUrl.searchParams.set("hourly", "pm2_5,pm10");

  const [forecastResult, airQualityResult] = await Promise.allSettled([
    fetchJsonWithTimeout<ForecastApiResponse>(forecastUrl, 10_000),
    fetchJsonWithTimeout<AirQualityApiResponse>(airQualityUrl, 4_000)
  ]);
  if (forecastResult.status === "rejected") throw forecastResult.reason;
  const airQuality = airQualityResult.status === "fulfilled" ? airQualityResult.value : null;
  return buildForecastSnapshot(forecastResult.value, airQuality, options.activity, options.locationName);
}
