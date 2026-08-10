// 야외봄 출발 알림의 미래 시각 검증과 저장값 방어를 확인한다.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMINDER_KEY,
  createReminderDraft,
  isFutureReminder,
  loadReminders,
  saveReminders
} from "../lib/reminders";

const mockStorage = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("expo-sqlite/kv-store", () => ({
  default: {
    getItem: vi.fn(async (key: string) => mockStorage.values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      mockStorage.values.set(key, value);
    })
  }
}));

describe("출발 알림", () => {
  beforeEach(() => {
    mockStorage.values.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T09:00:00.000Z"));
  });

  it("추천 시간보다 앞선 미래 시각만 알림 초안으로 만든다", () => {
    const draft = createReminderDraft(new Date("2026-08-10T10:00:00.000Z"), "걷기 추천 시간 19:00", 10, "native-id");

    expect(draft).toMatchObject({ targetLabel: "걷기 추천 시간 19:00", leadMinutes: 10, notificationId: "native-id" });
    expect(draft?.triggerAt).toBe("2026-08-10T09:50:00.000Z");
    expect(draft && isFutureReminder(draft)).toBe(true);
  });

  it("이미 지난 시간은 예약 목록에 넣지 않는다", () => {
    expect(createReminderDraft(new Date("2026-08-10T09:05:00.000Z"), "걷기 추천 시간", 10, "native-id")).toBeNull();
  });

  it("손상된 저장값은 빈 목록으로 안전하게 복구한다", async () => {
    mockStorage.values.set(REMINDER_KEY, "{broken");
    await expect(loadReminders()).resolves.toEqual([]);
  });

  it("예약 목록을 기기에 저장하고 다시 읽는다", async () => {
    const reminder = createReminderDraft(new Date("2026-08-10T10:00:00.000Z"), "걷기 추천 시간 19:00", 10, "native-id");
    if (!reminder) throw new Error("테스트 예약을 만들지 못했습니다.");

    await expect(saveReminders([reminder])).resolves.toBe(true);
    await expect(loadReminders()).resolves.toEqual([reminder]);
  });
});
