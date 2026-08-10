// 야외봄의 오늘·추천·준비 화면을 기존 웹 디자인과 같은 네이티브 정보 위계로 렌더링한다.
import { useMemo, useState, type ComponentType } from "react";
import {
  AccessibilityInfo,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import {
  Backpack,
  BellRing,
  Bike,
  ChevronDown,
  ChevronRight,
  CloudRain,
  Dog,
  Footprints,
  Haze,
  MapPin,
  Mountain,
  PersonStanding,
  Settings,
  Sparkles,
  Sun,
  Thermometer,
  Wind,
  X
} from "lucide-react-native";
import Svg, { Circle, Line, Path, Polyline, Rect, Text as SvgText } from "react-native-svg";
import { ACTIVITIES, ACTIVITY_ORDER, type ActivityKey } from "../lib/activities";
import { type ForecastSlot, type RankedForecastWindow } from "../lib/forecast";

export type PrimaryScreen = "today" | "recommendations" | "preparation" | "settings";

const colors = {
  paper: "#fffaf0",
  card: "#ffffff",
  surface: "#f8f1e6",
  ink: "#263333",
  ink2: "#4f5f5c",
  muted: "#71807c",
  line: "#e8ddcf",
  brand: "#2b98ca",
  brandDeep: "#176f98",
  brandSoft: "#e2f4fb",
  good: "#29936b",
  goodSoft: "#e9f7ef",
  goodLine: "#c1e4d1",
  warn: "#b48228",
  warnSoft: "#fff5e5",
  bad: "#bd3a43",
  badSoft: "#fff0f1",
  badLine: "#f0c8cb"
};

type IconType = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

const activityIcons: Record<ActivityKey, IconType> = {
  walk: Footprints,
  dog: Dog,
  run: PersonStanding,
  hike: Mountain,
  bike: Bike
};

function clock(value: string) {
  const match = value.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "시각 확인";
}

function hourLabel(value: string) {
  const hour = Number(value.slice(11, 13));
  if (!Number.isFinite(hour)) return clock(value);
  if (hour === 0) return "밤 12시";
  if (hour === 12) return "낮 12시";
  return `${hour < 12 ? "오전" : "오후"} ${hour <= 12 ? hour : hour - 12}시`;
}

function shortHour(value: string) {
  const hour = Number(value.slice(11, 13));
  if (!Number.isFinite(hour)) return clock(value);
  if (hour === 0) return "12시";
  return `${hour <= 12 ? hour : hour - 12}시`;
}

function scoreTone(score: number) {
  if (score >= 78) return { key: "good" as const, label: "좋음", ink: colors.good, soft: colors.goodSoft, line: colors.goodLine };
  if (score >= 62) return { key: "ok" as const, label: "보통", ink: colors.brandDeep, soft: colors.brandSoft, line: "#b9dfee" };
  return { key: "bad" as const, label: "주의", ink: colors.bad, soft: colors.badSoft, line: colors.badLine };
}

type MetricTone = "good" | "ok" | "bad" | "unknown";

function metricTone(slot: ForecastSlot) {
  const temperature: MetricTone = slot.apparentTemperature >= 8 && slot.apparentTemperature <= 22
    ? "good"
    : slot.apparentTemperature >= 0 && slot.apparentTemperature <= 30 ? "ok" : "bad";
  const rainValue = Math.max(slot.precipitationProbability ?? 0, slot.precipitation >= 1 ? 70 : slot.precipitation >= 0.2 ? 40 : 0);
  const rain: MetricTone = rainValue <= 20 ? "good" : rainValue < 60 ? "ok" : "bad";
  const dust: MetricTone = slot.pm25 === null ? "unknown" : slot.pm25 <= 15 ? "good" : slot.pm25 <= 35 ? "ok" : "bad";
  const wind: MetricTone = slot.windSpeed <= 4 ? "good" : slot.windSpeed <= 8 ? "ok" : "bad";
  return { temperature, rain, dust, wind };
}

function toneColors(tone: MetricTone) {
  if (tone === "good") return { ink: colors.good, soft: colors.goodSoft, line: colors.goodLine, label: "좋음" };
  if (tone === "bad") return { ink: colors.bad, soft: colors.badSoft, line: colors.badLine, label: "주의" };
  if (tone === "unknown") return { ink: colors.muted, soft: colors.surface, line: colors.line, label: "정보 없음" };
  return { ink: colors.brandDeep, soft: colors.brandSoft, line: "#c6e3ee", label: "보통" };
}

function worstMetric(tones: Record<"temperature" | "rain" | "dust" | "wind", MetricTone>) {
  const severity: Record<MetricTone, number> = { good: 0, unknown: 1, ok: 1, bad: 2 };
  return (Object.entries(tones) as [keyof typeof tones, MetricTone][]).reduce((worst, item) => severity[item[1]] > severity[worst[1]] ? item : worst);
}

function twoHourLabel(window: RankedForecastWindow) {
  return `${clock(window.start)}~${clock(window.end)}`;
}

export function WeatherControls({
  activity,
  locationName,
  selectedDate,
  todayDate,
  tomorrowDate,
  busy,
  onOpenActivities,
  onSelectDate,
  onRefreshLocation
}: {
  activity: ActivityKey;
  locationName: string;
  selectedDate: string;
  todayDate: string;
  tomorrowDate: string | null;
  busy: boolean;
  onOpenActivities: () => void;
  onSelectDate: (date: string) => void;
  onRefreshLocation: () => void;
}) {
  const ActivityIcon = activityIcons[activity];
  return (
    <View style={styles.controls}>
      <View style={styles.controlRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`현재 활동 ${ACTIVITIES[activity].label}. 활동 바꾸기`}
          onPress={onOpenActivities}
          style={({ pressed }) => [styles.activityControl, pressed ? styles.pressed : null]}
        >
          <ActivityIcon size={21} color="#38bf78" strokeWidth={2.2} />
          <Text style={styles.activityControlText}>{ACTIVITIES[activity].label}</Text>
          <ChevronDown size={17} color={colors.brandDeep} strokeWidth={2.4} />
        </Pressable>
        <View accessibilityRole="tablist" style={styles.daySwitch}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: selectedDate === todayDate }}
            onPress={() => onSelectDate(todayDate)}
            style={[styles.dayButton, selectedDate === todayDate ? styles.dayButtonActive : null]}
          ><Text style={selectedDate === todayDate ? styles.dayTextActive : styles.dayText}>오늘</Text></Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: Boolean(tomorrowDate && selectedDate === tomorrowDate), disabled: !tomorrowDate }}
            disabled={!tomorrowDate}
            onPress={() => tomorrowDate && onSelectDate(tomorrowDate)}
            style={[styles.dayButton, tomorrowDate && selectedDate === tomorrowDate ? styles.dayButtonActive : null, !tomorrowDate ? styles.disabled : null]}
          ><Text style={tomorrowDate && selectedDate === tomorrowDate ? styles.dayTextActive : styles.dayText}>내일</Text></Pressable>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${locationName}. 현재 위치 예보 새로 확인`}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={onRefreshLocation}
        style={({ pressed }) => [styles.locationBar, pressed ? styles.pressed : null, busy ? styles.disabled : null]}
      >
        <View style={styles.locationIcon}><MapPin size={20} color={colors.brandDeep} strokeWidth={2.2} /></View>
        <Text numberOfLines={1} style={styles.locationText}>{busy ? "현재 위치 확인 중" : locationName}</Text>
        <ChevronRight size={20} color={colors.muted} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

function threeHourWindows(slots: ForecastSlot[]) {
  if (slots.length < 3) return { best: null as [number, number] | null, worst: null as [number, number] | null, okay: null as [number, number] | null };
  const windows = slots.slice(0, -2).map((_, index) => ({ index, total: slots[index].score + slots[index + 1].score + slots[index + 2].score }));
  const sorted = [...windows].sort((a, b) => b.total - a.total);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const overlaps = (a: number, b: number) => Math.abs(a - b) < 3;
  const okay = sorted.find((item) => item.index !== best.index && item.index !== worst.index && !overlaps(item.index, best.index)) ?? null;
  const range = (item: { index: number } | null): [number, number] | null => item ? [item.index, item.index + 2] : null;
  return { best: range(best), worst: range(worst), okay: range(okay) };
}

function ScoreChart({ slots, index, onIndexChange }: { slots: ForecastSlot[]; index: number; onIndexChange: (index: number) => void }) {
  const [width, setWidth] = useState(320);
  const chartWidth = 340;
  const chartHeight = 136;
  const plotTop = 18;
  const plotBottom = 104;
  const fraction = (slotIndex: number) => slots.length > 1 ? slotIndex / (slots.length - 1) : 0.5;
  const y = (score: number) => plotTop + (1 - Math.max(0, Math.min(100, score)) / 100) * (plotBottom - plotTop);
  const points = slots.map((slot, slotIndex) => `${(fraction(slotIndex) * chartWidth).toFixed(1)},${y(slot.score).toFixed(1)}`).join(" ");
  const area = slots.length > 0 ? `M 0 ${plotBottom} L ${points.replaceAll(" ", " L ")} L ${chartWidth} ${plotBottom} Z` : "";
  const windows = useMemo(() => threeHourWindows(slots), [slots]);
  const updateFromX = (x: number) => {
    if (slots.length < 2) return;
    const next = Math.max(0, Math.min(slots.length - 1, Math.round((x / Math.max(1, width)) * (slots.length - 1))));
    onIndexChange(next);
  };
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => updateFromX(event.nativeEvent.locationX),
    onPanResponderMove: (event) => updateFromX(event.nativeEvent.locationX)
  });
  const active = slots[Math.min(index, slots.length - 1)] ?? slots[0];

  const shade = (window: [number, number] | null, fill: string, label: string, labelColor: string) => {
    if (!window) return null;
    const x0 = fraction(window[0]) * chartWidth;
    const x1 = fraction(window[1]) * chartWidth;
    return <>
      <Rect x={x0} y={plotTop} width={Math.max(8, x1 - x0)} height={plotBottom - plotTop} fill={fill} />
      <SvgText x={(x0 + x1) / 2} y={plotTop + 12} textAnchor="middle" fontSize="9" fontWeight="800" fill={labelColor}>{label}</SvgText>
    </>;
  };

  return (
    <View style={styles.chartCard}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={`시간대 선택. 현재 ${active ? hourLabel(active.time) : "정보 없음"}`}
        accessibilityValue={{ min: 0, max: Math.max(0, slots.length - 1), now: index, text: active ? `${hourLabel(active.time)} ${active.score}점` : "정보 없음" }}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "increment") onIndexChange(Math.min(slots.length - 1, index + 1));
          if (event.nativeEvent.actionName === "decrement") onIndexChange(Math.max(0, index - 1));
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={styles.chartTouch}
        {...responder.panHandlers}
      >
        <Svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
          {shade(windows.worst, "rgba(214,69,69,0.12)", "피하기", colors.bad)}
          {shade(windows.okay, "rgba(43,152,202,0.10)", "괜찮음", colors.brandDeep)}
          {shade(windows.best, "rgba(41,147,107,0.13)", "베스트", colors.good)}
          <Path d={area} fill="rgba(43,152,202,0.12)" />
          <Polyline points={points} fill="none" stroke={colors.brandDeep} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
          {active ? <>
            <Line x1={fraction(index) * chartWidth} x2={fraction(index) * chartWidth} y1={plotTop} y2={plotBottom} stroke={colors.ink} strokeWidth="1.2" strokeDasharray="3 4" opacity="0.48" />
            <Circle cx={fraction(index) * chartWidth} cy={y(active.score)} r="5" fill="#fff" stroke={colors.brandDeep} strokeWidth="2.5" />
          </> : null}
        </Svg>
        {active ? <View pointerEvents="none" style={[styles.chartBubble, { left: `${Math.max(12, Math.min(88, fraction(index) * 100))}%` }]}>
          <Text style={styles.chartBubbleText}>{hourLabel(active.time)} {active.score}점</Text>
        </View> : null}
      </View>
      <View style={styles.axisRow}>
        {slots.filter((_, slotIndex) => slotIndex === 0 || slotIndex === slots.length - 1 || slotIndex % 3 === 0).map((slot) => <Text key={slot.time} style={styles.axisText}>{shortHour(slot.time)}</Text>)}
      </View>
      <View style={styles.legendRow}>
        <Legend color="rgba(41,147,107,0.65)" label="베스트" />
        <Legend color="rgba(43,152,202,0.58)" label="괜찮음" />
        <Legend color="rgba(214,69,69,0.55)" label="피하기" />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View>;
}

function MetricTile({ icon: Icon, label, value, tone, isWorst }: { icon: IconType; label: string; value: string; tone: MetricTone; isWorst: boolean }) {
  const palette = toneColors(tone);
  return (
    <View accessible accessibilityLabel={`${label} ${value}, ${palette.label}`} style={[styles.metricTile, { backgroundColor: palette.soft, borderColor: palette.line }]}>
      {isWorst ? <Text style={[styles.worstBadge, { backgroundColor: palette.ink }]}>가장 아쉬움</Text> : null}
      <View style={styles.metricTop}><Icon size={16} color={palette.ink} strokeWidth={2.2} /><Text style={[styles.metricLabel, { color: palette.ink }]}>{label}</Text></View>
      <Text style={[styles.metricNumber, { color: palette.ink }]}>{value}</Text>
      <Text style={styles.metricGrade}>{palette.label}</Text>
    </View>
  );
}

export function TodayDashboard({
  slots,
  activity,
  dayLabel,
  isReferenceOnly,
  onAlarm
}: {
  slots: ForecastSlot[];
  activity: ActivityKey;
  dayLabel: string;
  isReferenceOnly: boolean;
  onAlarm: (time: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const active = slots[Math.min(index, slots.length - 1)] ?? slots[0];
  const tone = scoreTone(active?.score ?? 0);
  const tones = active ? metricTone(active) : { temperature: "unknown", rain: "unknown", dust: "unknown", wind: "unknown" } as const;
  const worst = worstMetric(tones);
  const windows = useMemo(() => threeHourWindows(slots), [slots]);
  const bestSlots = windows.best ? slots.slice(windows.best[0], windows.best[1] + 1) : slots.slice(0, 1);
  const bestPeak = bestSlots.reduce((current, slot) => !current || slot.score > current.score ? slot : current, bestSlots[0]);
  const bestStart = bestSlots[0] ?? active;
  const bestEnd = bestSlots[bestSlots.length - 1] ?? active;
  const detail = !active
    ? "예보를 불러오는 중이에요."
    : isReferenceOnly
      ? "일부 안전 자료가 빠져 참고 점수로만 보여드려요."
      : active.detail;
  const title = !active
    ? "예보를 준비하고 있어요"
    : `${ACTIVITIES[activity].label} ${tone.key === "good" ? "지금 딱 좋아요" : tone.key === "ok" ? "무난하게 괜찮아요" : "조금 아쉬워요"}`;

  return (
    <View style={styles.todayStack}>
      <View style={[styles.scoreBanner, { backgroundColor: tone.soft, borderColor: tone.line }]}>
        <View style={styles.scoreCopy}>
          <View style={[styles.scorePill, { backgroundColor: tone.ink }]}><Text style={styles.scorePillText}>{isReferenceOnly ? "참고" : tone.label}</Text></View>
          <Text accessibilityRole="header" style={styles.scoreTitle}>{title}</Text>
          <Text style={styles.scoreDetail}>{detail}</Text>
        </View>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreWhen}>{active ? `${hourLabel(active.time)} 기준` : "현재 기준"}</Text>
          <View style={styles.scoreNumberRow}><Text style={[styles.scoreNumber, { color: tone.ink }]}>{active?.score ?? "—"}</Text><Text style={[styles.scoreOutOf, { color: tone.ink }]}>/100</Text></View>
        </View>
      </View>
      {slots.length >= 2 ? <ScoreChart slots={slots} index={index} onIndexChange={setIndex} /> : null}
      {active ? <View style={styles.metricRow}>
        <MetricTile icon={Thermometer} label="체감" value={`${Math.round(active.apparentTemperature)}°`} tone={tones.temperature} isWorst={worst[0] === "temperature"} />
        <MetricTile icon={CloudRain} label="강수" value={active.precipitationProbability === null ? `${active.precipitation.toFixed(1)}㎜` : `${Math.round(active.precipitationProbability)}%`} tone={tones.rain} isWorst={worst[0] === "rain"} />
        <MetricTile icon={Haze} label="미세" value={active.pm25 === null ? "—" : `${Math.round(active.pm25)}`} tone={tones.dust} isWorst={worst[0] === "dust"} />
        <MetricTile icon={Wind} label="풍속" value={active.windSpeed.toFixed(1)} tone={tones.wind} isWorst={worst[0] === "wind"} />
      </View> : null}
      {bestStart && bestEnd && bestPeak ? <View style={styles.bestBanner}>
        <View style={styles.bestCopy}>
          <View style={styles.bestKicker}><Sun size={16} color={colors.brandDeep} /><Text style={styles.bestKickerText}>{dayLabel}의 베스트 시간</Text></View>
          <Text style={styles.bestTitle}>{hourLabel(bestStart.time)}–{hourLabel(bestEnd.time)} · 최고 {bestPeak.score}점</Text>
          <Text style={styles.bestDetail}>이 {Math.max(1, bestSlots.length)}시간이 {dayLabel} 최고 · 체감 {Math.round(bestPeak.apparentTemperature)}°</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="베스트 시간 알림 설정" disabled={isReferenceOnly} onPress={() => onAlarm(bestStart.time)} style={({ pressed }) => [styles.alarmButtonSquare, pressed ? styles.pressed : null, isReferenceOnly ? styles.disabled : null]}>
          <BellRing size={23} color="#fff" strokeWidth={2.1} />
        </Pressable>
      </View> : null}
    </View>
  );
}

function DetailMetric({ icon: Icon, value, label, tone }: { icon: IconType; value: string; label: string; tone: MetricTone }) {
  const palette = toneColors(tone);
  return <View accessible accessibilityLabel={`${label} ${value}, ${palette.label}`} style={[styles.detailMetric, { backgroundColor: palette.soft, borderColor: palette.line }]}>
    <View style={[styles.detailMetricIcon, { backgroundColor: colors.card }]}><Icon size={19} color={palette.ink} /></View>
    <View><Text style={styles.detailMetricValue}>{value}</Text><Text style={styles.detailMetricLabel}>{label} · {palette.label}</Text></View>
  </View>;
}

export function RecommendationDashboard({
  slots,
  windows,
  activity,
  dayLabel,
  isReferenceOnly,
  onAlarm
}: {
  slots: ForecastSlot[];
  windows: RankedForecastWindow[];
  activity: ActivityKey;
  dayLabel: string;
  isReferenceOnly: boolean;
  onAlarm: (time: string) => void;
}) {
  const main = windows[0];
  const mainSlots = main ? slots.filter((slot) => slot.time === main.start || slot.time === main.secondHour) : [];
  const start = mainSlots[0] ?? slots[0];
  const maxRain = mainSlots.length ? Math.max(...mainSlots.map((slot) => slot.precipitationProbability ?? 0)) : null;
  const tones = start ? metricTone(start) : null;
  const sunset = start?.sunset ? clock(start.sunset) : null;
  const reason = !main
    ? "남은 시간대 중 안전하게 권할 구간이 없어요."
    : main.recommended
      ? "비 걱정이 낮고 바람이 비교적 약해요."
      : "조건이 가장 나은 구간이지만 현장 상황을 한 번 더 확인하세요.";

  return <View style={styles.recommendationStack}>
    <View style={styles.sectionHeading}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>추천 시간과 날씨</Text>
      <Text style={styles.sectionDescription}>{ACTIVITIES[activity].label} 기준으로 모든 지표를 다시 계산했어요.</Text>
    </View>
    <View style={styles.recommendationCard}>
      <View style={styles.recommendationHeader}>
        <Text style={styles.recommendationKicker}>{main?.recommended ? `${ACTIVITIES[activity].label}하기 좋은 시간` : "상대적으로 나은 시간"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="추천 시간 알림 설정" disabled={!main || isReferenceOnly} onPress={() => main && onAlarm(main.start)} style={({ pressed }) => [styles.roundAlarm, pressed ? styles.pressed : null, !main || isReferenceOnly ? styles.disabled : null]}>
          <BellRing size={23} color={colors.brandDeep} strokeWidth={2.1} />
        </Pressable>
      </View>
      <Text style={styles.recommendationTime}>{main ? twoHourLabel(main) : "추천 시간 없음"}</Text>
      <Text style={styles.recommendationReason}>{reason}</Text>
      {main ? <View style={styles.conditionChips}>
        <View style={styles.rainChip}><CloudRain size={15} color={colors.warn} /><Text style={styles.rainChipText}>{maxRain && maxRain > 0 ? `최대 ${Math.round(maxRain)}% 비 가능성` : "비 가능성 낮음"}</Text></View>
        {sunset ? <View style={styles.sunChip}><Sun size={15} color={colors.ink2} /><Text style={styles.sunChipText}>일몰 {sunset}</Text></View> : null}
      </View> : null}
      {maxRain !== null ? <Text style={styles.skyDetail}>최대 {Math.round(maxRain)}% · 하늘 확인</Text> : null}
    </View>
    {windows.length > 1 ? <View style={styles.alternativeSection}>
      <Text style={styles.subsectionTitle}>다른 추천 시간</Text>
      {windows.slice(1, 2).map((window) => <View key={window.start} style={styles.alternativeCard}>
        <View style={styles.alternativeCopy}><Text style={styles.alternativeTime}>{twoHourLabel(window)}</Text><Text style={styles.alternativeDetail}>2시간 평균 {window.score}점 · 체감 {Math.round(window.apparentTemperature)}° · 비 {Math.round(window.precipitationProbability)}%</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={`${twoHourLabel(window)} 알림 설정`} disabled={isReferenceOnly} onPress={() => onAlarm(window.start)} style={({ pressed }) => [styles.roundAlarmSoft, pressed ? styles.pressed : null, isReferenceOnly ? styles.disabled : null]}><BellRing size={21} color={colors.brandDeep} /></Pressable>
      </View>)}
    </View> : null}
    {start && tones ? <View style={styles.detailSection}>
      <Text style={styles.subsectionTitle}>상세 날씨</Text>
      <View style={styles.detailGrid}>
        <DetailMetric icon={Thermometer} value={`${Math.round(start.apparentTemperature)}°`} label="체감" tone={tones.temperature} />
        <DetailMetric icon={CloudRain} value={start.precipitationProbability === null ? `${start.precipitation.toFixed(1)}㎜` : `${Math.round(start.precipitationProbability)}%`} label="비올확률" tone={tones.rain} />
        <DetailMetric icon={Haze} value={start.pm25 === null ? "정보 없음" : `${Math.round(start.pm25)}`} label="미세먼지" tone={tones.dust} />
        <DetailMetric icon={Sun} value={start.uvIndex.toFixed(1)} label="자외선" tone={start.uvIndex <= 2 ? "good" : start.uvIndex < 8 ? "ok" : "bad"} />
      </View>
    </View> : null}
    <Text style={styles.referenceNote}>{dayLabel} 예보는 참고 정보예요. 현장 안내와 실제 상태를 함께 확인하세요.</Text>
  </View>;
}

export function PreparationDashboard({
  activity,
  windowLabel,
  tips,
  onAlarm
}: {
  activity: ActivityKey;
  windowLabel: string;
  tips: string[];
  onAlarm: () => void;
}) {
  return <View style={styles.preparationStack}>
    <View style={styles.sectionHeading}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>나가기 전 준비</Text>
      <Text style={styles.sectionDescription}>{windowLabel}의 실제 예보와 {ACTIVITIES[activity].label} 기준으로 정리했어요.</Text>
    </View>
    <View style={styles.prepHero}>
      <View style={styles.prepHeroIcon}><Backpack size={28} color={colors.brandDeep} /></View>
      <View style={styles.prepHeroCopy}><Text style={styles.prepHeroKicker}>추천 시간</Text><Text style={styles.prepHeroTitle}>{windowLabel}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="추천 시간 알림 설정" onPress={onAlarm} style={({ pressed }) => [styles.roundAlarm, pressed ? styles.pressed : null]}><BellRing size={22} color={colors.brandDeep} /></Pressable>
    </View>
    <View style={styles.prepCard}>
      <Text style={styles.subsectionTitle}>꼭 확인할 것</Text>
      {tips.map((tip, index) => <View key={tip} style={styles.prepRow}><View style={styles.prepNumber}><Text style={styles.prepNumberText}>{index + 1}</Text></View><Text style={styles.prepText}>{tip}</Text></View>)}
    </View>
    <View style={styles.prepNotice}><Text style={styles.prepNoticeTitle}>출발 직전 한 번 더 확인해요</Text><Text style={styles.prepNoticeText}>기상 특보·현장 통제·노면 상태가 앱 예보보다 우선입니다.</Text></View>
  </View>;
}

export function BottomNavigation({ active, onChange }: { active: PrimaryScreen; onChange: (screen: PrimaryScreen) => void }) {
  const items: { key: PrimaryScreen; label: string; icon: IconType }[] = [
    { key: "today", label: "오늘", icon: Sun },
    { key: "recommendations", label: "추천", icon: Sparkles },
    { key: "preparation", label: "준비", icon: Backpack },
    { key: "settings", label: "설정", icon: Settings }
  ];
  return <View accessibilityRole="tablist" style={styles.bottomNav}>
    {items.map((item) => {
      const Icon = item.icon;
      const selected = active === item.key;
      return <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={`${item.label} 탭`} onPress={() => onChange(item.key)} style={({ pressed }) => [styles.navButton, pressed ? styles.pressed : null]}>
        <Icon size={25} color={selected ? colors.brandDeep : colors.muted} strokeWidth={selected ? 2.4 : 2} />
        <Text style={selected ? styles.navTextActive : styles.navText}>{item.label}</Text>
      </Pressable>;
    })}
  </View>;
}

export function ActivityPickerSheet({ visible, selected, onClose, onSelect }: { visible: boolean; selected: ActivityKey; onClose: () => void; onSelect: (activity: ActivityKey) => void }) {
  return <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose} statusBarTranslucent>
    <View style={styles.modalContainer}>
      <Pressable accessibilityRole="button" accessibilityLabel="활동 선택 닫기" onPress={onClose} style={styles.modalBackdrop} />
      <View accessibilityViewIsModal style={styles.activitySheet}>
        <View style={styles.sheetHeader}><View><Text accessibilityRole="header" style={styles.sheetTitle}>활동을 선택하세요</Text><Text style={styles.sheetDescription}>같은 예보를 활동에 맞게 다시 계산해요.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={styles.sheetClose}><X size={22} color={colors.ink} /></Pressable></View>
        {ACTIVITY_ORDER.map((key) => {
          const Icon = activityIcons[key];
          const active = selected === key;
          return <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => { onSelect(key); onClose(); }} style={({ pressed }) => [styles.activityOption, active ? styles.activityOptionActive : null, pressed ? styles.pressed : null]}>
            <View style={styles.activityOptionIcon}><Icon size={22} color={active ? colors.brandDeep : colors.ink2} /></View><Text style={active ? styles.activityOptionTextActive : styles.activityOptionText}>{ACTIVITIES[key].label}</Text>{active ? <Text style={styles.selectedLabel}>선택됨</Text> : null}
          </Pressable>;
        })}
      </View>
    </View>
  </Modal>;
}

export function announceScreen(screen: PrimaryScreen) {
  const label: Record<PrimaryScreen, string> = { today: "오늘", recommendations: "추천", preparation: "준비", settings: "설정" };
  AccessibilityInfo.announceForAccessibility(`${label[screen]} 화면`);
}

const styles = StyleSheet.create({
  controls: { gap: 12 },
  controlRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  activityControl: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.brandSoft },
  activityControlText: { color: colors.brandDeep, fontSize: 16, fontWeight: "900", letterSpacing: -0.3 },
  daySwitch: { minHeight: 46, flexDirection: "row", alignItems: "stretch", padding: 4, borderRadius: 999, backgroundColor: colors.surface },
  dayButton: { minWidth: 54, alignItems: "center", justifyContent: "center", borderRadius: 999 },
  dayButtonActive: { backgroundColor: colors.card, shadowColor: "#56462f", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  dayText: { color: colors.muted, fontSize: 15, fontWeight: "800" },
  dayTextActive: { color: colors.brandDeep, fontSize: 15, fontWeight: "900" },
  locationBar: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: 19, backgroundColor: colors.surface },
  locationIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.brandSoft },
  locationText: { minWidth: 0, flex: 1, color: colors.ink, fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  todayStack: { gap: 12 },
  scoreBanner: { minHeight: 152, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 16, borderWidth: 1, borderRadius: 24 },
  scoreCopy: { minWidth: 0, flex: 1, alignItems: "flex-start" },
  scorePill: { minHeight: 29, justifyContent: "center", paddingHorizontal: 13, borderRadius: 999 },
  scorePillText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  scoreTitle: { marginTop: 10, color: colors.ink, fontSize: 19, lineHeight: 25, fontWeight: "900", letterSpacing: -0.6 },
  scoreDetail: { marginTop: 6, color: colors.ink2, fontSize: 13, lineHeight: 19 },
  scoreBox: { flexShrink: 0, alignItems: "flex-end" },
  scoreWhen: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  scoreNumberRow: { flexDirection: "row", alignItems: "baseline" },
  scoreNumber: { fontSize: 52, lineHeight: 60, fontWeight: "900", letterSpacing: -2 },
  scoreOutOf: { fontSize: 14, fontWeight: "900" },
  chartCard: { paddingHorizontal: 14, paddingTop: 16, paddingBottom: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 26, backgroundColor: colors.card, shadowColor: "#6b5740", shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  chartTouch: { position: "relative", overflow: "visible" },
  chartBubble: { position: "absolute", top: 0, transform: [{ translateX: -58 }], minWidth: 116, alignItems: "center", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.ink },
  chartBubbleText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  axisRow: { flexDirection: "row", justifyContent: "space-between", marginTop: -3 },
  axisText: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  legendRow: { flexDirection: "row", justifyContent: "center", gap: 14, marginTop: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 4 },
  legendText: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  metricRow: { flexDirection: "row", gap: 7 },
  metricTile: { minWidth: 0, flex: 1, minHeight: 88, justifyContent: "center", paddingHorizontal: 9, borderWidth: 1, borderRadius: 18 },
  metricTop: { flexDirection: "row", alignItems: "center", gap: 5 },
  metricLabel: { fontSize: 11, fontWeight: "900" },
  metricNumber: { marginTop: 5, fontSize: 21, fontWeight: "900", letterSpacing: -0.6 },
  metricGrade: { marginTop: 3, color: colors.muted, fontSize: 11 },
  worstBadge: { position: "absolute", top: -10, right: 5, zIndex: 2, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, color: "#fff", fontSize: 9, fontWeight: "900" },
  bestBanner: { minHeight: 86, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 15, paddingVertical: 12, borderWidth: 1, borderColor: "#c4e3ef", borderRadius: 22, backgroundColor: colors.brandSoft },
  bestCopy: { minWidth: 0, flex: 1 },
  bestKicker: { flexDirection: "row", alignItems: "center", gap: 6 },
  bestKickerText: { color: colors.brandDeep, fontSize: 12, fontWeight: "900" },
  bestTitle: { marginTop: 5, color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "900", letterSpacing: -0.4 },
  bestDetail: { marginTop: 3, color: colors.ink2, fontSize: 12, lineHeight: 18 },
  alarmButtonSquare: { width: 54, height: 54, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: colors.brandDeep },
  sectionHeading: { gap: 6 },
  sectionTitle: { color: colors.ink, fontSize: 28, lineHeight: 35, fontWeight: "900", letterSpacing: -1 },
  sectionDescription: { color: colors.ink2, fontSize: 14, lineHeight: 22 },
  recommendationStack: { gap: 18 },
  recommendationCard: { padding: 18, borderWidth: 1, borderColor: colors.line, borderLeftWidth: 5, borderLeftColor: colors.brand, borderRadius: 24, backgroundColor: colors.card, shadowColor: "#6b5740", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  recommendationHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  recommendationKicker: { color: colors.ink2, fontSize: 15, fontWeight: "900" },
  roundAlarm: { width: 54, height: 54, alignItems: "center", justifyContent: "center", borderRadius: 27, backgroundColor: colors.brandSoft },
  recommendationTime: { marginTop: 6, color: colors.ink, fontSize: 31, lineHeight: 38, fontWeight: "900", letterSpacing: -1 },
  recommendationReason: { marginTop: 5, color: colors.ink2, fontSize: 15, lineHeight: 22 },
  conditionChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  rainChip: { minHeight: 35, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.warnSoft },
  rainChipText: { color: "#8a651f", fontSize: 12, fontWeight: "800" },
  sunChip: { minHeight: 35, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.surface },
  sunChipText: { color: colors.ink2, fontSize: 12, fontWeight: "800" },
  skyDetail: { marginTop: 12, color: colors.muted, fontSize: 12, fontWeight: "700" },
  alternativeSection: { gap: 9 },
  subsectionTitle: { color: colors.ink2, fontSize: 15, fontWeight: "900" },
  alternativeCard: { minHeight: 78, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 18, paddingRight: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 20, backgroundColor: colors.card },
  alternativeCopy: { minWidth: 0, flex: 1 },
  alternativeTime: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  alternativeDetail: { marginTop: 3, color: colors.muted, fontSize: 11, lineHeight: 17, fontWeight: "700" },
  roundAlarmSoft: { width: 50, height: 50, alignItems: "center", justifyContent: "center", borderRadius: 25, backgroundColor: colors.surface },
  detailSection: { gap: 10 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  detailMetric: { width: "48.5%", minHeight: 108, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderWidth: 1, borderRadius: 24 },
  detailMetricIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  detailMetricValue: { color: colors.ink, fontSize: 23, fontWeight: "900" },
  detailMetricLabel: { marginTop: 5, color: colors.muted, fontSize: 11, lineHeight: 16 },
  referenceNote: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center" },
  preparationStack: { gap: 18 },
  prepHero: { minHeight: 110, flexDirection: "row", alignItems: "center", gap: 13, padding: 18, borderWidth: 1, borderColor: "#c4e3ef", borderRadius: 24, backgroundColor: colors.brandSoft },
  prepHeroIcon: { width: 54, height: 54, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: colors.card },
  prepHeroCopy: { minWidth: 0, flex: 1 },
  prepHeroKicker: { color: colors.brandDeep, fontSize: 12, fontWeight: "900" },
  prepHeroTitle: { marginTop: 5, color: colors.ink, fontSize: 20, fontWeight: "900" },
  prepCard: { gap: 12, padding: 20, borderWidth: 1, borderColor: colors.line, borderRadius: 25, backgroundColor: colors.card },
  prepRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12 },
  prepNumber: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: colors.brandSoft },
  prepNumberText: { color: colors.brandDeep, fontSize: 12, fontWeight: "900" },
  prepText: { minWidth: 0, flex: 1, color: colors.ink2, fontSize: 14, lineHeight: 21 },
  prepNotice: { gap: 4, padding: 17, borderRadius: 20, backgroundColor: colors.surface },
  prepNoticeTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  prepNoticeText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  bottomNav: { position: "absolute", right: 0, bottom: 0, left: 0, minHeight: 80, flexDirection: "row", alignItems: "stretch", paddingHorizontal: 8, paddingTop: 7, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: "rgba(255,250,240,0.97)" },
  navButton: { flex: 1, minHeight: 62, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 18 },
  navText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  navTextActive: { color: colors.brandDeep, fontSize: 11, fontWeight: "900" },
  modalContainer: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(24,39,39,0.44)" },
  activitySheet: { gap: 9, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: colors.paper },
  sheetHeader: { minHeight: 60, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  sheetTitle: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  sheetDescription: { marginTop: 5, color: colors.muted, fontSize: 13 },
  sheetClose: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: colors.surface },
  activityOption: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 19, backgroundColor: colors.card },
  activityOptionActive: { borderColor: "#b9dfee", backgroundColor: colors.brandSoft },
  activityOptionIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: colors.surface },
  activityOptionText: { flex: 1, color: colors.ink2, fontSize: 16, fontWeight: "800" },
  activityOptionTextActive: { flex: 1, color: colors.brandDeep, fontSize: 16, fontWeight: "900" },
  selectedLabel: { color: colors.brandDeep, fontSize: 11, fontWeight: "900" },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.42 }
});
