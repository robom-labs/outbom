// 야외봄 출발 알림을 Android와 iOS의 로컬 기기 알림으로 예약하고 해제한다.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

const CHANNEL_ID = "outbom-reminders";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

export async function requestReminderPermission() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "야외봄 출발 알림",
      description: "선택한 야외활동 추천 시간이 가까워질 때 알려드려요.",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 90, 180],
      lightColor: "#2F95A0",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function scheduleReminder(triggerAt: Date, targetLabel: string) {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: "야외봄 · 출발 준비",
      body: `${targetLabel}에 맞춰 나갈 준비를 해보세요.`,
      sound: "default",
      data: { screen: "alerts" }
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerAt,
      channelId: Platform.OS === "android" ? CHANNEL_ID : undefined
    }
  });
}

export async function cancelReminder(notificationId: string) {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}
