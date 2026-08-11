// 활동 시간과 날씨에 맞는 준비물만 노출하고 당연한 신발류를 추천하지 않는지 검증한다.
import { describe, expect, it } from "vitest";
import { getPreparationPlan } from "../lib/preparation";
import type { ForecastSlot } from "../lib/forecast";

function slot(overrides: Partial<ForecastSlot> = {}): ForecastSlot {
  return {
    time: "2026-08-11T18:00",
    temperature: 24,
    apparentTemperature: 25,
    precipitation: 0,
    precipitationProbability: 10,
    windSpeed: 2.5,
    windGust: 4,
    visibility: 20000,
    uvIndex: 1,
    relativeHumidity: 60,
    pm25: 12,
    pm10: 24,
    weatherCode: 1,
    snowfall: 0,
    isDay: true,
    score: 88,
    judgment: "좋음",
    detail: "활동하기 좋아요.",
    ...overrides
  };
}

describe("native dynamic preparation", () => {
  it("러닝 준비물에 당연한 신발을 넣지 않는다", () => {
    const plan = getPreparationPlan("run", slot(), "normal");
    expect(plan.items.map((item) => item.label).join(" ")).not.toMatch(/신발|운동화/);
  });

  it("비 오는 러닝에는 방수 겉옷·파우치·여분 양말을 넣는다", () => {
    const plan = getPreparationPlan("run", slot({ precipitation: 2, precipitationProbability: 85 }), "normal");
    expect(plan.items.map((item) => item.id)).toEqual(expect.arrayContaining(["rain-shell", "waterproof-pouch", "spare-socks"]));
  });

  it("어두운 시간에는 반사 밴드와 안전등을 넣는다", () => {
    const plan = getPreparationPlan("walk", slot({ time: "2026-08-11T22:00", isDay: false }), "normal");
    expect(plan.items.map((item) => item.id)).toContain("visibility");
  });

  it("더운 장거리 러닝에는 물·전해질·마찰 방지 준비물을 넣는다", () => {
    const plan = getPreparationPlan("run", slot({ apparentTemperature: 31 }), "long");
    expect(plan.items.map((item) => item.id)).toEqual(expect.arrayContaining(["water", "electrolyte", "anti-chafe"]));
  });

  it("활동별 특수 안전 준비물을 구분한다", () => {
    expect(getPreparationPlan("bike", slot(), "long").items.map((item) => item.id)).toEqual(expect.arrayContaining(["bike-safety", "repair-kit"]));
    expect(getPreparationPlan("hike", slot(), "normal").items.map((item) => item.id)).toContain("trail-safety");
    expect(getPreparationPlan("dog", slot({ apparentTemperature: 30 }), "normal").items.map((item) => item.id)).toEqual(expect.arrayContaining(["dog-kit", "dog-heat"]));
  });
});
