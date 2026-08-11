// 야외봄 네이티브 앱의 활동별 점수 기준과 사용자 문구를 한곳에서 관리한다.
export type ActivityKey = "walk" | "dog" | "run" | "hike" | "bike";

export type ActivityProfile = {
  key: ActivityKey;
  label: string;
  shortLabel: string;
  weights: {
    dust: number;
    temperature: number;
    precipitation: number;
    uv: number;
    humidity: number;
    wind: number;
  };
  temperature: {
    optimalLow: number;
    optimalHigh: number;
    coldSlope: number;
    hotSlope: number;
  };
  heatCaps: {
    cautionAt: number;
    cautionCap: number;
    dangerAt: number;
    dangerCap: number;
  };
  windCap: {
    speed: number;
    score: number;
  };
};

export const ACTIVITY_ORDER: ActivityKey[] = ["walk", "dog", "run", "hike", "bike"];

export const ACTIVITIES: Record<ActivityKey, ActivityProfile> = {
  walk: {
    key: "walk",
    label: "걷기",
    shortLabel: "걷기",
    weights: { dust: 0.3, temperature: 0.2, precipitation: 0.16, uv: 0.16, humidity: 0.07, wind: 0.11 },
    temperature: { optimalLow: 10, optimalHigh: 22, coldSlope: 5, hotSlope: 4 },
    heatCaps: { cautionAt: 33, cautionCap: 60, dangerAt: 36, dangerCap: 40 },
    windCap: { speed: 14, score: 40 }
  },
  dog: {
    key: "dog",
    label: "애견산책",
    shortLabel: "산책",
    weights: { dust: 0.32, temperature: 0.2, precipitation: 0.16, uv: 0.16, humidity: 0.06, wind: 0.1 },
    temperature: { optimalLow: 8, optimalHigh: 20, coldSlope: 5, hotSlope: 4.6 },
    heatCaps: { cautionAt: 28, cautionCap: 55, dangerAt: 31, dangerCap: 35 },
    windCap: { speed: 14, score: 40 }
  },
  run: {
    key: "run",
    label: "러닝",
    shortLabel: "러닝",
    weights: { dust: 0.28, temperature: 0.22, precipitation: 0.16, uv: 0.12, humidity: 0.11, wind: 0.11 },
    temperature: { optimalLow: 8, optimalHigh: 16, coldSlope: 6, hotSlope: 5.2 },
    heatCaps: { cautionAt: 30, cautionCap: 55, dangerAt: 33, dangerCap: 35 },
    windCap: { speed: 14, score: 40 }
  },
  hike: {
    key: "hike",
    label: "등산",
    shortLabel: "등산",
    weights: { dust: 0.12, temperature: 0.18, precipitation: 0.28, uv: 0.1, humidity: 0.1, wind: 0.22 },
    temperature: { optimalLow: 6, optimalHigh: 18, coldSlope: 4.5, hotSlope: 5 },
    heatCaps: { cautionAt: 31, cautionCap: 55, dangerAt: 34, dangerCap: 38 },
    windCap: { speed: 12, score: 38 }
  },
  bike: {
    key: "bike",
    label: "자전거",
    shortLabel: "자전거",
    weights: { dust: 0.16, temperature: 0.18, precipitation: 0.24, uv: 0.12, humidity: 0.08, wind: 0.22 },
    temperature: { optimalLow: 12, optimalHigh: 24, coldSlope: 6, hotSlope: 4 },
    heatCaps: { cautionAt: 32, cautionCap: 60, dangerAt: 35, dangerCap: 40 },
    windCap: { speed: 11, score: 38 }
  }
};

export function isActivityKey(value: unknown): value is ActivityKey {
  return typeof value === "string" && ACTIVITY_ORDER.includes(value as ActivityKey);
}
