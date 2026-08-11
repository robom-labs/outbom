// 저장 위치의 최근 목록, 즐겨찾기, 집·회사 단일 지정과 삭제 규칙을 검증한다.
import { describe, expect, it } from "vitest";
import { changeLocationKind, countLocations, createLocationId, removeSavedLocation, upsertRecentLocation, type SavedLocation } from "../lib/locations";

function location(name: string, latitude: number, longitude: number, kind: SavedLocation["kind"] = "recent"): SavedLocation {
  return { id: createLocationId(latitude, longitude), name, latitude, longitude, kind, lastUsedAt: "2026-08-11T00:00:00.000Z" };
}

describe("native saved locations", () => {
  it("최근 위치는 중복 없이 갱신하고 다섯 개까지만 보존한다", () => {
    const locations = Array.from({ length: 6 }, (_, index) => location(`위치 ${index}`, 37 + index / 100, 127));
    const updated = upsertRecentLocation(locations, locations[5]);

    expect(updated.filter((item) => item.kind === "recent")).toHaveLength(5);
    expect(updated[0].id).toBe(locations[5].id);
    expect(new Set(updated.map((item) => item.id)).size).toBe(updated.length);
  });

  it("집과 회사는 각각 하나만 유지하고 기존 지정은 즐겨찾기로 바꾼다", () => {
    const first = location("기존 집", 37.1, 127.1, "home");
    const second = location("새 집", 37.2, 127.2, "favorite");
    const updated = changeLocationKind([first, second], second.id, "home");

    expect(updated.find((item) => item.id === first.id)?.kind).toBe("favorite");
    expect(updated.find((item) => item.id === second.id)?.kind).toBe("home");
    expect(countLocations(updated)).toEqual({ home: 1, work: 0, favorite: 1, recent: 0 });
  });

  it("선택한 저장 위치만 삭제한다", () => {
    const first = location("성수동", 37.54, 127.05, "favorite");
    const second = location("연남동", 37.56, 126.92, "favorite");
    expect(removeSavedLocation([first, second], first.id)).toEqual([second]);
  });
});
