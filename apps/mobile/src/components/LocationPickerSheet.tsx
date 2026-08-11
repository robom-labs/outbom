// 위치 검색과 집·회사·즐겨찾기·최근 위치 선택을 한 화면에서 제공한다.
import { useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { BriefcaseBusiness, ChevronRight, Clock3, Crosshair, Heart, Home, Search, Star, Trash2, X } from "lucide-react-native";
import { getAdaptiveLayout } from "../lib/adaptive-layout";
import { countLocations, type SavedLocation, type SavedLocationKind } from "../lib/locations";

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
  brandSoft: "#e2f4fb"
};

const tabs: { key: SavedLocationKind; label: string }[] = [
  { key: "home", label: "집" },
  { key: "work", label: "회사" },
  { key: "favorite", label: "즐겨찾기" },
  { key: "recent", label: "최근" }
];

function KindIcon({ kind, color = colors.brandDeep }: { kind: SavedLocationKind; color?: string }) {
  if (kind === "home") return <Home size={19} color={color} />;
  if (kind === "work") return <BriefcaseBusiness size={19} color={color} />;
  if (kind === "favorite") return <Heart size={19} color={color} />;
  return <Clock3 size={19} color={color} />;
}

export function LocationPickerSheet({
  visible,
  busy,
  locations,
  onClose,
  onUseCurrent,
  onSearch,
  onSelect,
  onChangeKind,
  onRemove
}: {
  visible: boolean;
  busy: boolean;
  locations: SavedLocation[];
  onClose: () => void;
  onUseCurrent: () => void;
  onSearch: (query: string) => Promise<SavedLocation[]>;
  onSelect: (location: SavedLocation) => void;
  onChangeKind: (location: SavedLocation, kind: SavedLocationKind) => void;
  onRemove: (location: SavedLocation) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const layout = getAdaptiveLayout(width, fontScale);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SavedLocationKind>("favorite");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SavedLocation[]>([]);
  const [message, setMessage] = useState("동네·역·주소를 검색하거나 저장한 위치를 선택하세요.");
  const counts = useMemo(() => countLocations(locations), [locations]);
  const filtered = useMemo(() => locations.filter((item) => item.kind === tab).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)), [locations, tab]);

  const resetSearch = () => {
    setQuery("");
    setResults([]);
    setMessage("동네·역·주소를 검색하거나 저장한 위치를 선택하세요.");
  };

  const search = async () => {
    const term = query.trim();
    if (term.length < 2) {
      setMessage("동네·역·주소를 두 글자 이상 입력해 주세요.");
      return;
    }
    setSearching(true);
    setMessage("검색하고 있어요.");
    try {
      const next = await onSearch(term);
      setResults(next);
      setMessage(next.length ? `${next.length}개 위치를 찾았어요.` : "검색 결과가 없어요. 더 구체적인 주소로 다시 찾아보세요.");
    } catch {
      setResults([]);
      setMessage("위치를 찾지 못했어요. 인터넷 연결과 주소를 확인해 주세요.");
    } finally {
      setSearching(false);
    }
  };

  return <Modal transparent animationType="slide" visible={visible} onShow={resetSearch} onRequestClose={onClose} statusBarTranslucent>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.modalRoot, layout.useCenteredModal ? styles.modalRootCentered : null]}>
      <Pressable accessibilityRole="button" accessibilityLabel="위치 설정 닫기" onPress={onClose} style={styles.backdrop} />
      <View accessibilityViewIsModal style={[styles.sheet, { maxWidth: layout.modalMaxWidth }, layout.useCenteredModal ? styles.sheetCentered : null]}>
        <View style={styles.header}>
          <View style={styles.headerCopy}><Text style={styles.kicker}>나갈 곳 설정</Text><Text accessibilityRole="header" style={styles.title}>어디로 갈까요?</Text><Text style={styles.description}>현재 위치뿐 아니라 자주 가는 동네를 저장해 바로 예보를 볼 수 있어요.</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={({ pressed }) => [styles.closeButton, pressed ? styles.pressed : null]}><X size={24} color={colors.ink2} /></Pressable>
        </View>

        <View style={styles.searchRow}>
          <Search size={22} color={colors.muted} />
          <TextInput
            accessibilityLabel="동네 역 주소 검색"
            autoCapitalize="none"
            autoCorrect={false}
            enterKeyHint="search"
            onChangeText={setQuery}
            onSubmitEditing={() => void search()}
            placeholder="동네·역·주소 검색"
            placeholderTextColor="#8b918e"
            returnKeyType="search"
            style={styles.input}
            value={query}
          />
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: searching }} disabled={searching} onPress={() => void search()} style={({ pressed }) => [styles.searchButton, pressed ? styles.pressed : null, searching ? styles.disabled : null]}>
            {searching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.searchButtonText}>검색</Text>}
          </Pressable>
        </View>

        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onUseCurrent} style={({ pressed }) => [styles.currentButton, pressed ? styles.pressed : null, busy ? styles.disabled : null]}>
          <View style={styles.currentIcon}><Crosshair size={22} color="#fff" /></View><View style={styles.currentCopy}><Text style={styles.currentTitle}>{busy ? "현재 위치 확인 중" : "현재 위치로 찾기"}</Text><Text style={styles.currentDescription}>주변 날씨와 추천 시간을 바로 확인해요.</Text></View><ChevronRight size={21} color={colors.brandDeep} />
        </Pressable>

        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {results.length ? <View style={styles.section}>
            <Text style={styles.sectionTitle}>검색 결과</Text>
            {results.map((location) => <LocationRow key={`search-${location.id}`} location={location} onSelect={() => onSelect(location)} onFavorite={() => onChangeKind(location, "favorite")} />)}
          </View> : null}

          <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>저장한 위치</Text><Text style={styles.sectionMeta}>자주 가는 곳을 빠르게</Text></View>
          <View accessibilityRole="tablist" style={styles.tabs}>
            {tabs.map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }} onPress={() => setTab(item.key)} style={[styles.tab, tab === item.key ? styles.tabActive : null]}>
              <Text style={tab === item.key ? styles.tabTextActive : styles.tabText}>{item.label} {counts[item.key]}</Text>
            </Pressable>)}
          </View>

          {filtered.length ? filtered.map((location) => <LocationRow
            key={location.id}
            location={location}
            onSelect={() => onSelect(location)}
            onFavorite={() => onChangeKind(location, location.kind === "favorite" ? "recent" : "favorite")}
            onHome={() => onChangeKind(location, "home")}
            onWork={() => onChangeKind(location, "work")}
            onRemove={() => onRemove(location)}
          />) : <View style={styles.emptyState}><Star size={27} color={colors.brandDeep} /><Text style={styles.emptyTitle}>{tabs.find((item) => item.key === tab)?.label} 위치가 비어 있어요</Text><Text style={styles.emptyDescription}>검색한 장소를 저장하면 집·회사·즐겨찾기로 빠르게 다시 확인할 수 있어요.</Text></View>}

          <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>
          <View style={styles.examples}><Text style={styles.exampleTitle}>검색 예시</Text><View style={styles.exampleChips}>{["성수동", "강남역", "연남동", "서초동"].map((value) => <Pressable key={value} onPress={() => setQuery(value)} style={styles.exampleChip}><Text style={styles.exampleText}>{value}</Text></Pressable>)}</View></View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

function LocationRow({ location, onSelect, onFavorite, onHome, onWork, onRemove }: { location: SavedLocation; onSelect: () => void; onFavorite: () => void; onHome?: () => void; onWork?: () => void; onRemove?: () => void }) {
  return <View style={styles.locationRow}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${location.name} 예보 보기`} onPress={onSelect} style={({ pressed }) => [styles.locationMain, pressed ? styles.pressed : null]}>
      <View style={styles.locationKind}><KindIcon kind={location.kind} /></View><View style={styles.locationCopy}><Text numberOfLines={1} style={styles.locationName}>{location.name}</Text>{location.detail ? <Text numberOfLines={1} style={styles.locationDetail}>{location.detail}</Text> : null}</View><ChevronRight size={19} color={colors.muted} />
    </Pressable>
    <View style={styles.locationActions}>
      {onHome ? <Pressable accessibilityRole="button" accessibilityLabel="집으로 저장" onPress={onHome} style={styles.iconButton}><Home size={17} color={location.kind === "home" ? colors.brandDeep : colors.muted} /></Pressable> : null}
      {onWork ? <Pressable accessibilityRole="button" accessibilityLabel="회사로 저장" onPress={onWork} style={styles.iconButton}><BriefcaseBusiness size={17} color={location.kind === "work" ? colors.brandDeep : colors.muted} /></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={location.kind === "favorite" ? "즐겨찾기 해제" : "즐겨찾기 저장"} onPress={onFavorite} style={styles.iconButton}><Heart size={17} color={location.kind === "favorite" ? colors.brand : colors.muted} fill={location.kind === "favorite" ? colors.brand : "transparent"} /></Pressable>
      {onRemove ? <Pressable accessibilityRole="button" accessibilityLabel="저장 위치 삭제" onPress={onRemove} style={styles.iconButton}><Trash2 size={17} color={colors.muted} /></Pressable> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalRootCentered: { justifyContent: "center", alignItems: "center", padding: 24 },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(24,39,39,0.44)" },
  sheet: { width: "100%", maxHeight: "92%", gap: 15, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 24, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: colors.paper },
  sheetCentered: { borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerCopy: { minWidth: 0, flex: 1 },
  kicker: { color: colors.brandDeep, fontSize: 12, fontWeight: "900" },
  title: { marginTop: 7, color: colors.ink, fontSize: 29, lineHeight: 36, fontWeight: "900", letterSpacing: -1 },
  description: { marginTop: 7, color: colors.ink2, fontSize: 14, lineHeight: 21 },
  closeButton: { width: 50, height: 50, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: colors.surface },
  searchRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 13, paddingRight: 6, borderWidth: 2, borderColor: "#9bd2e7", borderRadius: 19, backgroundColor: colors.card },
  input: { minWidth: 0, flex: 1, minHeight: 50, color: colors.ink, fontSize: 16, fontWeight: "700" },
  searchButton: { minWidth: 72, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: colors.brand },
  searchButtonText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  currentButton: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderWidth: 1, borderColor: "#bddce8", borderRadius: 20, backgroundColor: colors.brandSoft },
  currentIcon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: colors.brand },
  currentCopy: { minWidth: 0, flex: 1 },
  currentTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  currentDescription: { marginTop: 4, color: colors.ink2, fontSize: 12, lineHeight: 17 },
  scrollContent: { gap: 14, paddingBottom: 18 },
  section: { gap: 9 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  sectionMeta: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  tabs: { flexDirection: "row", gap: 5, padding: 5, borderRadius: 18, backgroundColor: colors.surface },
  tab: { flex: 1, minHeight: 45, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  tabActive: { backgroundColor: colors.card, shadowColor: "#665541", shadowOpacity: 0.08, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  tabText: { color: colors.ink2, fontSize: 12, fontWeight: "800" },
  tabTextActive: { color: colors.brandDeep, fontSize: 12, fontWeight: "900" },
  emptyState: { alignItems: "center", gap: 7, padding: 20, borderRadius: 20, backgroundColor: colors.surface },
  emptyTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  emptyDescription: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  locationRow: { gap: 8, padding: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.card },
  locationMain: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10 },
  locationKind: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: colors.brandSoft },
  locationCopy: { minWidth: 0, flex: 1 },
  locationName: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  locationDetail: { marginTop: 3, color: colors.muted, fontSize: 11 },
  locationActions: { flexDirection: "row", justifyContent: "flex-end", gap: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: 7 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.surface },
  message: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center" },
  examples: { gap: 9, padding: 14, borderRadius: 18, backgroundColor: colors.surface },
  exampleTitle: { color: colors.ink2, fontSize: 12, fontWeight: "900" },
  exampleChips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  exampleChip: { minHeight: 42, justifyContent: "center", paddingHorizontal: 13, borderRadius: 999, backgroundColor: colors.card },
  exampleText: { color: colors.ink2, fontSize: 12, fontWeight: "800" },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.44 }
});
