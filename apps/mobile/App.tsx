// 야외봄 네이티브 홈에서 활동별 출발 판단, 추천 시간, 준비 정보를 한 화면에 제공한다.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  BackHandler,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View
} from "react-native";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as IntentLauncher from "expo-intent-launcher";
import { ACTIVITIES, ACTIVITY_ORDER, type ActivityKey } from "./src/lib/activities";
import {
  buildPreparationTips,
  fetchForecastSnapshot,
  getAirQualityCoverage,
  getCurrentForecastSnapshot,
  getForecastAvailability,
  getForecastFreshness,
  getRecommendationState,
  hasIncompleteCurrentSafetyData,
  hasIncompleteSafetyData,
  rescoreForecastSnapshot,
  type ForecastSnapshot
} from "./src/lib/forecast";
import {
  loadForecastSnapshot,
  loadSelectedActivity,
  saveForecastSnapshot,
  saveSelectedActivity
} from "./src/lib/storage";
import {
  cancelReminder,
  requestReminderPermission,
  scheduleReminder
} from "./src/lib/notifications";
import {
  createReminderDraft,
  isFutureReminder,
  LEAD_OPTIONS,
  loadReminders,
  saveReminders,
  type Reminder
} from "./src/lib/reminders";

type LocationState = "idle" | "requesting" | "granted" | "denied" | "unavailable";
type AppScreen = "home" | "alerts" | "settings";
type AppStyles = ReturnType<typeof createStyles>;

const SEOUL = { latitude: 37.5665, longitude: 126.978, locationName: "서울 기본값" };
const SUPPORT_URL = process.env.EXPO_PUBLIC_SUPPORT_URL ?? "https://robom.kr/support";
const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL ?? "https://robom.kr/privacy/outbom";
const OPEN_METEO_URL = "https://open-meteo.com/";
const OPEN_METEO_LICENSE_URL = "https://open-meteo.com/en/license";
const locationLabels: Record<LocationState, string> = {
  idle: "요청 전",
  requesting: "권한 확인 중",
  granted: "현재 위치 사용 가능",
  denied: "위치 권한 거부됨",
  unavailable: "위치 서비스 확인 필요"
};

const lightPalette = {
  background: "#fbf7ef",
  surface: "#ffffff",
  surfaceMuted: "#fbf8f2",
  surfaceAccent: "#eaf6f7",
  surfaceAccentSoft: "#f5fbfb",
  text: "#263c3d",
  textMuted: "#657475",
  textFaint: "#5f6d6e",
  accent: "#2f95a0",
  accentDark: "#1e6670",
  border: "#e8ded1",
  borderAccent: "#d7e7e7",
  inactive: "#c9c1b6"
};

const darkPalette = {
  background: "#152122",
  surface: "#1f2f30",
  surfaceMuted: "#273738",
  surfaceAccent: "#203c3f",
  surfaceAccentSoft: "#25393a",
  text: "#f4f7f4",
  textMuted: "#c0cccc",
  textFaint: "#9eacad",
  accent: "#69bdc4",
  accentDark: "#b6e8eb",
  border: "#394a4b",
  borderAccent: "#456064",
  inactive: "#718080"
};

function formatClock(value: string) {
  const match = value.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "시각 확인";
}

function formatWindow(start: string, end: string) {
  return `${formatClock(start)}–${formatClock(end)}`;
}

function formatSavedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "저장 시각 확인";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatNullable(value: number | null, suffix: string, digits = 0) {
  return value === null ? "미수신" : `${value.toFixed(digits)}${suffix}`;
}

function formatOptional(value: number | null | undefined, suffix: string, digits = 0) {
  return value === null || value === undefined ? "미수신" : `${value.toFixed(digits)}${suffix}`;
}

function formatVisibility(value: number | null | undefined) {
  if (value === null || value === undefined) return "미수신";
  if (value < 1_000) return `${Math.round(value)}m`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}km`;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("위치 확인 시간 초과")), milliseconds);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function Metric({ label, value, styles }: { label: string; value: string; styles: AppStyles }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  styles,
  secondary = false
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  styles: AppStyles;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        secondary ? styles.actionSecondary : styles.actionPrimary,
        pressed && !disabled ? styles.actionPressed : null,
        disabled ? styles.actionDisabled : null
      ]}
    >
      <Text style={secondary ? styles.actionSecondaryText : styles.actionPrimaryText}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const isDark = useColorScheme() === "dark";
  const palette = isDark ? darkPalette : lightPalette;
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [snapshot, setSnapshot] = useState<ForecastSnapshot | null>(null);
  const [activity, setActivity] = useState<ActivityKey>("walk");
  const [locationState, setLocationState] = useState<LocationState>("idle");
  const [feedback, setFeedback] = useState("마지막 예보를 불러오는 중이에요.");
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [screen, setScreen] = useState<AppScreen>("home");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [isReminderSheetOpen, setIsReminderSheetOpen] = useState(false);
  const requestSequence = useRef(0);
  const announcedForecastTime = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([loadForecastSnapshot(), loadSelectedActivity(), loadReminders()])
      .then(([stored, selected, storedReminders]) => {
        if (!active) return;
        const next = stored ? rescoreForecastSnapshot(stored, selected) : null;
        const storedNow = new Date();
        const activeStored = next ? getCurrentForecastSnapshot(next, storedNow) : null;
        const storedAvailability = next ? getForecastAvailability(next, storedNow) : null;
        setActivity(selected);
        setSnapshot(next);
        const futureReminders = storedReminders.filter((reminder) => isFutureReminder(reminder));
        setReminders(futureReminders);
        if (futureReminders.length !== storedReminders.length) void saveReminders(futureReminders);
        if (next && next !== stored) void saveForecastSnapshot(next);
        setFeedback(
          activeStored
            ? "저장된 마지막 판단을 보여드리고 있어요. 활동을 바꾸면 즉시 다시 계산해요."
            : next
              ? storedAvailability === "current-missing"
                ? "현재 시간의 저장 예보가 비어 있어 새 예보가 필요해요."
                : "저장된 예보 시간이 모두 지났어요. 새 예보를 확인해 주세요."
            : "현재 위치 또는 서울 기본 예보로 첫 판단을 확인해 보세요."
        );
      })
      .catch(() => {
        if (active) setFeedback("저장된 예보를 읽지 못했어요. 새 예보를 확인해 주세요.");
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    void Location.getForegroundPermissionsAsync().then((permission) => {
      if (!active) return;
      if (permission.granted) setLocationState("granted");
      else if (!permission.canAskAgain) setLocationState("denied");
    }).catch(() => {
      if (active) setLocationState("unavailable");
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || Platform.OS !== "ios") return;
    AccessibilityInfo.announceForAccessibility(feedback);
  }, [feedback, hydrated]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      setNow(new Date());
      void Location.getForegroundPermissionsAsync().then((permission) => {
        if (permission.granted) setLocationState("granted");
        else if (!permission.canAskAgain) setLocationState("denied");
        else setLocationState("idle");
      }).catch(() => setLocationState("unavailable"));
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  const refreshForecast = async (
    options: { latitude: number; longitude: number; locationName: string },
    activeRequest = ++requestSequence.current
  ) => {
    setLoading(true);
    setFeedback(`${options.locationName}의 ${ACTIVITIES[activity].label} 예보를 확인하고 있어요.`);
    try {
      const next = await fetchForecastSnapshot({ ...options, activity });
      if (activeRequest !== requestSequence.current) return;
      setSnapshot(next);
      const saved = await saveForecastSnapshot(next);
      if (activeRequest !== requestSequence.current) return;
      setFeedback(saved ? "새 출발 판단과 12시간 예보를 기기에 저장했어요." : "예보는 갱신했지만 기기 저장은 완료하지 못했어요.");
    } catch {
      if (activeRequest !== requestSequence.current) return;
      setFeedback(
        snapshot
          ? "네트워크를 확인하지 못해 저장된 마지막 판단을 유지해요."
          : "예보를 불러오지 못했어요. 연결 뒤 다시 시도해 주세요."
      );
    } finally {
      if (activeRequest === requestSequence.current) setLoading(false);
    }
  };

  const selectActivity = (nextActivity: ActivityKey) => {
    setActivity(nextActivity);
    void saveSelectedActivity(nextActivity);
    if (!snapshot) {
      setFeedback(`${ACTIVITIES[nextActivity].label}을 선택했어요. 위치 예보를 확인해 주세요.`);
      return;
    }
    const rescored = rescoreForecastSnapshot(snapshot, nextActivity);
    setSnapshot(rescored);
    void saveForecastSnapshot(rescored);
    setFeedback(`같은 예보를 ${ACTIVITIES[nextActivity].label} 기준으로 다시 계산했어요.`);
  };

  const requestCurrentLocation = async () => {
    const activeRequest = ++requestSequence.current;
    setLocationState("requesting");
    setFeedback("현재 위치 권한을 확인하고 있어요.");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (activeRequest !== requestSequence.current) return;
      if (!permission.granted) {
        setLocationState("denied");
        setFeedback(snapshot ? "위치 권한이 없어 저장된 마지막 판단을 유지해요." : "위치 권한 없이도 서울 기본 예보를 사용할 수 있어요.");
        return;
      }
      setFeedback("현재 위치를 찾고 있어요.");
      if (!(await Location.hasServicesEnabledAsync())) {
        if (activeRequest !== requestSequence.current) return;
        setLocationState("unavailable");
        setFeedback("기기 위치 서비스를 켜거나 서울 기본 예보를 이용해 주세요.");
        return;
      }
      const position = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        15_000
      );
      if (activeRequest !== requestSequence.current) return;
      setLocationState("granted");
      await refreshForecast({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        locationName: "현재 위치"
      }, activeRequest);
    } catch {
      if (activeRequest !== requestSequence.current) return;
      setLocationState("unavailable");
      setFeedback(snapshot ? "현재 위치를 확인하지 못해 저장된 마지막 판단을 유지해요." : "현재 위치를 확인하지 못했어요. 서울 기본 예보를 이용해 주세요.");
    }
  };

  const requestSeoulForecast = () => {
    setLocationState("idle");
    void refreshForecast(SEOUL);
  };

  const busy = !hydrated || loading || locationState === "requesting";
  const forecastAvailability = snapshot ? getForecastAvailability(snapshot, now) : null;
  const activeSnapshot = snapshot ? getCurrentForecastSnapshot(snapshot, now) : null;
  const preparationTips = activeSnapshot ? buildPreparationTips(activeSnapshot) : [];
  const airQualityCoverage = activeSnapshot ? getAirQualityCoverage(activeSnapshot) : null;
  const safetyDataIncomplete = activeSnapshot ? hasIncompleteSafetyData(activeSnapshot) : false;
  const currentSafetyDataIncomplete = activeSnapshot ? hasIncompleteCurrentSafetyData(activeSnapshot) : false;
  const freshness = snapshot ? getForecastFreshness(snapshot, now) : null;
  const isStale = freshness?.state === "stale";
  const isReferenceOnly = isStale || currentSafetyDataIncomplete;
  const recommendationState = activeSnapshot && !isStale ? getRecommendationState(activeSnapshot) : "limited";
  const dataWarning = !activeSnapshot
    ? null
    : airQualityCoverage !== "complete"
      ? `${airQualityCoverage === "missing"
        ? "대기질을 받지 못해 점수와 시간대는 날씨 기준 참고값이에요."
        : "대기질 일부 시간·항목이 누락돼 해당 시간대는 안전 추천에서 제외했어요."}${safetyDataIncomplete ? " 돌풍·가시거리·기상 상태·적설·주야간 정보가 누락된 시간대도 제외했어요." : ""}`
      : safetyDataIncomplete
        ? "돌풍·가시거리·기상 상태·적설·주야간 정보가 누락된 시간대는 안전 추천에서 제외했어요."
        : null;
  const activeForecastTime = activeSnapshot?.forecastTime ?? null;

  const goHome = () => {
    setScreen("home");
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
  };

  const openRobomHome = () => {
    void Linking.openURL("https://robom.kr/").catch(() => setFeedback("로봄 홈페이지를 열지 못했어요. 연결을 확인해 주세요."));
  };

  const openBatterySettings = () => {
    if (Platform.OS !== "android") {
      setFeedback("iPhone·iPad에서는 설정 앱 → 야외봄 → 알림에서 알림 허용 상태를 확인해 주세요.");
      return;
    }
    void IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
      .catch(() => setFeedback("기기 설정 → 배터리 → 앱 배터리 사용량에서 야외봄의 제한 상태를 확인해 주세요."));
  };

  const removeReminder = async (reminder: Reminder) => {
    try {
      await cancelReminder(reminder.notificationId);
    } catch {
      // 기기에서 이미 지나가거나 삭제된 예약은 로컬 목록만 정리한다.
    }
    const next = reminders.filter((item) => item.id !== reminder.id);
    setReminders(next);
    if (!(await saveReminders(next))) setFeedback("알림 목록 저장을 마치지 못했어요. 다시 한 번 확인해 주세요.");
    else setFeedback("출발 알림을 껐어요.");
  };

  const saveReminder = async (leadMinutes: number) => {
    if (!activeSnapshot) {
      setFeedback("새 예보를 확인한 뒤 추천 시간 알림을 설정할 수 있어요.");
      setIsReminderSheetOpen(false);
      return;
    }
    const targetAt = new Date(activeSnapshot.bestTime);
    const targetLabel = `${ACTIVITIES[activity].label} 추천 시간 ${formatClock(activeSnapshot.bestTime)}`;
    const triggerAt = new Date(targetAt.getTime() - leadMinutes * 60_000);
    if (Number.isNaN(targetAt.getTime()) || triggerAt.getTime() <= now.getTime()) {
      setFeedback("이미 지난 추천 시간이에요. 새 예보를 확인한 뒤 다시 설정해 주세요.");
      return;
    }

    try {
      if (!(await requestReminderPermission())) {
        setFeedback("알림 권한이 허용되지 않았어요. 설정에서 야외봄 알림을 허용한 뒤 다시 설정해 주세요.");
        return;
      }
      const notificationId = await scheduleReminder(triggerAt, targetLabel);
      const draft = createReminderDraft(targetAt, targetLabel, leadMinutes, notificationId);
      if (!draft) {
        await cancelReminder(notificationId);
        setFeedback("이미 지난 시간이라 알림을 설정할 수 없어요.");
        return;
      }
      const matching = reminders.filter((reminder) => reminder.targetAt === draft.targetAt && reminder.targetLabel === draft.targetLabel);
      await Promise.all(matching.map((reminder) => cancelReminder(reminder.notificationId).catch(() => undefined)));
      const next = [draft, ...reminders.filter((reminder) => !matching.includes(reminder))].filter((reminder) => isFutureReminder(reminder));
      setReminders(next);
      if (!(await saveReminders(next))) {
        await cancelReminder(notificationId);
        setReminders(reminders);
        setFeedback("기기 알림 목록을 저장하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      setIsReminderSheetOpen(false);
      setScreen("alerts");
      setFeedback(`${targetLabel} 알림을 ${LEAD_OPTIONS.find((option) => option.minutes === leadMinutes)?.label ?? "선택한 시각"}으로 저장했어요.`);
    } catch {
      setFeedback("기기 알림을 예약하지 못했어요. 알림 권한과 배터리 제한 상태를 확인해 주세요.");
    }
  };

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (screen !== "home") {
        goHome();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [screen]);

  useEffect(() => {
    if (!hydrated || Platform.OS !== "ios") return;
    const previous = announcedForecastTime.current;
    announcedForecastTime.current = activeForecastTime;
    if (!previous || previous === activeForecastTime) return;
    AccessibilityInfo.announceForAccessibility(
      activeForecastTime
        ? `시간이 지나 ${formatClock(activeForecastTime)} 예보 기준으로 판단을 갱신했어요.`
        : forecastAvailability === "current-missing"
          ? "현재 시간의 저장 예보가 비어 있어 새 예보가 필요해요."
          : "저장된 예보 시간이 모두 지났어요. 새 예보를 확인해 주세요."
    );
  }, [activeForecastTime, forecastAvailability, hydrated]);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
        <StatusBar style={isDark ? "light" : "dark"} />
        <ScrollView ref={scrollRef} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="야외봄 홈으로 돌아가기" onPress={goHome} style={styles.brandButton}>
            <Image accessible={false} accessibilityIgnoresInvertColors source={require("./assets/icon.png")} style={styles.logo} />
            <View style={styles.headerCopy}>
              <Text accessibilityRole="header" style={styles.wordmark}><Text style={styles.wordmarkPrefix}>야외</Text><Text style={styles.wordmarkBom}>봄</Text></Text>
              <Text style={styles.tagline}>robom · 바깥바람이 좋은 때</Text>
            </View>
          </Pressable>
          <Pressable accessibilityRole="link" accessibilityLabel="로봄 홈페이지 열기" onPress={openRobomHome} style={styles.robomHomeButton}>
            <Text style={styles.robomHomeText}>로봄 홈</Text>
          </Pressable>
        </View>

        {screen === "home" ? <>
        <View>
          <Text accessibilityRole="header" style={styles.sectionLabel}>무엇을 하러 나가나요?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activityList}>
            {ACTIVITY_ORDER.map((key) => {
              const selected = key === activity;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: busy }}
                  accessibilityLabel={`${ACTIVITIES[key].label} 기준 선택`}
                  disabled={busy}
                  onPress={() => selectActivity(key)}
                  style={({ pressed }) => [
                    styles.activityChip,
                    selected ? styles.activityChipSelected : null,
                    pressed && !busy ? styles.actionPressed : null,
                    busy ? styles.actionDisabled : null
                  ]}
                >
                  <Text style={selected ? styles.activityTextSelected : styles.activityText}>{ACTIVITIES[key].label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {activeSnapshot ? (
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.heroCopy}>
                <Text style={[styles.eyebrow, freshness?.state === "stale" ? styles.warningText : null]}>
                  {activeSnapshot.locationName} · {formatClock(activeSnapshot.forecastTime)} 예보 · {freshness?.label}
                </Text>
                <Text accessibilityRole="header" style={styles.judgment}>
                  {isStale
                    ? "저장된 예보는 참고만 하세요"
                    : currentSafetyDataIncomplete
                      ? "현재 안전 자료가 부족해 참고만 하세요"
                      : activeSnapshot.judgment}
                </Text>
              </View>
              <View accessible accessibilityLabel={`${isReferenceOnly ? "참고" : "현재 활동"} 점수 ${activeSnapshot.score}점`} style={styles.scoreBadge}>
                <Text style={styles.scoreValue}>{activeSnapshot.score}</Text>
                <Text style={styles.scoreUnit}>점</Text>
              </View>
            </View>
            <Text style={styles.detail}>
              {isStale
                ? "이 점수와 시간대는 저장 당시 자료라 현재 출발 판단에는 사용할 수 없어요."
                : currentSafetyDataIncomplete
                  ? "필수 안전 자료가 빠져 날씨로만 계산한 참고 점수이며 지금 출발 추천으로 확정하지 않아요."
                  : activeSnapshot.detail}
            </Text>
            {dataWarning ? <Text accessibilityRole="alert" style={styles.dataWarning}>{dataWarning}</Text> : null}
            <View style={styles.bestWindow}>
              <View>
                <Text style={styles.bestLabel}>
                  {isStale ? "오래된 저장 예보 중 가장 나았던 시간" : recommendationState === "recommended" ? "앞으로 12시간 중 추천" : "안전한 추천 구간이 없어 가장 나은 시간"}
                </Text>
                <Text style={styles.bestValue}>{formatWindow(activeSnapshot.bestTime, activeSnapshot.bestEndTime)}</Text>
              </View>
              <Text style={styles.bestScore}>{activeSnapshot.bestScore}점</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isStale || currentSafetyDataIncomplete }}
              disabled={isStale || currentSafetyDataIncomplete}
              onPress={() => setIsReminderSheetOpen(true)}
              style={({ pressed }) => [styles.reminderCallout, pressed && !isStale && !currentSafetyDataIncomplete ? styles.actionPressed : null, isStale || currentSafetyDataIncomplete ? styles.actionDisabled : null]}
            >
              <View style={styles.reminderCopy}>
                <Text style={styles.reminderTitle}>🔔 {formatClock(activeSnapshot.bestTime)} 출발 알림</Text>
                <Text style={styles.reminderDetail}>{isStale || currentSafetyDataIncomplete ? "안전한 최신 예보를 확인한 뒤 알림을 설정할 수 있어요." : "추천 시간 전에 기기 알림으로 준비를 알려드려요."}</Text>
              </View>
              <Text style={styles.reminderActionText}>설정</Text>
            </Pressable>
            {activeSnapshot.sunrise || activeSnapshot.sunset ? (
              <Text style={styles.sunTimes}>
                {activeSnapshot.sunrise ? `일출 ${formatClock(activeSnapshot.sunrise)}` : "일출 미수신"}
                {" · "}
                {activeSnapshot.sunset ? `일몰 ${formatClock(activeSnapshot.sunset)}` : "일몰 미수신"}
                {activity === "hike" ? " · 산행은 일몰 1–2시간 전에 마무리하세요." : ""}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text accessibilityRole="header" style={styles.emptyTitle}>
              {snapshot
                ? forecastAvailability === "current-missing"
                  ? "현재 시간 예보가 비어 있어요"
                  : "저장된 예보 시간이 모두 지났어요"
                : "저장된 출발 판단이 아직 없어요"}
            </Text>
            <Text style={styles.detail}>
              {snapshot
                ? forecastAvailability === "current-missing"
                  ? "다음 시간 예보를 현재 조건으로 대신 보여주지 않아요. 새 예보를 확인해 주세요."
                  : "현재 위치나 서울 기본값으로 새 예보를 확인해 주세요."
                : "현재 위치나 서울 기본값으로 한 번 확인하면 마지막 성공 예보를 오프라인에서도 볼 수 있어요."}
            </Text>
          </View>
        )}

        {activeSnapshot ? (
          <View style={styles.sourceCredit}>
            <Text style={styles.sourceCreditText}>Weather data by</Text>
            <Pressable accessibilityLabel="예보 원자료 Open-Meteo.com 열기" accessibilityRole="link" onPress={() => void Linking.openURL(OPEN_METEO_URL).catch(() => undefined)} style={styles.sourceCreditLinkButton}>
              <Text style={styles.sourceCreditLink}>Open-Meteo.com</Text>
            </Pressable>
            <Text style={styles.sourceCreditText}>·</Text>
            <Pressable accessibilityLabel="Open-Meteo CC BY 4.0 라이선스 열기" accessibilityRole="link" onPress={() => void Linking.openURL(OPEN_METEO_LICENSE_URL).catch(() => undefined)} style={styles.sourceCreditLinkButton}>
              <Text style={styles.sourceCreditLink}>CC BY 4.0</Text>
            </Pressable>
            <Text style={styles.sourceCreditText}>· 야외봄 재계산</Text>
          </View>
        ) : null}

        {snapshot && freshness?.state !== "fresh" ? (
          <View accessibilityRole="alert" style={[styles.freshnessBanner, freshness?.state === "stale" ? styles.freshnessBannerStale : null]}>
            <View style={styles.freshnessCopy}>
              <Text style={styles.freshnessTitle}>
                {freshness?.state === "stale" ? "저장된 예보가 오래됐어요" : "새 예보를 확인할 때가 됐어요"}
              </Text>
              <Text style={styles.freshnessDetail}>위치를 다시 확인하기 전까지는 저장된 결과를 참고용으로만 보여드려요.</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => void requestCurrentLocation()}
              style={({ pressed }) => [styles.freshnessAction, pressed && !busy ? styles.actionPressed : null, busy ? styles.actionDisabled : null]}
            >
              <Text style={styles.freshnessActionText}>새 예보 확인</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.locationTop}>
            <View>
              <Text accessibilityRole="header" style={styles.cardTitle}>예보 확인</Text>
              <Text style={styles.locationState}>{locationLabels[locationState]}</Text>
            </View>
            <View style={[styles.statusDot, locationState === "granted" ? styles.statusDotOn : null]} />
          </View>
          <View style={styles.actions}>
            <ActionButton label="현재 위치로 확인" disabled={busy} styles={styles} onPress={() => void requestCurrentLocation()} />
            <ActionButton label="서울 기본 예보" secondary disabled={!hydrated} styles={styles} onPress={requestSeoulForecast} />
          </View>
          {(locationState === "denied" || locationState === "unavailable") ? (
            <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings().catch(() => undefined)} style={styles.settingsButton}>
              <Text style={styles.settingsButtonText}>기기 위치 설정 열기</Text>
            </Pressable>
          ) : null}
          {busy ? <ActivityIndicator color={palette.accent} /> : null}
          <Text style={styles.caption}>위치는 이 버튼을 누를 때 예보 제공처로만 전송하며, 좌표는 앱에 저장하지 않아요.</Text>
        </View>

        {activeSnapshot ? (
          <>
            <View style={styles.card}>
              <View style={styles.cardHeadingRow}>
                <Text accessibilityRole="header" style={styles.cardTitle}>{isStale ? "저장된 시간 흐름" : "12시간 흐름"}</Text>
                <Text style={styles.cardMeta}>2시간 추천 구간 반영</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeline}>
                {activeSnapshot.slots.slice(0, 12).map((slot, index) => (
                  <View
                    key={slot.time}
                    accessible
                    accessibilityLabel={`${formatClock(slot.time)}, ${slot.score}점, 체감 ${Math.round(slot.apparentTemperature)}도, ${slot.isDay === false ? "밤" : slot.isDay === true ? "낮" : "시간대 미수신"}, ${slot.precipitationProbability === null ? `강수량 ${slot.precipitation.toFixed(1)}밀리미터` : `비 올 확률 ${Math.round(slot.precipitationProbability)}퍼센트`}`}
                    style={[styles.timelineItem, index === 0 ? styles.timelineItemCurrent : null]}
                  >
                    <Text style={styles.timelineTime}>{formatClock(slot.time)}</Text>
                    <Text style={styles.timelineScore}>{slot.score}</Text>
                    <Text style={styles.timelineTemp}>{Math.round(slot.apparentTemperature)}°</Text>
                    <Text style={styles.timelineDaylight}>{slot.isDay === false ? "밤" : slot.isDay === true ? "낮" : "시간 확인"}</Text>
                    <Text style={styles.timelineRain}>{slot.precipitationProbability === null ? `${slot.precipitation.toFixed(1)}mm` : `비 ${Math.round(slot.precipitationProbability)}%`}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeadingRow}>
                <Text accessibilityRole="header" style={styles.cardTitle}>
                  {isStale ? "저장 당시 조건" : currentSafetyDataIncomplete ? "현재 참고 조건" : "현재 조건"}
                </Text>
                <Text style={styles.cardMeta}>{formatSavedAt(activeSnapshot.generatedAt)} 저장</Text>
              </View>
              <View style={styles.metrics}>
                <Metric label="기온" value={`${Math.round(activeSnapshot.metrics.temperature)}°`} styles={styles} />
                <Metric label="체감" value={`${Math.round(activeSnapshot.metrics.apparentTemperature)}°`} styles={styles} />
                <Metric label="비" value={activeSnapshot.metrics.precipitationProbability === null ? `${activeSnapshot.metrics.precipitation.toFixed(1)}mm` : `${Math.round(activeSnapshot.metrics.precipitationProbability)}%`} styles={styles} />
                <Metric label="바람" value={`${activeSnapshot.metrics.windSpeed.toFixed(1)}m/s`} styles={styles} />
                <Metric label="돌풍" value={formatOptional(activeSnapshot.metrics.windGust, "m/s", 1)} styles={styles} />
                <Metric label="가시거리" value={formatVisibility(activeSnapshot.metrics.visibility)} styles={styles} />
                <Metric label="자외선" value={activeSnapshot.metrics.uvIndex.toFixed(1)} styles={styles} />
                <Metric label="습도" value={formatNullable(activeSnapshot.metrics.relativeHumidity, "%")} styles={styles} />
                <Metric label="초미세먼지" value={formatNullable(activeSnapshot.metrics.pm25, "㎍/㎥", 1)} styles={styles} />
                <Metric label="미세먼지" value={formatNullable(activeSnapshot.metrics.pm10, "㎍/㎥", 1)} styles={styles} />
                <Metric label="시간대" value={activeSnapshot.metrics.isDay === false ? "밤" : activeSnapshot.metrics.isDay === true ? "낮" : "미수신"} styles={styles} />
              </View>
              <Text style={styles.caption}>체감온도·강수·바람·가시거리·자외선·습도·대기질을 선택한 활동 기준으로 함께 계산해요.</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeadingRow}>
                <Text accessibilityRole="header" style={styles.cardTitle}>나가기 전 준비</Text>
                <Text style={styles.cardMeta}>{formatWindow(activeSnapshot.bestTime, activeSnapshot.bestEndTime)} 기준</Text>
              </View>
              {preparationTips.map((tip, index) => (
                <View key={tip} style={styles.tipRow}>
                  <Text style={styles.tipNumber}>{index + 1}</Text>
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View accessibilityLiveRegion="polite" style={styles.feedback}>
          <Text style={styles.feedbackText}>{feedback}</Text>
        </View>

        <Text style={styles.footer}>권한 거부·오프라인에서도 저장된 판단은 계속 열립니다. 백그라운드 위치, 광고, 추적 기능은 사용하지 않습니다.</Text>
        <Text style={styles.footer}>날씨·대기질 원자료를 야외봄이 활동별로 재계산한 참고 정보예요. 실제 현장 안내와 안전 판단을 우선하세요.</Text>
          <View style={styles.footerLinks}>
          <Pressable accessibilityLabel="날씨와 대기질 원자료 Open-Meteo 열기" accessibilityRole="link" onPress={() => void Linking.openURL(OPEN_METEO_URL).catch(() => undefined)} style={styles.footerLinkButton}>
            <Text style={styles.footerLink}>원자료 Open-Meteo</Text>
          </Pressable>
          <Pressable accessibilityLabel="Open-Meteo CC BY 4.0 라이선스 열기" accessibilityRole="link" onPress={() => void Linking.openURL(OPEN_METEO_LICENSE_URL).catch(() => undefined)} style={styles.footerLinkButton}>
            <Text style={styles.footerLink}>CC BY 4.0</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(SUPPORT_URL).catch(() => undefined)} style={styles.footerLinkButton}>
            <Text style={styles.footerLink}>지원</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => undefined)} style={styles.footerLinkButton}>
            <Text style={styles.footerLink}>개인정보 처리방침</Text>
          </Pressable>
          </View>
        </> : screen === "alerts" ? (
          <AlertsScreen
            reminders={reminders}
            styles={styles}
            onOpenReminder={() => setIsReminderSheetOpen(true)}
            onRemove={(reminder) => void removeReminder(reminder)}
            onOpenSettings={() => void Linking.openSettings().catch(() => setFeedback("기기 설정을 열지 못했어요."))}
            onOpenBatterySettings={openBatterySettings}
          />
        ) : (
          <SettingsScreen
            styles={styles}
            onOpenRobomHome={openRobomHome}
            onOpenSettings={() => void Linking.openSettings().catch(() => setFeedback("기기 설정을 열지 못했어요."))}
            onOpenBatterySettings={openBatterySettings}
          />
        )}
        <View style={styles.bottomNav} accessibilityRole="tablist">
          <NavButton label="오늘" icon="☀︎" active={screen === "home"} styles={styles} onPress={goHome} />
          <NavButton label="알림" icon="🔔" active={screen === "alerts"} styles={styles} onPress={() => setScreen("alerts")} />
          <NavButton label="설정" icon="⚙︎" active={screen === "settings"} styles={styles} onPress={() => setScreen("settings")} />
        </View>
        </ScrollView>
        <ReminderSheet
          key={`${activeSnapshot?.bestTime ?? "none"}-${isReminderSheetOpen ? "open" : "closed"}`}
          visible={isReminderSheetOpen}
          targetTime={activeSnapshot?.bestTime ?? null}
          activityLabel={ACTIVITIES[activity].label}
          now={now}
          styles={styles}
          onClose={() => setIsReminderSheetOpen(false)}
          onSave={(leadMinutes) => void saveReminder(leadMinutes)}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function NavButton({
  label,
  icon,
  active,
  styles,
  onPress
}: {
  label: string;
  icon: string;
  active: boolean;
  styles: AppStyles;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label} 탭`}
      onPress={onPress}
      style={({ pressed }) => [styles.navButton, active ? styles.navButtonActive : null, pressed ? styles.actionPressed : null]}
    >
      <Text style={active ? styles.navIconActive : styles.navIcon}>{icon}</Text>
      <Text style={active ? styles.navLabelActive : styles.navLabel}>{label}</Text>
    </Pressable>
  );
}

function AlertsScreen({
  reminders,
  styles,
  onOpenReminder,
  onRemove,
  onOpenSettings,
  onOpenBatterySettings
}: {
  reminders: Reminder[];
  styles: AppStyles;
  onOpenReminder: () => void;
  onRemove: (reminder: Reminder) => void;
  onOpenSettings: () => void;
  onOpenBatterySettings: () => void;
}) {
  return (
    <>
      <View style={styles.screenHeading}>
        <Text accessibilityRole="header" style={styles.screenTitle}>출발 알림</Text>
        <Text style={styles.screenDescription}>추천 시간 전에 한 번만 알려드려요. 새 예보를 확인하면 원하는 시간으로 다시 설정할 수 있어요.</Text>
      </View>
      {reminders.length ? reminders.map((reminder) => (
        <View key={reminder.id} style={styles.card}>
          <Text style={styles.cardTitle}>{reminder.targetLabel}</Text>
          <Text style={styles.reminderListTime}>{new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(reminder.triggerAt))} 알림</Text>
          <Text style={styles.caption}>{LEAD_OPTIONS.find((option) => option.minutes === reminder.leadMinutes)?.label ?? "선택한 시각"}에 기기 알림으로 알려드려요.</Text>
          <Pressable accessibilityRole="button" onPress={() => onRemove(reminder)} style={styles.settingsButton}>
            <Text style={styles.settingsButtonText}>이 알림 끄기</Text>
          </Pressable>
        </View>
      )) : (
        <View style={styles.emptyCard}>
          <Text accessibilityRole="header" style={styles.emptyTitle}>설정된 출발 알림이 없어요</Text>
          <Text style={styles.detail}>오늘 탭에서 최신 예보를 확인한 뒤, 추천 시간 알림을 설정해 보세요.</Text>
        </View>
      )}
      <Pressable accessibilityRole="button" onPress={onOpenReminder} style={styles.primaryWideButton}>
        <Text style={styles.actionPrimaryText}>추천 시간 알림 설정</Text>
      </Pressable>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>알림이 오지 않을 때</Text>
        <Text style={styles.detail}>알림 권한은 기기 설정에서 직접 바꿀 수 있어요. 일부 Android 기기는 절전·배터리 제한 상태에서 알림이 지연될 수 있어요.</Text>
        <Pressable accessibilityRole="button" onPress={onOpenSettings} style={styles.settingsButton}>
          <Text style={styles.settingsButtonText}>야외봄 알림 설정 열기</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onOpenBatterySettings} style={styles.settingsButton}>
          <Text style={styles.settingsButtonText}>배터리 제한 상태 확인하기</Text>
        </Pressable>
      </View>
    </>
  );
}

function SettingsScreen({
  styles,
  onOpenRobomHome,
  onOpenSettings,
  onOpenBatterySettings
}: {
  styles: AppStyles;
  onOpenRobomHome: () => void;
  onOpenSettings: () => void;
  onOpenBatterySettings: () => void;
}) {
  return (
    <>
      <View style={styles.screenHeading}>
        <Text accessibilityRole="header" style={styles.screenTitle}>설정과 앱 정보</Text>
        <Text style={styles.screenDescription}>야외봄은 현재 위치의 날씨·대기질을 활동별로 읽기 쉽게 정리하는 로봄 앱이에요.</Text>
      </View>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>알림과 배터리</Text>
        <Text style={styles.detail}>기기 알림은 사용자가 허용한 경우에만 보내요. 야외봄은 배터리 예외를 자동으로 요청하거나 변경하지 않아요.</Text>
        <Pressable accessibilityRole="button" onPress={onOpenSettings} style={styles.settingsButton}>
          <Text style={styles.settingsButtonText}>야외봄 알림 설정 열기</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onOpenBatterySettings} style={styles.settingsButton}>
          <Text style={styles.settingsButtonText}>배터리 제한 상태 확인하기</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>위치와 개인정보</Text>
        <Text style={styles.detail}>현재 위치는 사용자가 예보 확인을 누를 때만 사용하며, 좌표는 앱에 저장하지 않아요. 백그라운드 위치·광고·추적 기능은 사용하지 않아요.</Text>
        <Pressable accessibilityRole="button" onPress={onOpenSettings} style={styles.settingsButton}>
          <Text style={styles.settingsButtonText}>기기 위치 설정 열기</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>로봄 앱</Text>
        <Text style={styles.detail}>야외봄의 봄 마크는 로봄 앱 패밀리를 나타냅니다. 로봄 홈페이지에서 다른 앱도 확인할 수 있어요.</Text>
        <Pressable accessibilityRole="link" onPress={onOpenRobomHome} style={styles.settingsButton}>
          <Text style={styles.settingsButtonText}>robom.kr 열기</Text>
        </Pressable>
      </View>
    </>
  );
}

function ReminderSheet({
  visible,
  targetTime,
  activityLabel,
  now,
  styles,
  onClose,
  onSave
}: {
  visible: boolean;
  targetTime: string | null;
  activityLabel: string;
  now: Date;
  styles: AppStyles;
  onClose: () => void;
  onSave: (leadMinutes: number) => void;
}) {
  const [leadMinutes, setLeadMinutes] = useState(10);
  const isPast = !targetTime || new Date(targetTime).getTime() - leadMinutes * 60_000 <= now.getTime();

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalBackdrop}>
        <View accessibilityViewIsModal style={styles.modalSheet}>
          <View style={styles.sheetGrip} />
          <View style={styles.sheetHeader}>
            <View>
              <Text accessibilityRole="header" style={styles.sheetTitle}>출발 알림 설정</Text>
              <Text style={styles.sheetDescription}>{targetTime ? `${activityLabel} 추천 시간 ${formatClock(targetTime)}` : "새 예보를 먼저 확인해 주세요."}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="알림 설정 닫기" onPress={onClose} style={styles.sheetClose}>
              <Text style={styles.sheetCloseText}>닫기</Text>
            </Pressable>
          </View>
          <Text style={styles.sheetQuestion}>언제 알려드릴까요?</Text>
          <View style={styles.leadOptions}>
            {LEAD_OPTIONS.map((option) => (
              <Pressable
                key={option.minutes}
                accessibilityRole="button"
                accessibilityState={{ selected: leadMinutes === option.minutes }}
                onPress={() => setLeadMinutes(option.minutes)}
                style={({ pressed }) => [styles.leadButton, leadMinutes === option.minutes ? styles.leadButtonSelected : null, pressed ? styles.actionPressed : null]}
              >
                <Text style={leadMinutes === option.minutes ? styles.leadButtonTextSelected : styles.leadButtonText}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.sheetNote}>알림을 저장할 때만 기기 알림 권한을 요청합니다. Android 제조사 절전 설정에 따라 약간 늦어질 수 있어요.</Text>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: isPast }} disabled={isPast} onPress={() => onSave(leadMinutes)} style={({ pressed }) => [styles.primaryWideButton, isPast ? styles.actionDisabled : null, pressed && !isPast ? styles.actionPressed : null]}>
            <Text style={styles.actionPrimaryText}>{isPast ? "이미 지난 시간이에요" : "기기 알림 저장"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(palette: typeof lightPalette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.background },
    page: { width: "100%", maxWidth: 760, alignSelf: "center", gap: 16, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 40 },
    header: { minHeight: 72, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    brandButton: { minHeight: 62, flex: 1, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 20 },
    logo: { width: 52, height: 52, borderRadius: 18 },
    headerCopy: { flex: 1 },
    wordmark: { color: palette.text, fontSize: 28, fontWeight: "900", letterSpacing: -1 },
    wordmarkPrefix: { color: palette.text, fontWeight: "900" },
    wordmarkBom: { color: palette.accent, fontWeight: "900" },
    tagline: { marginTop: 2, color: palette.textMuted, fontSize: 13 },
    robomHomeButton: { minHeight: 48, justifyContent: "center", paddingHorizontal: 10, borderRadius: 14, backgroundColor: palette.surfaceAccentSoft },
    robomHomeText: { color: palette.accentDark, fontSize: 12, fontWeight: "900" },
    sectionLabel: { marginBottom: 9, color: palette.text, fontSize: 15, fontWeight: "900" },
    activityList: { gap: 8, paddingRight: 6 },
    activityChip: { minHeight: 48, justifyContent: "center", paddingHorizontal: 17, borderWidth: 1, borderColor: palette.border, borderRadius: 999, backgroundColor: palette.surface },
    activityChipSelected: { borderColor: palette.accent, backgroundColor: palette.surfaceAccent },
    activityText: { color: palette.textMuted, fontSize: 14, fontWeight: "800" },
    activityTextSelected: { color: palette.accentDark, fontSize: 14, fontWeight: "900" },
    eyebrow: { color: palette.textMuted, fontSize: 12, fontWeight: "700" },
    warningText: { color: palette.accentDark, fontWeight: "900" },
    locationState: { marginTop: 4, color: palette.textMuted, fontSize: 13, fontWeight: "700" },
    statusDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: palette.inactive },
    statusDotOn: { backgroundColor: palette.accent },
    hero: { gap: 14, padding: 20, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.borderAccent, borderRadius: 26 },
    heroTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
    heroCopy: { flex: 1 },
    judgment: { marginTop: 7, color: palette.text, fontSize: 25, lineHeight: 32, fontWeight: "900", letterSpacing: -0.8 },
    scoreBadge: { minWidth: 68, minHeight: 68, flexDirection: "row", alignItems: "baseline", justifyContent: "center", padding: 13, borderRadius: 22, backgroundColor: palette.surfaceAccent },
    scoreValue: { color: palette.accentDark, fontSize: 28, fontWeight: "900" },
    scoreUnit: { color: palette.accentDark, fontSize: 12, fontWeight: "800" },
    detail: { color: palette.textMuted, fontSize: 14, lineHeight: 22 },
    dataWarning: { color: palette.accentDark, fontSize: 12, lineHeight: 18, fontWeight: "800" },
    sourceCredit: { minHeight: 48, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: 5, paddingHorizontal: 8 },
    sourceCreditText: { color: palette.textFaint, fontSize: 11, lineHeight: 17 },
    sourceCreditLinkButton: { minHeight: 48, justifyContent: "center" },
    sourceCreditLink: { color: palette.accentDark, fontSize: 11, fontWeight: "800", textDecorationLine: "underline" },
    bestWindow: { minHeight: 64, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 14, backgroundColor: palette.surfaceAccentSoft, borderRadius: 16 },
    bestLabel: { color: palette.textMuted, fontSize: 12, fontWeight: "700" },
    bestValue: { marginTop: 4, color: palette.accentDark, fontSize: 16, fontWeight: "900" },
    bestScore: { color: palette.accentDark, fontSize: 16, fontWeight: "900" },
    reminderCallout: { minHeight: 68, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 14, borderRadius: 17, backgroundColor: isLightPalette(palette) ? "#e2f1eb" : palette.surfaceAccent },
    reminderCopy: { flex: 1 },
    reminderTitle: { color: palette.text, fontSize: 14, fontWeight: "900" },
    reminderDetail: { marginTop: 3, color: palette.textMuted, fontSize: 11, lineHeight: 16 },
    reminderActionText: { color: palette.accentDark, fontSize: 13, fontWeight: "900", textDecorationLine: "underline" },
    sunTimes: { color: palette.textMuted, fontSize: 12, lineHeight: 18, fontWeight: "700" },
    emptyCard: { gap: 8, padding: 20, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 24 },
    emptyTitle: { color: palette.text, fontSize: 20, fontWeight: "900" },
    freshnessBanner: { minHeight: 84, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 14, borderWidth: 1, borderColor: palette.borderAccent, borderRadius: 20, backgroundColor: palette.surfaceAccentSoft },
    freshnessBannerStale: { borderColor: palette.accent, backgroundColor: palette.surfaceAccent },
    freshnessCopy: { flex: 1 },
    freshnessTitle: { color: palette.text, fontSize: 14, fontWeight: "900" },
    freshnessDetail: { marginTop: 4, color: palette.textMuted, fontSize: 11, lineHeight: 16 },
    freshnessAction: { minHeight: 48, justifyContent: "center", paddingHorizontal: 13, borderRadius: 15, backgroundColor: isLightPalette(palette) ? palette.accentDark : palette.accent },
    freshnessActionText: { color: isLightPalette(palette) ? "#ffffff" : "#102526", fontSize: 12, fontWeight: "900" },
    card: { gap: 14, padding: 18, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 24 },
    cardTitle: { color: palette.text, fontSize: 18, fontWeight: "900" },
    cardHeadingRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
    cardMeta: { flexShrink: 1, color: palette.textFaint, fontSize: 11, textAlign: "right" },
    locationTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    metrics: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 },
    metric: { width: "48.7%", minHeight: 70, justifyContent: "center", paddingHorizontal: 13, backgroundColor: palette.surfaceMuted, borderRadius: 16 },
    metricLabel: { color: palette.textFaint, fontSize: 11, fontWeight: "700" },
    metricValue: { marginTop: 5, color: palette.text, fontSize: 16, fontWeight: "900" },
    caption: { color: palette.textFaint, fontSize: 11, lineHeight: 17 },
    actions: { gap: 9 },
    action: { minHeight: 54, alignItems: "center", justifyContent: "center", borderRadius: 17 },
    actionPrimary: { backgroundColor: isLightPalette(palette) ? palette.accentDark : palette.accent },
    actionSecondary: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.borderAccent },
    actionPressed: { opacity: 0.75 },
    actionDisabled: { opacity: 0.5 },
    actionPrimaryText: { color: isLightPalette(palette) ? "#ffffff" : "#102526", fontSize: 15, fontWeight: "900" },
    actionSecondaryText: { color: palette.accentDark, fontSize: 15, fontWeight: "900" },
    settingsButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: palette.surfaceAccentSoft },
    settingsButtonText: { color: palette.accentDark, fontSize: 13, fontWeight: "900", textDecorationLine: "underline" },
    timeline: { gap: 8, paddingRight: 4 },
    timelineItem: { minWidth: 82, minHeight: 128, justifyContent: "center", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 17, backgroundColor: palette.surfaceMuted },
    timelineItemCurrent: { borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.surfaceAccent },
    timelineTime: { color: palette.textMuted, fontSize: 11, fontWeight: "800" },
    timelineScore: { color: palette.accentDark, fontSize: 24, fontWeight: "900" },
    timelineTemp: { color: palette.text, fontSize: 13, fontWeight: "800" },
    timelineDaylight: { color: palette.textMuted, fontSize: 10, fontWeight: "800" },
    timelineRain: { color: palette.textFaint, fontSize: 10, fontWeight: "700" },
    tipRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 },
    tipNumber: { width: 28, height: 28, lineHeight: 28, overflow: "hidden", borderRadius: 14, color: palette.accentDark, backgroundColor: palette.surfaceAccent, fontSize: 12, fontWeight: "900", textAlign: "center" },
    tipText: { flex: 1, color: palette.textMuted, fontSize: 14, lineHeight: 21 },
    feedback: { minHeight: 52, justifyContent: "center", paddingHorizontal: 15, backgroundColor: palette.surfaceAccent, borderRadius: 17 },
    feedbackText: { color: palette.accentDark, fontSize: 13, lineHeight: 19, fontWeight: "700" },
    footer: { paddingHorizontal: 5, color: palette.textFaint, fontSize: 11, lineHeight: 18, textAlign: "center" },
    footerLinks: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
    footerLinkButton: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14 },
    footerLink: { color: palette.accentDark, fontSize: 13, fontWeight: "800", textDecorationLine: "underline" },
    screenHeading: { gap: 7, paddingTop: 12, paddingBottom: 4 },
    screenTitle: { color: palette.text, fontSize: 26, fontWeight: "900", letterSpacing: -0.7 },
    screenDescription: { color: palette.textMuted, fontSize: 14, lineHeight: 22 },
    reminderListTime: { color: palette.accentDark, fontSize: 17, fontWeight: "900" },
    primaryWideButton: { minHeight: 54, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: 17, backgroundColor: isLightPalette(palette) ? palette.accentDark : palette.accent },
    bottomNav: { minHeight: 72, flexDirection: "row", alignItems: "stretch", justifyContent: "space-around", gap: 6, marginTop: 8, padding: 7, borderWidth: 1, borderColor: palette.border, borderRadius: 22, backgroundColor: palette.surface },
    navButton: { minWidth: 82, flex: 1, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 15 },
    navButtonActive: { backgroundColor: palette.surfaceAccent },
    navIcon: { color: palette.textMuted, fontSize: 19 },
    navIconActive: { color: palette.accentDark, fontSize: 19 },
    navLabel: { color: palette.textMuted, fontSize: 11, fontWeight: "800" },
    navLabelActive: { color: palette.accentDark, fontSize: 11, fontWeight: "900" },
    modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(16, 34, 35, 0.45)" },
    modalSheet: { gap: 16, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: palette.surface },
    sheetGrip: { width: 42, height: 4, alignSelf: "center", borderRadius: 99, backgroundColor: palette.border },
    sheetHeader: { minHeight: 54, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
    sheetTitle: { color: palette.text, fontSize: 21, fontWeight: "900" },
    sheetDescription: { marginTop: 4, color: palette.textMuted, fontSize: 13 },
    sheetClose: { minHeight: 48, justifyContent: "center", paddingHorizontal: 8 },
    sheetCloseText: { color: palette.accentDark, fontSize: 14, fontWeight: "900" },
    sheetQuestion: { color: palette.text, fontSize: 15, fontWeight: "900" },
    leadOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    leadButton: { minWidth: "30%", minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderColor: palette.border, borderRadius: 15, backgroundColor: palette.surfaceMuted },
    leadButtonSelected: { borderColor: palette.accent, backgroundColor: palette.surfaceAccent },
    leadButtonText: { color: palette.textMuted, fontSize: 13, fontWeight: "800" },
    leadButtonTextSelected: { color: palette.accentDark, fontSize: 13, fontWeight: "900" },
    sheetNote: { color: palette.textFaint, fontSize: 12, lineHeight: 18 }
  });
}

function isLightPalette(palette: typeof lightPalette) {
  return palette.background === lightPalette.background;
}
