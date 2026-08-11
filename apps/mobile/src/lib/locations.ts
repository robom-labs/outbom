// 야외봄에서 사용자가 선택한 집·회사·즐겨찾기·최근 위치를 기기 안에서만 관리한다.
export type SavedLocationKind = "home" | "work" | "favorite" | "recent";

export type SavedLocation = {
  id: string;
  name: string;
  detail?: string;
  latitude: number;
  longitude: number;
  kind: SavedLocationKind;
  lastUsedAt: string;
};

const KIND_ORDER: SavedLocationKind[] = ["home", "work", "favorite", "recent"];

function finiteCoordinate(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function isSavedLocation(value: unknown): value is SavedLocation {
  if (!value || typeof value !== "object") return false;
  const location = value as Partial<SavedLocation>;
  return typeof location.id === "string"
    && typeof location.name === "string"
    && location.name.trim().length > 0
    && (location.detail === undefined || typeof location.detail === "string")
    && finiteCoordinate(location.latitude, -90, 90)
    && finiteCoordinate(location.longitude, -180, 180)
    && typeof location.kind === "string"
    && KIND_ORDER.includes(location.kind as SavedLocationKind)
    && typeof location.lastUsedAt === "string";
}

export function createLocationId(latitude: number, longitude: number) {
  return `${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
}

export function createRecentLocation(input: Omit<SavedLocation, "id" | "kind" | "lastUsedAt">): SavedLocation {
  return {
    ...input,
    id: createLocationId(input.latitude, input.longitude),
    kind: "recent",
    lastUsedAt: new Date().toISOString()
  };
}

export function upsertRecentLocation(locations: SavedLocation[], selected: SavedLocation) {
  const current = locations.find((item) => item.id === selected.id);
  const updated: SavedLocation = {
    ...selected,
    kind: current && current.kind !== "recent" ? current.kind : selected.kind,
    lastUsedAt: new Date().toISOString()
  };
  const pinned = locations.filter((item) => item.id !== updated.id && item.kind !== "recent");
  const recent = [updated, ...locations.filter((item) => item.id !== updated.id && item.kind === "recent")]
    .filter((item) => item.kind === "recent")
    .slice(0, 5);
  return updated.kind === "recent" ? [...pinned, ...recent] : [updated, ...pinned, ...recent];
}

export function changeLocationKind(locations: SavedLocation[], id: string, kind: SavedLocationKind) {
  const now = new Date().toISOString();
  return locations.map((item) => {
    if (item.id === id) return { ...item, kind, lastUsedAt: now };
    if ((kind === "home" || kind === "work") && item.kind === kind) return { ...item, kind: "favorite" as const };
    return item;
  });
}

export function removeSavedLocation(locations: SavedLocation[], id: string) {
  return locations.filter((item) => item.id !== id);
}

export function countLocations(locations: SavedLocation[]) {
  return {
    home: locations.filter((item) => item.kind === "home").length,
    work: locations.filter((item) => item.kind === "work").length,
    favorite: locations.filter((item) => item.kind === "favorite").length,
    recent: locations.filter((item) => item.kind === "recent").length
  };
}

