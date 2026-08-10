// 야외봄의 출발 알림 시간 계산과 기기 저장 형식을 안전하게 관리한다.
import Storage from "expo-sqlite/kv-store";

export const REMINDER_KEY = "outbom:native:reminders:v1";

export const LEAD_OPTIONS = [
  { minutes: 0, label: "정각" },
  { minutes: 10, label: "10분 전" },
  { minutes: 20, label: "20분 전" },
  { minutes: 30, label: "30분 전" },
  { minutes: 60, label: "1시간 전" }
] as const;

export type Reminder = {
  id: string;
  notificationId: string;
  triggerAt: string;
  targetAt: string;
  targetLabel: string;
  leadMinutes: number;
  createdAt: string;
};

function isReminder(value: unknown): value is Reminder {
  if (!value || typeof value !== "object") return false;
  const reminder = value as Partial<Reminder>;
  return typeof reminder.id === "string"
    && typeof reminder.notificationId === "string"
    && typeof reminder.triggerAt === "string"
    && typeof reminder.targetAt === "string"
    && typeof reminder.targetLabel === "string"
    && typeof reminder.leadMinutes === "number"
    && Number.isFinite(reminder.leadMinutes)
    && typeof reminder.createdAt === "string";
}

export function createReminderDraft(targetAt: Date, targetLabel: string, leadMinutes: number, notificationId: string): Reminder | null {
  const triggerAt = new Date(targetAt.getTime() - leadMinutes * 60_000);
  if (Number.isNaN(triggerAt.getTime()) || triggerAt.getTime() <= Date.now()) return null;

  return {
    id: `outbom-${targetAt.getTime()}-${leadMinutes}`,
    notificationId,
    triggerAt: triggerAt.toISOString(),
    targetAt: targetAt.toISOString(),
    targetLabel,
    leadMinutes,
    createdAt: new Date().toISOString()
  };
}

export function isFutureReminder(reminder: Reminder, now = new Date()) {
  return new Date(reminder.triggerAt).getTime() > now.getTime();
}

export async function loadReminders(): Promise<Reminder[]> {
  try {
    const raw = await Storage.getItem(REMINDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isReminder) : [];
  } catch {
    return [];
  }
}

export async function saveReminders(reminders: Reminder[]) {
  try {
    await Storage.setItem(REMINDER_KEY, JSON.stringify(reminders));
    return true;
  } catch {
    return false;
  }
}
