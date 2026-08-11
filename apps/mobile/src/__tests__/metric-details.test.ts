// 추천 시간의 여섯 날씨 카드가 모두 상세 설명과 행동 안내를 제공하는지 검증한다.
import { describe, expect, it } from "vitest";
import { getMetricDetails } from "../lib/metric-details";
import type { ForecastSlot } from "../lib/forecast";

const slot: ForecastSlot = {
  time: "2026-08-11T18:00",
  temperature: 25,
  apparentTemperature: 27,
  precipitation: 0,
  precipitationProbability: 10,
  windSpeed: 2.9,
  windGust: 5,
  visibility: 20000,
  uvIndex: 2,
  relativeHumidity: 68,
  pm25: 14,
  pm10: 28,
  weatherCode: 1,
  snowfall: 0,
  isDay: true,
  score: 91,
  judgment: "좋음",
  detail: "활동하기 좋아요."
};

describe("native weather metric details", () => {
  it("체감·비·미세·자외선·바람·습도 여섯 항목을 만든다", () => {
    const details = getMetricDetails(slot, "run");
    expect(details.map((item) => item.key)).toEqual(["feel", "rain", "dust", "uv", "wind", "humidity"]);
    expect(details).toHaveLength(6);
    for (const detail of details) {
      expect(detail.value.length).toBeGreaterThan(0);
      expect(detail.meaning.length).toBeGreaterThan(10);
      expect(detail.action.length).toBeGreaterThan(10);
      expect(detail.sourceLabel.length).toBeGreaterThan(0);
    }
  });
});
