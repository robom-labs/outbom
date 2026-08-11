// 추천 시간의 여섯 날씨 지표를 눌러 이해할 수 있는 상세 설명으로 변환한다.
import type { ActivityKey } from "./activities";
import type { ForecastSlot } from "./forecast";

export type MetricKey = "feel" | "rain" | "dust" | "uv" | "wind" | "humidity";

export type MetricDetail = {
  key: MetricKey;
  title: string;
  value: string;
  grade: "좋음" | "보통" | "주의" | "정보 없음";
  meaning: string;
  action: string;
  sourceLabel: string;
};

function valueGrade(value: number | null, goodMax: number, cautionAt: number) {
  if (value === null) return "정보 없음" as const;
  if (value <= goodMax) return "좋음" as const;
  if (value < cautionAt) return "보통" as const;
  return "주의" as const;
}

export function getMetricDetail(key: MetricKey, slot: ForecastSlot, activity: ActivityKey): MetricDetail {
  if (key === "feel") {
    const low = activity === "run" ? 5 : 0;
    const high = activity === "run" ? 24 : 28;
    const grade = slot.apparentTemperature >= low && slot.apparentTemperature <= high ? "좋음" : slot.apparentTemperature >= low - 7 && slot.apparentTemperature <= high + 4 ? "보통" : "주의";
    return { key, title: "체감온도", value: `${Math.round(slot.apparentTemperature)}°`, grade, meaning: "기온에 바람과 습도를 함께 반영해 몸이 느끼는 온도예요.", action: grade === "주의" ? "더 시원하거나 따뜻한 시간으로 옮기고 활동 강도를 낮춰요." : "첫 5분은 천천히 시작해 몸 상태에 맞게 조절해요.", sourceLabel: "Open-Meteo 체감온도" };
  }
  if (key === "rain") {
    const probability = slot.precipitationProbability;
    const grade = probability === null ? "정보 없음" : valueGrade(Math.max(probability, slot.precipitation >= 1 ? 70 : 0), 20, 60);
    return { key, title: "비", value: probability === null ? "확인 중" : `${Math.round(probability)}%`, grade, meaning: `해당 시간 강수확률과 예상 강수량 ${slot.precipitation.toFixed(1)}mm를 함께 봤어요.`, action: grade === "주의" ? "강한 비라면 다른 시간대를 선택하고, 약한 비에는 방수 겉옷과 방수 파우치를 챙겨요." : "출발 직전 레이더와 현장 하늘을 한 번 더 확인해요.", sourceLabel: "Open-Meteo 강수확률·강수량" };
  }
  if (key === "dust") {
    const grade = slot.pm25 === null ? "정보 없음" : valueGrade(slot.pm25, 15, 36);
    return { key, title: "미세먼지", value: slot.pm25 === null ? "확인 중" : `${Math.round(slot.pm25)}`, grade, meaning: "PM2.5 시간대 예보예요. 숫자가 낮을수록 야외활동 부담이 적어요.", action: grade === "주의" ? "시간을 줄이거나 실내 활동으로 바꾸고 지역 대기질 안내를 다시 확인해요." : "민감한 사람은 평소 몸 상태와 지역 안내를 함께 확인해요.", sourceLabel: "Open-Meteo Air Quality PM2.5" };
  }
  if (key === "uv") {
    const grade = valueGrade(slot.uvIndex, 2, 6);
    return { key, title: "자외선", value: `${Math.round(slot.uvIndex * 10) / 10}`, grade, meaning: "피부와 눈에 닿는 자외선의 강도를 나타내는 지수예요.", action: slot.uvIndex >= 3 ? "그늘·긴 옷·모자·선글라스·자외선 차단제를 준비해요." : "장시간이라면 노출 부위를 계속 확인해요.", sourceLabel: "Open-Meteo UV index" };
  }
  if (key === "wind") {
    const grade = valueGrade(slot.windSpeed, 4, activity === "bike" ? 8 : 10);
    return { key, title: "바람", value: `${Math.round(slot.windSpeed * 10) / 10}m/s`, grade, meaning: `평균 풍속이며 순간 돌풍은 ${slot.windGust === null || slot.windGust === undefined ? "확인 중" : `${Math.round(slot.windGust * 10) / 10}m/s`}예요.`, action: grade === "주의" ? "나무·낙하물·균형 상실 위험을 고려해 노출된 경로를 피하거나 시간을 바꿔요." : "맞바람 구간은 속도를 낮추고 체온 변화에 대비해요.", sourceLabel: "Open-Meteo 10m 풍속·돌풍" };
  }
  const grade = slot.relativeHumidity === null ? "정보 없음" : slot.relativeHumidity >= 35 && slot.relativeHumidity <= 70 ? "좋음" : slot.relativeHumidity <= 80 ? "보통" : "주의";
  return { key, title: "습도", value: slot.relativeHumidity === null ? "확인 중" : `${Math.round(slot.relativeHumidity)}%`, grade, meaning: "공기 중 수분의 비율이에요. 높은 습도는 땀의 증발을 늦출 수 있어요.", action: grade === "주의" ? "속도를 낮추고 수분을 자주 보충하며 그늘에서 쉬어요." : "체감온도와 함께 보고 활동 강도를 조절해요.", sourceLabel: "Open-Meteo 상대습도" };
}

export function getMetricDetails(slot: ForecastSlot, activity: ActivityKey) {
  return (["feel", "rain", "dust", "uv", "wind", "humidity"] as MetricKey[]).map((key) => getMetricDetail(key, slot, activity));
}

