// 실제 활동·추천 시간·날씨·활동 길이를 조합해 상황에 필요한 준비물만 만든다.
import type { ActivityKey } from "./activities";
import type { ForecastSlot } from "./forecast";

export type ActivityDuration = "short" | "normal" | "long";
export type PreparationCategory = "required" | "weather" | "safety" | "optional";

export type PreparationItem = {
  id: string;
  category: PreparationCategory;
  label: string;
  detail: string;
};

export type PreparationPlan = {
  clothingLevel: "가볍게" | "보통" | "겹쳐 입기";
  clothingSummary: string;
  safetyHeadline?: string;
  safetyDetail?: string;
  items: PreparationItem[];
};

const categoryOrder: PreparationCategory[] = ["required", "weather", "safety", "optional"];

function hourOf(slot: ForecastSlot) {
  const hour = Number(slot.time.slice(11, 13));
  return Number.isFinite(hour) ? hour : 12;
}

function add(items: PreparationItem[], item: PreparationItem, condition = true) {
  if (condition && !items.some((current) => current.id === item.id)) items.push(item);
}

function isRainy(slot: ForecastSlot) {
  return slot.precipitation >= 0.2 || (slot.precipitationProbability ?? 0) >= 40;
}

function isHeavyRain(slot: ForecastSlot) {
  return slot.precipitation >= 3 || (slot.precipitationProbability ?? 0) >= 80;
}

function isStorm(slot: ForecastSlot) {
  return (slot.weatherCode ?? 0) >= 95 || (slot.windGust ?? 0) >= 14;
}

function isDark(slot: ForecastSlot) {
  const hour = hourOf(slot);
  return slot.isDay === false || hour < 6 || hour >= 19;
}

function isDusty(slot: ForecastSlot) {
  return (slot.pm25 ?? 0) > 35 || (slot.pm10 ?? 0) > 80;
}

export function getPreparationPlan(activity: ActivityKey, slot: ForecastSlot, duration: ActivityDuration): PreparationPlan {
  const items: PreparationItem[] = [];
  const hot = slot.apparentTemperature >= (activity === "run" ? 26 : activity === "dog" ? 27 : 29);
  const veryHot = slot.apparentTemperature >= (activity === "run" ? 30 : activity === "dog" ? 30 : 33);
  const cold = slot.apparentTemperature <= 5;
  const rain = isRainy(slot);
  const long = duration === "long";
  const dark = isDark(slot);
  const uvHigh = slot.uvIndex >= 3;
  const uvVeryHigh = slot.uvIndex >= 8;
  const dusty = isDusty(slot);

  add(items, { id: "water", category: "required", label: "휴대용 물", detail: "중간에 쉽게 마실 수 있는 작은 물병이나 소프트 플라스크를 챙겨요." }, hot || long || activity === "hike" || activity === "bike");
  add(items, { id: "phone-pouch", category: "required", label: "휴대폰 보호 파우치", detail: "알림·경로 확인과 비상 연락을 위해 땀과 충격에서 보호해요." }, activity === "run" || activity === "hike" || activity === "bike");
  add(items, { id: "dog-kit", category: "required", label: "배변봉투와 접이식 물그릇", detail: "반려견 산책 중 필요한 처리와 수분 보충을 한 번에 준비해요." }, activity === "dog");
  add(items, { id: "route-copy", category: "required", label: "오프라인 경로와 비상 연락", detail: "통신이 끊겨도 경로를 확인하고 예상 귀가 시간을 공유해요." }, activity === "hike" || (activity === "bike" && long));

  add(items, { id: "rain-shell", category: "weather", label: "가벼운 방수 재킷", detail: "우산보다 움직임을 방해하지 않는 통기성 방수 겉옷이 좋아요." }, rain);
  add(items, { id: "waterproof-pouch", category: "weather", label: "방수 파우치와 마른 수건", detail: "휴대폰·카드가 젖지 않게 하고 활동 뒤 물기를 바로 닦아요." }, rain);
  add(items, { id: "spare-socks", category: "weather", label: "여분 양말", detail: "젖은 발을 오래 두지 않도록 활동 뒤 바로 갈아 신어요." }, rain && (activity === "run" || activity === "hike" || activity === "bike"));
  add(items, { id: "sun-kit", category: "weather", label: "모자·선글라스·자외선 차단제", detail: uvVeryHigh ? "자외선이 매우 강해 그늘이 적은 구간과 한낮 노출을 줄여요." : "노출 부위를 보호하고 그늘 구간을 이용해요." }, uvHigh);
  add(items, { id: "wind-layer", category: "weather", label: "접어 넣는 방풍 겉옷", detail: "출발 전후와 바람 부는 구간에서 체온이 급격히 떨어지는 것을 줄여요." }, cold || slot.windSpeed >= 6);
  add(items, { id: "warmers", category: "weather", label: "얇은 장갑과 귀마개", detail: "부피가 작은 보온 소품으로 노출 부위를 보호해요." }, slot.apparentTemperature <= 0);
  add(items, { id: "dust-mask", category: "weather", label: "보건용 마스크", detail: "대기질이 나쁘면 시간을 줄이거나 실내 활동으로 바꾸는 것을 우선해요." }, dusty);

  add(items, { id: "visibility", category: "safety", label: "반사 밴드와 작은 안전등", detail: "운전자와 다른 이용자가 앞·뒤에서 쉽게 알아볼 수 있게 해요." }, dark);
  add(items, { id: "bike-safety", category: "safety", label: "헬멧·전조등·후미등", detail: "출발 전 고정 상태와 배터리를 확인하고 예비등을 준비해요." }, activity === "bike");
  add(items, { id: "trail-safety", category: "safety", label: "헤드랜턴·비상 보온포·구급 파우치", detail: "하산 지연이나 갑작스러운 기온 변화에 대비해요." }, activity === "hike");
  add(items, { id: "dog-heat", category: "safety", label: "발바닥 확인용 물티슈와 그늘 휴식", detail: "뜨거운 노면을 피하고 호흡이 거칠어지면 즉시 쉬어요." }, activity === "dog" && hot);
  add(items, { id: "repair-kit", category: "safety", label: "휴대용 펌프·튜브 수리 도구", detail: "장거리 자전거에서 작은 펑크에 스스로 대응할 수 있게 준비해요." }, activity === "bike" && long);

  add(items, { id: "electrolyte", category: "optional", label: "전해질 음료 또는 정제", detail: "땀이 많은 더운 날의 장시간 활동에서 물과 함께 활용해요." }, hot && long);
  add(items, { id: "power-bank", category: "optional", label: "소형 보조배터리", detail: "장시간 경로·알림 사용으로 배터리가 부족해질 때 대비해요." }, long);
  add(items, { id: "anti-chafe", category: "optional", label: "마찰 방지 밤", detail: "땀과 반복 움직임이 많은 장거리 러닝에서 필요한 부위에만 사용해요." }, activity === "run" && long);

  const safetyHeadline = isStorm(slot)
    ? "낙뢰·돌풍 가능성이 있어 활동을 미루는 편이 안전해요."
    : isHeavyRain(slot)
      ? "강한 비가 예상돼 실내 활동이나 다른 시간대를 먼저 확인하세요."
      : veryHot
        ? "무더운 시간은 피하고 강도와 시간을 낮춰요."
        : dusty
          ? "대기질이 나빠 시간을 줄이거나 실내 활동을 우선하세요."
          : undefined;

  const clothingLevel = cold ? "겹쳐 입기" : hot ? "가볍게" : "보통";
  const clothingSummary = cold
    ? "얇은 기능성 옷을 겹쳐 입고 더워지면 한 겹씩 조절해요."
    : hot
      ? "땀이 빨리 마르는 얇은 옷으로 열이 빠져나가게 해요."
      : rain
        ? "젖어도 빨리 마르는 옷과 가벼운 방수 겉옷이 좋아요."
        : "현재 체감온도에 맞는 가벼운 활동복이면 충분해요.";

  return {
    clothingLevel,
    clothingSummary,
    safetyHeadline,
    safetyDetail: safetyHeadline ? "준비물은 위험한 날씨를 안전하게 바꾸지 못해요. 기상특보와 현장 통제를 우선하세요." : undefined,
    items: items.sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category))
  };
}

