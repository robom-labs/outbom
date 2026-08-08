// Open-Meteo 예보와 대기질을 활동별 출발 판단, 추천 시간, 준비 정보로 변환한다.
import { ACTIVITIES, type ActivityKey, type ActivityProfile } from "./activities";

export type ForecastMetrics = {
  temperature: number;
  apparentTemperature: number;
  precipitation: number;
  precipitationProbability: number | null;
  windSpeed: number;
  uvIndex: number;
  relativeHumidity: number | null;
  pm25: number | null;
  pm10: number | null;
};

export type ForecastSlot = ForecastMetrics & {
  time: string;
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
  metrics: ForecastMetrics;
  slots: ForecastSlot[];
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
    uv_index?: (number | null)[];
    relative_humidity_2m?: (number | null)[];
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

type ScoreResult = Pick<ForecastSlot, "score" | "judgment" | "detail">;

const DEFAULT_FORECAST_API = "https://api.open-meteo.com/v1/forecast";
const DEFAULT_AIR_QUALITY_API = "https://air-quality-api.open-meteo.com/v1/air-quality";

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

function judgmentFor(score: number, activity: ActivityKey) {
  const label = ACTIVITIES[activity].shortLabel;
  if (score >= 80) return `${label} 지금 좋아요`;
  if (score >= 65) return `${label} 무난하게 좋아요`;
  if (score >= 45) return `${label} 짧게 준비해서 다녀오세요`;
  return `${label} 지금은 미루는 편이 좋아요`;
}

function detailFor(metrics: ForecastMetrics, activity: ActivityKey) {
  if ((metrics.pm25 ?? 0) > 75 || (metrics.pm10 ?? 0) > 150) {
    return "미세먼지가 나빠요. 야외활동 시간을 줄이고 공기 상태를 다시 확인하세요.";
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
  if (metrics.uvIndex >= 7) return "자외선이 강해요. 모자와 자외선 차단제를 챙기세요.";
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
  if ((metrics.pm25 ?? 0) > 75 || (metrics.pm10 ?? 0) > 150) score = Math.min(score, 30);
  if (metrics.windSpeed >= profile.windCap.speed) score = Math.min(score, profile.windCap.score);
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

function readSlot(
  response: ForecastApiResponse,
  airQuality: Map<string, { pm25: number | null; pm10: number | null }>,
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
    uvIndex,
    relativeHumidity: finiteNumber(hourly?.relative_humidity_2m?.[index]),
    pm25: air?.pm25 ?? null,
    pm10: air?.pm10 ?? null
  };
  return { time, ...metrics, ...scoreActivityConditions(metrics, activity) };
}

function shiftLocalHour(value: string, hours: number) {
  const date = new Date(`${value.slice(0, 13)}:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString().slice(0, 16);
}

function bestWindow(slots: ForecastSlot[]) {
  if (slots.length === 1) {
    return { start: slots[0].time, end: shiftLocalHour(slots[0].time, 1), score: slots[0].score };
  }
  let bestIndex = 0;
  let bestScore = (slots[0].score + slots[1].score) / 2;
  for (let index = 1; index < slots.length - 1; index += 1) {
    const score = (slots[index].score + slots[index + 1].score) / 2;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return {
    start: slots[bestIndex].time,
    end: shiftLocalHour(slots[bestIndex + 1].time, 1),
    score: clamp(bestScore)
  };
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
  const best = bestWindow(options.slots);
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
    metrics: {
      temperature: current.temperature,
      apparentTemperature: current.apparentTemperature,
      precipitation: current.precipitation,
      precipitationProbability: current.precipitationProbability,
      windSpeed: current.windSpeed,
      uvIndex: current.uvIndex,
      relativeHumidity: current.relativeHumidity,
      pm25: current.pm25,
      pm10: current.pm10
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
  const slots = times
    .slice(startIndex, startIndex + 13)
    .map((_, offset) => readSlot(response, airQuality, activity, startIndex + offset))
    .filter((slot): slot is ForecastSlot => slot !== null);
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

export function buildPreparationTips(snapshot: ForecastSnapshot) {
  const metrics = snapshot.metrics;
  const tips: string[] = [];
  if (metrics.precipitation >= 0.3 || (metrics.precipitationProbability ?? 0) >= 60) {
    tips.push("방수 겉옷이나 우산을 챙기고 미끄러운 노면을 피하세요.");
  }
  if ((metrics.pm25 ?? 0) > 35 || (metrics.pm10 ?? 0) > 80) {
    tips.push("대기질이 좋지 않으면 시간을 줄이고 큰길보다 안쪽 길을 선택하세요.");
  }
  if (metrics.apparentTemperature >= 26 || (metrics.relativeHumidity ?? 0) >= 80) {
    tips.push("물 한 병을 챙기고 그늘에서 쉬는 간격을 미리 정하세요.");
  }
  if (metrics.uvIndex >= 5) tips.push("모자와 자외선 차단제를 챙기세요.");
  if (metrics.windSpeed >= 8) tips.push("바람을 막는 얇은 겉옷과 안전한 경로를 준비하세요.");

  const activityTip: Record<ActivityKey, string> = {
    walk: "쿠션 좋은 신발을 신고 휴대폰 배터리를 확인하세요.",
    dog: "리드줄 연결부와 노면 온도를 확인하고 강아지 물을 챙기세요.",
    run: "러닝화 끈을 확인하고 출발 전 5분간 천천히 몸을 푸세요.",
    hike: "하산 시간과 경로를 공유하고 물·보조배터리를 챙기세요.",
    bike: "헬멧을 쓰고 브레이크·타이어 공기압을 출발 전에 확인하세요."
  };
  const riskTips = [...new Set(tips)].slice(0, 2);
  return [...new Set([...riskTips, activityTip[snapshot.activity]])];
}

async function fetchJson<T>(url: URL, signal: AbortSignal) {
  const response = await fetch(url.toString(), {
    signal,
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`API 요청 실패 ${response.status}`);
  return await response.json() as T;
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
    "temperature_2m,apparent_temperature,precipitation,precipitation_probability,wind_speed_10m,uv_index,relative_humidity_2m"
  );
  forecastUrl.searchParams.set("wind_speed_unit", "ms");
  airQualityUrl.searchParams.set("hourly", "pm2_5,pm10");

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 10_000);
  try {
    const [forecastResult, airQualityResult] = await Promise.allSettled([
      fetchJson<ForecastApiResponse>(forecastUrl, controller.signal),
      fetchJson<AirQualityApiResponse>(airQualityUrl, controller.signal)
    ]);
    if (forecastResult.status === "rejected") throw forecastResult.reason;
    const airQuality = airQualityResult.status === "fulfilled" ? airQualityResult.value : null;
    return buildForecastSnapshot(forecastResult.value, airQuality, options.activity, options.locationName);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
