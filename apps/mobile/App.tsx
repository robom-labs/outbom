// 야외봄 네이티브 앱의 위치 예보·4탭 탐색·기기 알림·설정 흐름을 한곳에서 조정한다.
import { useEffect, useRef, useState } from "react";
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
  View
} from "react-native";
import * as IntentLauncher from "expo-intent-launcher";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { BellRing, ExternalLink, MapPin, RefreshCw, ShieldCheck } from "lucide-react-native";
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ACTIVITIES, type ActivityKey } from "./src/lib/activities";
import {
  buildPreparationTips,
  fetchForecastSnapshot,
  getAirQualityCoverage,
  getCurrentForecastSnapshot,
  getForecastAvailability,
  getForecastFreshness,
  getRankedForecastWindows,
  hasIncompleteCurrentSafetyData,
  hasIncompleteSafetyData,
  rescoreForecastSnapshot,
  type ForecastSnapshot
} from "./src/lib/forecast";
import {
  ActivityPickerSheet,
  announceScreen,
  BottomNavigation,
  PreparationDashboard,
  RecommendationDashboard,
  TodayDashboard,
  WeatherControls,
  type PrimaryScreen
} from "./src/components/WeatherExperience";
import { cancelReminder, requestReminderPermission, scheduleReminder } from "./src/lib/notifications";
import {
  createReminderDraft,
  isFutureReminder,
  LEAD_OPTIONS,
  loadReminders,
  saveReminders,
  type Reminder
} from "./src/lib/reminders";
import { loadForecastSnapshot, loadSelectedActivity, saveForecastSnapshot, saveSelectedActivity } from "./src/lib/storage";

type LocationState = "idle" | "requesting" | "granted" | "denied" | "unavailable";
type AppScreen = PrimaryScreen | "alerts";

const SEOUL = { latitude: 37.5665, longitude: 126.978, locationName: "서울" };
const SUPPORT_URL = process.env.EXPO_PUBLIC_SUPPORT_URL ?? "https://robom.kr/support";
const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL ?? "https://robom.kr/privacy/outbom";
const OPEN_METEO_URL = "https://open-meteo.com/";
const OPEN_METEO_LICENSE_URL = "https://open-meteo.com/en/license";

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
  bad: "#bd3a43",
  badSoft: "#fff0f1"
};

function formatClock(value: string) {
  const match = value.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "시각 확인";
}

function formatWindow(start: string, end: string) {
  return `${formatClock(start)}~${formatClock(end)}`;
}

function fallbackDate(now: Date) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
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

function formatLocationAddress(address: Location.LocationGeocodedAddress | undefined) {
  if (!address) return "현재 위치";
  const neighborhood = address.district || address.subregion || address.name;
  const city = address.city || address.region;
  if (neighborhood && city && neighborhood !== city) return `${neighborhood} · ${city}`;
  return neighborhood || city || "현재 위치";
}

export default function App() {
  const [snapshot, setSnapshot] = useState<ForecastSnapshot | null>(null);
  const [activity, setActivity] = useState<ActivityKey>("walk");
  const [locationState, setLocationState] = useState<LocationState>("idle");
  const [feedback, setFeedback] = useState("마지막 예보를 불러오는 중이에요.");
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [screen, setScreen] = useState<AppScreen>("today");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isActivityPickerOpen, setIsActivityPickerOpen] = useState(false);
  const [isReminderSheetOpen, setIsReminderSheetOpen] = useState(false);
  const [reminderTargetTime, setReminderTargetTime] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const announcedForecastTime = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([loadForecastSnapshot(), loadSelectedActivity(), loadReminders()])
      .then(([stored, selected, storedReminders]) => {
        if (!active) return;
        const rescored = stored ? rescoreForecastSnapshot(stored, selected) : null;
        const current = rescored ? getCurrentForecastSnapshot(rescored, new Date()) : null;
        const availability = rescored ? getForecastAvailability(rescored, new Date()) : null;
        const futureReminders = storedReminders.filter((reminder) => isFutureReminder(reminder));
        setActivity(selected);
        setSnapshot(rescored);
        setReminders(futureReminders);
        if (futureReminders.length !== storedReminders.length) void saveReminders(futureReminders);
        if (rescored && rescored !== stored) void saveForecastSnapshot(rescored);
        setFeedback(current
          ? "저장된 마지막 예보를 보여드려요."
          : rescored && availability === "current-missing"
            ? "현재 시간의 저장 예보가 비어 있어 새 예보가 필요해요."
            : rescored
              ? "저장된 예보 시간이 지났어요. 새 예보를 확인해 주세요."
              : "현재 위치 또는 서울 예보로 첫 판단을 확인해 보세요.");
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

    return () => { active = false; };
  }, []);

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

  const refreshForecast = async (options: { latitude: number; longitude: number; locationName: string }, activeRequest = ++requestSequence.current) => {
    setLoading(true);
    setFeedback(`${options.locationName}의 ${ACTIVITIES[activity].label} 예보를 확인하고 있어요.`);
    try {
      const next = await fetchForecastSnapshot({ ...options, activity });
      if (activeRequest !== requestSequence.current) return;
      setSnapshot(next);
      const saved = await saveForecastSnapshot(next);
      if (activeRequest !== requestSequence.current) return;
      setSelectedDate(next.forecastTime.slice(0, 10));
      setFeedback(saved ? "새 예보와 추천 시간을 기기에 저장했어요." : "예보는 갱신했지만 기기 저장을 마치지 못했어요.");
    } catch {
      if (activeRequest !== requestSequence.current) return;
      setFeedback(snapshot ? "네트워크를 확인하지 못해 저장된 예보를 유지해요." : "예보를 불러오지 못했어요. 연결 뒤 다시 시도해 주세요.");
    } finally {
      if (activeRequest === requestSequence.current) setLoading(false);
    }
  };

  const requestCurrentLocation = async () => {
    const activeRequest = ++requestSequence.current;
    setLocationState("requesting");
    setFeedback("현재 위치를 확인하고 있어요.");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (activeRequest !== requestSequence.current) return;
      if (!permission.granted) {
        setLocationState("denied");
        setFeedback(snapshot ? "위치 권한이 없어 저장된 예보를 유지해요." : "위치 권한 없이도 서울 예보를 사용할 수 있어요.");
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        if (activeRequest !== requestSequence.current) return;
        setLocationState("unavailable");
        setFeedback("기기 위치 서비스를 켜거나 서울 예보를 이용해 주세요.");
        return;
      }
      const position = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 15_000);
      if (activeRequest !== requestSequence.current) return;
      setLocationState("granted");
      const addresses = await Location.reverseGeocodeAsync({ latitude: position.coords.latitude, longitude: position.coords.longitude }).catch(() => []);
      await refreshForecast({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        locationName: formatLocationAddress(addresses[0])
      }, activeRequest);
    } catch {
      if (activeRequest !== requestSequence.current) return;
      setLocationState("unavailable");
      setFeedback(snapshot ? "현재 위치를 확인하지 못해 저장된 예보를 유지해요." : "현재 위치를 확인하지 못했어요. 서울 예보를 이용해 주세요.");
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
    setFeedback(`${ACTIVITIES[nextActivity].label} 기준으로 다시 계산했어요.`);
  };

  const activeSnapshot = snapshot ? getCurrentForecastSnapshot(snapshot, now) : null;
  const forecastAvailability = snapshot ? getForecastAvailability(snapshot, now) : null;
  const freshness = snapshot ? getForecastFreshness(snapshot, now) : null;
  const isStale = freshness?.state === "stale";
  const currentSafetyDataIncomplete = activeSnapshot ? hasIncompleteCurrentSafetyData(activeSnapshot) : false;
  const safetyDataIncomplete = activeSnapshot ? hasIncompleteSafetyData(activeSnapshot) : false;
  const airQualityCoverage = activeSnapshot ? getAirQualityCoverage(activeSnapshot) : null;
  const isReferenceOnly = Boolean(isStale || currentSafetyDataIncomplete);
  const todayDate = activeSnapshot?.forecastTime.slice(0, 10) ?? snapshot?.forecastTime.slice(0, 10) ?? fallbackDate(now);
  const tomorrowDate = activeSnapshot?.slots.find((slot) => slot.time.slice(0, 10) !== todayDate)?.time.slice(0, 10) ?? null;
  const effectiveDate = selectedDate && (selectedDate === todayDate || selectedDate === tomorrowDate) ? selectedDate : todayDate;
  const daySlots = activeSnapshot?.slots.filter((slot) => slot.time.slice(0, 10) === effectiveDate) ?? [];
  const rankedWindows = activeSnapshot ? getRankedForecastWindows(activeSnapshot, effectiveDate) : [];
  const preparationTips = activeSnapshot ? buildPreparationTips(activeSnapshot) : [];
  const bestWindowLabel = activeSnapshot ? formatWindow(activeSnapshot.bestTime, activeSnapshot.bestEndTime) : "추천 시간 확인 전";
  const primaryScreen: PrimaryScreen = screen === "alerts" ? "settings" : screen;
  const busy = !hydrated || loading || locationState === "requesting";
  const dataWarning = activeSnapshot && (airQualityCoverage !== "complete" || safetyDataIncomplete)
    ? "대기질·돌풍·가시거리 등 일부 안전 자료가 빠진 시간은 추천에서 제외했어요."
    : null;

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (isReminderSheetOpen || isActivityPickerOpen) return false;
      if (screen !== "today") {
        setScreen("today");
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [isActivityPickerOpen, isReminderSheetOpen, screen]);

  useEffect(() => {
    if (!hydrated || Platform.OS !== "ios") return;
    const previous = announcedForecastTime.current;
    const next = activeSnapshot?.forecastTime ?? null;
    announcedForecastTime.current = next;
    if (!previous || previous === next) return;
    AccessibilityInfo.announceForAccessibility(next ? `${formatClock(next)} 예보 기준으로 갱신했어요.` : "새 예보가 필요해요.");
  }, [activeSnapshot?.forecastTime, hydrated]);

  const changeScreen = (next: PrimaryScreen) => {
    setScreen(next);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
    announceScreen(next);
  };

  const openReminderFor = (targetTime?: string) => {
    setReminderTargetTime(targetTime ?? activeSnapshot?.bestTime ?? null);
    setIsReminderSheetOpen(true);
  };

  const removeReminder = async (reminder: Reminder) => {
    await cancelReminder(reminder.notificationId).catch(() => undefined);
    const next = reminders.filter((item) => item.id !== reminder.id);
    setReminders(next);
    setFeedback(await saveReminders(next) ? "출발 알림을 껐어요." : "알림 목록 저장을 마치지 못했어요.");
  };

  const saveReminder = async (leadMinutes: number) => {
    if (!activeSnapshot) {
      setFeedback("새 예보를 확인한 뒤 알림을 설정할 수 있어요.");
      setIsReminderSheetOpen(false);
      return;
    }
    const targetTime = reminderTargetTime ?? activeSnapshot.bestTime;
    const targetAt = new Date(targetTime);
    const triggerAt = new Date(targetAt.getTime() - leadMinutes * 60_000);
    const targetLabel = `${ACTIVITIES[activity].label} 추천 시간 ${formatClock(targetTime)}`;
    if (Number.isNaN(targetAt.getTime()) || triggerAt.getTime() <= now.getTime()) {
      setFeedback("이미 지난 시간이라 알림을 설정할 수 없어요.");
      return;
    }
    try {
      if (!(await requestReminderPermission())) {
        setFeedback("알림 권한이 허용되지 않았어요. 설정에서 허용한 뒤 다시 시도해 주세요.");
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
      if (!(await saveReminders(next))) {
        await cancelReminder(notificationId);
        setFeedback("기기 알림 목록을 저장하지 못했어요.");
        return;
      }
      setReminders(next);
      setIsReminderSheetOpen(false);
      setScreen("alerts");
      setFeedback(`${targetLabel} 알림을 저장했어요.`);
    } catch {
      setFeedback("기기 알림을 예약하지 못했어요. 알림 권한과 배터리 제한을 확인해 주세요.");
    }
  };

  const openBatterySettings = () => {
    if (Platform.OS !== "android") {
      setFeedback("iPhone·iPad에서는 설정 앱 → 야외봄 → 알림을 확인해 주세요.");
      return;
    }
    void IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
      .catch(() => setFeedback("기기 설정 → 배터리 → 앱 배터리 사용량에서 야외봄을 확인해 주세요."));
  };

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView ref={scrollRef} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          {screen === "today" ? <WeatherControls
            activity={activity}
            locationName={activeSnapshot?.locationName ?? snapshot?.locationName ?? "현재 위치로 예보 확인"}
            selectedDate={effectiveDate}
            todayDate={todayDate}
            tomorrowDate={tomorrowDate}
            busy={busy}
            onOpenActivities={() => setIsActivityPickerOpen(true)}
            onSelectDate={setSelectedDate}
            onRefreshLocation={() => void requestCurrentLocation()}
          /> : null}

          {loading ? <View accessibilityRole="progressbar" style={styles.loadingBar}><ActivityIndicator size="small" color={colors.brandDeep} /><Text style={styles.loadingText}>{feedback}</Text></View> : null}
          {dataWarning ? <View accessibilityRole="alert" style={styles.warningBanner}><Text style={styles.warningText}>{dataWarning}</Text></View> : null}
          {screen === "today" ? (
            activeSnapshot && daySlots.length ? <TodayDashboard key={`${activity}-${effectiveDate}`} slots={daySlots} activity={activity} dayLabel={effectiveDate === todayDate ? "오늘" : "내일"} isReferenceOnly={isReferenceOnly} onAlarm={openReminderFor} />
              : <EmptyForecast availability={forecastAvailability} busy={busy} onCurrent={() => void requestCurrentLocation()} onSeoul={() => void refreshForecast(SEOUL)} />
          ) : screen === "recommendations" ? (
            activeSnapshot && daySlots.length ? <RecommendationDashboard slots={daySlots} windows={rankedWindows} activity={activity} dayLabel={effectiveDate === todayDate ? "오늘" : "내일"} isReferenceOnly={isReferenceOnly} onAlarm={openReminderFor} />
              : <EmptyForecast availability={forecastAvailability} busy={busy} onCurrent={() => void requestCurrentLocation()} onSeoul={() => void refreshForecast(SEOUL)} />
          ) : screen === "preparation" ? (
            activeSnapshot ? <PreparationDashboard activity={activity} windowLabel={bestWindowLabel} tips={preparationTips} onAlarm={() => openReminderFor(activeSnapshot.bestTime)} />
              : <EmptyForecast availability={forecastAvailability} busy={busy} onCurrent={() => void requestCurrentLocation()} onSeoul={() => void refreshForecast(SEOUL)} />
          ) : screen === "alerts" ? <AlertsScreen reminders={reminders} feedback={feedback} onRemove={(reminder) => void removeReminder(reminder)} onAdd={() => openReminderFor()} onBack={() => setScreen("settings")} onOpenSettings={() => void Linking.openSettings().catch(() => setFeedback("기기 설정을 열지 못했어요."))} onOpenBattery={openBatterySettings} />
            : <SettingsScreen reminderCount={reminders.length} onOpenAlerts={() => setScreen("alerts")} onOpenSettings={() => void Linking.openSettings().catch(() => setFeedback("기기 설정을 열지 못했어요."))} onOpenBattery={openBatterySettings} onOpenLocation={() => void Linking.openSettings().catch(() => setFeedback("기기 설정을 열지 못했어요."))} />}

          {activeSnapshot && screen !== "alerts" && screen !== "settings" ? (
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

          {snapshot && freshness?.state !== "fresh" ? <RefreshBanner
            stale={freshness?.state === "stale"}
            busy={busy}
            onRefresh={() => void requestCurrentLocation()}
          /> : null}

          {screen !== "alerts" && screen !== "settings" && !loading ? <Text accessibilityLiveRegion="polite" style={styles.feedback}>{feedback}</Text> : null}
        </ScrollView>
        <BottomNavigation active={primaryScreen} onChange={changeScreen} />
        <ActivityPickerSheet visible={isActivityPickerOpen} selected={activity} onClose={() => setIsActivityPickerOpen(false)} onSelect={selectActivity} />
        <ReminderSheet visible={isReminderSheetOpen} targetTime={reminderTargetTime ?? activeSnapshot?.bestTime ?? null} activityLabel={ACTIVITIES[activity].label} now={now} onClose={() => setIsReminderSheetOpen(false)} onSave={(minutes) => void saveReminder(minutes)} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function RefreshBanner({ stale, busy, onRefresh }: { stale: boolean; busy: boolean; onRefresh: () => void }) {
  return <View accessibilityRole="alert" style={[styles.freshnessBanner, stale ? styles.freshnessBannerStale : null]}>
    <View style={styles.refreshCopy}><Text style={styles.refreshTitle}>{stale ? "저장된 예보가 오래됐어요" : "새 예보를 확인할 때예요"}</Text><Text style={styles.refreshDetail}>위치를 다시 확인하기 전까지 저장된 결과는 참고용이에요.</Text></View>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onRefresh} style={({ pressed }) => [styles.refreshButton, pressed ? styles.pressed : null, busy ? styles.disabled : null]}><RefreshCw size={18} color="#fff" /><Text style={styles.refreshButtonText}>새로 확인</Text></Pressable>
  </View>;
}

function EmptyForecast({ availability, busy, onCurrent, onSeoul }: { availability: ReturnType<typeof getForecastAvailability> | null; busy: boolean; onCurrent: () => void; onSeoul: () => void }) {
  const title = availability === "current-missing" ? "현재 시간 예보가 비어 있어요" : availability === "expired" ? "저장된 예보 시간이 지났어요" : "새 예보를 먼저 확인해요";
  return <View style={styles.emptyCard}>
    <View style={styles.emptyIcon}><MapPin size={27} color={colors.brandDeep} /></View>
    <Text accessibilityRole="header" style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.emptyDescription}>한 번 확인하면 마지막 성공 예보를 기기에 저장해 오프라인에서도 볼 수 있어요.</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onCurrent} style={({ pressed }) => [styles.primaryButton, pressed ? styles.pressed : null, busy ? styles.disabled : null]}><Text style={styles.primaryButtonText}>현재 위치로 확인</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onSeoul} style={({ pressed }) => [styles.secondaryButton, pressed ? styles.pressed : null, busy ? styles.disabled : null]}><Text style={styles.secondaryButtonText}>서울 예보로 둘러보기</Text></Pressable>
  </View>;
}

function AlertsScreen({ reminders, feedback, onRemove, onAdd, onBack, onOpenSettings, onOpenBattery }: { reminders: Reminder[]; feedback: string; onRemove: (reminder: Reminder) => void; onAdd: () => void; onBack: () => void; onOpenSettings: () => void; onOpenBattery: () => void }) {
  return <View style={styles.screenStack}>
    <View style={styles.screenHeader}><Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}><Text style={styles.backButtonText}>설정으로</Text></Pressable><View style={styles.screenHeaderCopy}><Text accessibilityRole="header" style={styles.screenTitle}>출발 알림</Text><Text style={styles.screenDescription}>추천 시간 전에 기기 알림으로 한 번 알려드려요.</Text></View></View>
    {reminders.length ? reminders.map((reminder) => <View key={reminder.id} style={styles.settingsCard}><View style={styles.settingsCardHeader}><View style={styles.settingsIcon}><BellRing size={20} color={colors.brandDeep} /></View><View style={styles.settingsCopy}><Text style={styles.settingsTitle}>{reminder.targetLabel}</Text><Text style={styles.settingsDetail}>{new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(reminder.triggerAt))} 알림</Text></View></View><Pressable accessibilityRole="button" onPress={() => onRemove(reminder)} style={styles.softButton}><Text style={styles.softButtonText}>이 알림 끄기</Text></Pressable></View>)
      : <View style={styles.settingsCard}><Text style={styles.settingsTitle}>설정된 출발 알림이 없어요</Text><Text style={styles.settingsDetail}>오늘 또는 추천 화면의 종 아이콘을 눌러 저장해 보세요.</Text></View>}
    <Pressable accessibilityRole="button" onPress={onAdd} style={styles.primaryButton}><Text style={styles.primaryButtonText}>추천 시간 알림 설정</Text></Pressable>
    <View style={styles.settingsCard}><Text style={styles.settingsTitle}>알림이 오지 않을 때</Text><Text style={styles.settingsDetail}>일부 Android 기기는 절전·배터리 제한 상태에서 알림이 늦을 수 있어요.</Text><Pressable accessibilityRole="button" onPress={onOpenSettings} style={styles.softButton}><Text style={styles.softButtonText}>야외봄 알림 설정 열기</Text></Pressable><Pressable accessibilityRole="button" onPress={onOpenBattery} style={styles.softButton}><Text style={styles.softButtonText}>배터리 제한 상태 확인하기</Text></Pressable></View>
    <Text accessibilityLiveRegion="polite" style={styles.feedback}>{feedback}</Text>
  </View>;
}

function SettingsScreen({ reminderCount, onOpenAlerts, onOpenSettings, onOpenBattery, onOpenLocation }: { reminderCount: number; onOpenAlerts: () => void; onOpenSettings: () => void; onOpenBattery: () => void; onOpenLocation: () => void }) {
  const open = (url: string) => void Linking.openURL(url).catch(() => undefined);
  return <View style={styles.screenStack}>
    <View style={styles.brandCard}>
      <Image accessible={false} accessibilityIgnoresInvertColors source={require("./assets/icon.png")} style={styles.brandIcon} />
      <View style={styles.brandCopy}><Text accessibilityRole="header" style={styles.brandWordmark}><Text style={styles.brandPrefix}>야외</Text><Text style={styles.brandBom}>봄</Text></Text><Text style={styles.brandTagline}>robom · 바깥바람이 좋은 때</Text></View>
      <Pressable accessibilityRole="link" accessibilityLabel="로봄 홈페이지 열기" onPress={() => open("https://robom.kr/")} style={styles.externalButton}><ExternalLink size={20} color={colors.brandDeep} /></Pressable>
    </View>
    <View style={styles.sectionHeading}><Text accessibilityRole="header" style={styles.screenTitle}>설정</Text><Text style={styles.screenDescription}>알림·위치·배터리 상태와 앱 정보를 확인해요.</Text></View>
    <View style={styles.settingsCard}><View style={styles.settingsCardHeader}><View style={styles.settingsIcon}><BellRing size={20} color={colors.brandDeep} /></View><View style={styles.settingsCopy}><Text style={styles.settingsTitle}>출발 알림</Text><Text style={styles.settingsDetail}>{reminderCount ? `${reminderCount}개의 알림이 저장되어 있어요.` : "저장된 알림이 없어요."}</Text></View></View><Pressable accessibilityRole="button" onPress={onOpenAlerts} style={styles.softButton}><Text style={styles.softButtonText}>내 알림 보기</Text></Pressable><Pressable accessibilityRole="button" onPress={onOpenSettings} style={styles.softButton}><Text style={styles.softButtonText}>기기 알림 설정 열기</Text></Pressable><Pressable accessibilityRole="button" onPress={onOpenBattery} style={styles.softButton}><Text style={styles.softButtonText}>배터리 제한 상태 확인하기</Text></Pressable></View>
    <View style={styles.settingsCard}><View style={styles.settingsCardHeader}><View style={styles.settingsIcon}><MapPin size={20} color={colors.brandDeep} /></View><View style={styles.settingsCopy}><Text style={styles.settingsTitle}>위치와 개인정보</Text><Text style={styles.settingsDetail}>위치는 예보 확인 때만 사용하고 좌표는 저장하지 않아요. 백그라운드 위치·광고·추적은 사용하지 않아요.</Text></View></View><Pressable accessibilityRole="button" onPress={onOpenLocation} style={styles.softButton}><Text style={styles.softButtonText}>기기 위치 설정 열기</Text></Pressable></View>
    <View style={styles.settingsCard}><View style={styles.settingsCardHeader}><View style={styles.settingsIcon}><ShieldCheck size={20} color={colors.brandDeep} /></View><View style={styles.settingsCopy}><Text style={styles.settingsTitle}>데이터와 지원</Text><Text style={styles.settingsDetail}>날씨·대기질 원자료를 활동별로 재계산한 참고 정보예요.</Text></View></View><Pressable accessibilityRole="link" onPress={() => open(OPEN_METEO_URL)} style={styles.softButton}><Text style={styles.softButtonText}>원자료 Open-Meteo</Text></Pressable><Pressable accessibilityRole="link" onPress={() => open(OPEN_METEO_LICENSE_URL)} style={styles.softButton}><Text style={styles.softButtonText}>CC BY 4.0 라이선스</Text></Pressable><Pressable accessibilityRole="link" onPress={() => open(SUPPORT_URL)} style={styles.softButton}><Text style={styles.softButtonText}>지원 센터</Text></Pressable><Pressable accessibilityRole="link" onPress={() => open(PRIVACY_URL)} style={styles.softButton}><Text style={styles.softButtonText}>개인정보처리방침</Text></Pressable></View>
    <Text style={styles.versionText}>야외봄 v0.28.0 · kr.robom.outbom</Text>
  </View>;
}

function ReminderSheet({ visible, targetTime, activityLabel, now, onClose, onSave }: { visible: boolean; targetTime: string | null; activityLabel: string; now: Date; onClose: () => void; onSave: (minutes: number) => void }) {
  const [leadMinutes, setLeadMinutes] = useState(10);
  const isPast = !targetTime || new Date(targetTime).getTime() - leadMinutes * 60_000 <= now.getTime();
  return <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose} statusBarTranslucent>
    <View style={styles.modalBackdrop}>
      <View accessibilityViewIsModal style={styles.reminderSheet}>
        <View style={styles.sheetGrip} />
        <View style={styles.reminderHeader}><View><Text accessibilityRole="header" style={styles.reminderTitle}>출발 알림 설정</Text><Text style={styles.reminderDescription}>{targetTime ? `${activityLabel} 추천 시간 ${formatClock(targetTime)}` : "새 예보를 먼저 확인해 주세요."}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="알림 설정 닫기" onPress={onClose} style={styles.sheetClose}><Text style={styles.sheetCloseText}>닫기</Text></Pressable></View>
        <Text style={styles.reminderQuestion}>언제 알려드릴까요?</Text>
        <View style={styles.leadOptions}>{LEAD_OPTIONS.map((option) => <Pressable key={option.minutes} accessibilityRole="button" accessibilityState={{ selected: leadMinutes === option.minutes }} onPress={() => setLeadMinutes(option.minutes)} style={({ pressed }) => [styles.leadButton, leadMinutes === option.minutes ? styles.leadButtonActive : null, pressed ? styles.pressed : null]}><Text style={leadMinutes === option.minutes ? styles.leadTextActive : styles.leadText}>{option.label}</Text></Pressable>)}</View>
        <Text style={styles.reminderNote}>알림을 저장할 때만 권한을 요청합니다. 제조사 절전 설정에 따라 약간 늦을 수 있어요.</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: isPast }} disabled={isPast} onPress={() => onSave(leadMinutes)} style={({ pressed }) => [styles.primaryButton, pressed ? styles.pressed : null, isPast ? styles.disabled : null]}><Text style={styles.primaryButtonText}>{isPast ? "이미 지난 시간이에요" : "기기 알림 저장"}</Text></Pressable>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.paper },
  page: { width: "100%", maxWidth: 620, alignSelf: "center", gap: 14, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 108 },
  loadingBar: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.brandSoft },
  loadingText: { color: colors.brandDeep, fontSize: 12, fontWeight: "800" },
  warningBanner: { paddingHorizontal: 15, paddingVertical: 12, borderRadius: 16, backgroundColor: colors.badSoft },
  warningText: { color: colors.bad, fontSize: 12, lineHeight: 18, fontWeight: "800" },
  sourceCredit: { minHeight: 48, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: 5, paddingHorizontal: 8 },
  sourceCreditText: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  sourceCreditLinkButton: { minHeight: 48, justifyContent: "center" },
  sourceCreditLink: { color: colors.brandDeep, fontSize: 11, fontWeight: "800", textDecorationLine: "underline" },
  freshnessBanner: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: 12, padding: 15, borderWidth: 1, borderColor: "#c5e1e8", borderRadius: 20, backgroundColor: colors.brandSoft },
  freshnessBannerStale: { borderColor: "#ecc4c7", backgroundColor: colors.badSoft },
  refreshCopy: { minWidth: 0, flex: 1 },
  refreshTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  refreshDetail: { marginTop: 4, color: colors.muted, fontSize: 11, lineHeight: 17 },
  refreshButton: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, borderRadius: 15, backgroundColor: colors.brandDeep },
  refreshButtonText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  emptyCard: { alignItems: "center", gap: 13, padding: 24, borderWidth: 1, borderColor: colors.line, borderRadius: 26, backgroundColor: colors.card },
  emptyIcon: { width: 58, height: 58, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: colors.brandSoft },
  emptyTitle: { color: colors.ink, fontSize: 21, fontWeight: "900", textAlign: "center" },
  emptyDescription: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },
  primaryButton: { minHeight: 54, width: "100%", alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: colors.brandDeep },
  primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  secondaryButton: { minHeight: 54, width: "100%", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#c5e1e8", borderRadius: 18, backgroundColor: colors.card },
  secondaryButtonText: { color: colors.brandDeep, fontSize: 15, fontWeight: "900" },
  feedback: { paddingHorizontal: 8, color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center" },
  screenStack: { gap: 16 },
  screenHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  screenHeaderCopy: { minWidth: 0, flex: 1 },
  backButton: { minHeight: 48, justifyContent: "center", paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.surface },
  backButtonText: { color: colors.brandDeep, fontSize: 12, fontWeight: "900" },
  sectionHeading: { gap: 5 },
  screenTitle: { color: colors.ink, fontSize: 28, lineHeight: 35, fontWeight: "900", letterSpacing: -1 },
  screenDescription: { color: colors.ink2, fontSize: 14, lineHeight: 21 },
  settingsCard: { gap: 12, padding: 18, borderWidth: 1, borderColor: colors.line, borderRadius: 24, backgroundColor: colors.card },
  settingsCardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  settingsIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.brandSoft },
  settingsCopy: { minWidth: 0, flex: 1 },
  settingsTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  settingsDetail: { marginTop: 4, color: colors.muted, fontSize: 12, lineHeight: 18 },
  softButton: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: colors.surface },
  softButtonText: { color: colors.brandDeep, fontSize: 13, fontWeight: "900" },
  brandCard: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: 13, padding: 14, borderWidth: 1, borderColor: "#c5e1e8", borderRadius: 25, backgroundColor: colors.brandSoft },
  brandIcon: { width: 58, height: 58, borderRadius: 20 },
  brandCopy: { minWidth: 0, flex: 1 },
  brandWordmark: { fontSize: 28, fontWeight: "900", letterSpacing: -1 },
  brandPrefix: { color: colors.ink, fontWeight: "900" },
  brandBom: { color: colors.brand, fontWeight: "900" },
  brandTagline: { marginTop: 3, color: colors.muted, fontSize: 12 },
  externalButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: colors.card },
  versionText: { color: colors.muted, fontSize: 11, textAlign: "center" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(24,39,39,0.44)" },
  reminderSheet: { gap: 16, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: colors.paper },
  sheetGrip: { width: 44, height: 4, alignSelf: "center", borderRadius: 999, backgroundColor: colors.line },
  reminderHeader: { minHeight: 60, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  reminderTitle: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  reminderDescription: { marginTop: 5, color: colors.muted, fontSize: 13 },
  sheetClose: { minHeight: 48, justifyContent: "center", paddingHorizontal: 9 },
  sheetCloseText: { color: colors.brandDeep, fontSize: 14, fontWeight: "900" },
  reminderQuestion: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  leadOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  leadButton: { minWidth: "30%", minHeight: 50, alignItems: "center", justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 16, backgroundColor: colors.card },
  leadButtonActive: { borderColor: "#a9d7e9", backgroundColor: colors.brandSoft },
  leadText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  leadTextActive: { color: colors.brandDeep, fontSize: 13, fontWeight: "900" },
  reminderNote: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.42 }
});
