// 여섯 날씨 카드의 의미와 실제 행동 요령을 접근 가능한 바텀시트로 보여준다.
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { CheckCircle2, Info, ShieldAlert, X } from "lucide-react-native";
import { getAdaptiveLayout } from "../lib/adaptive-layout";
import type { MetricDetail } from "../lib/metric-details";

const colors = { paper: "#fffaf0", card: "#fff", surface: "#f8f1e6", ink: "#263333", ink2: "#4f5f5c", muted: "#71807c", line: "#e8ddcf", brandDeep: "#176f98", brandSoft: "#e2f4fb", bad: "#bd3a43", badSoft: "#fff0f1", good: "#29936b", goodSoft: "#e9f7ef" };

export function MetricDetailSheet({ detail, onClose }: { detail: MetricDetail | null; onClose: () => void }) {
  const { width, fontScale } = useWindowDimensions();
  const layout = getAdaptiveLayout(width, fontScale);
  const palette = detail?.grade === "주의" ? { ink: colors.bad, soft: colors.badSoft } : detail?.grade === "좋음" ? { ink: colors.good, soft: colors.goodSoft } : { ink: colors.brandDeep, soft: colors.brandSoft };
  return <Modal transparent animationType="slide" visible={Boolean(detail)} onRequestClose={onClose} statusBarTranslucent>
    <View style={[styles.modalRoot, layout.useCenteredModal ? styles.modalRootCentered : null]}>
      <Pressable accessibilityRole="button" accessibilityLabel="날씨 상세 닫기" onPress={onClose} style={styles.backdrop} />
      {detail ? <View accessibilityViewIsModal style={[styles.sheet, { maxWidth: layout.modalMaxWidth }, layout.useCenteredModal ? styles.sheetCentered : null]}>
        <View style={styles.header}><View><Text style={styles.kicker}>상세 날씨</Text><Text accessibilityRole="header" style={styles.title}>{detail.title}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={styles.close}><X size={23} color={colors.ink2} /></Pressable></View>
        <View style={[styles.valueCard, { backgroundColor: palette.soft }]}><Text style={[styles.value, { color: palette.ink }]}>{detail.value}</Text><Text style={[styles.grade, { color: palette.ink }]}>{detail.grade}</Text></View>
        <View style={styles.infoRow}><View style={styles.infoIcon}><Info size={19} color={colors.brandDeep} /></View><View style={styles.infoCopy}><Text style={styles.infoTitle}>무슨 뜻인가요?</Text><Text style={styles.infoText}>{detail.meaning}</Text></View></View>
        <View style={styles.infoRow}><View style={[styles.infoIcon, { backgroundColor: palette.soft }]}>{detail.grade === "주의" ? <ShieldAlert size={19} color={palette.ink} /> : <CheckCircle2 size={19} color={palette.ink} />}</View><View style={styles.infoCopy}><Text style={styles.infoTitle}>이렇게 준비해요</Text><Text style={styles.infoText}>{detail.action}</Text></View></View>
        <Text style={styles.source}>{detail.sourceLabel} 기준 · 출발 직전 실제 하늘과 기상특보를 함께 확인하세요.</Text>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}><Text style={styles.doneText}>확인</Text></Pressable>
      </View> : null}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalRootCentered: { justifyContent: "center", alignItems: "center", padding: 24 },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(24,39,39,0.44)" },
  sheet: { width: "100%", gap: 16, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 30, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: colors.paper },
  sheetCentered: { borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  kicker: { color: colors.brandDeep, fontSize: 12, fontWeight: "900" },
  title: { marginTop: 5, color: colors.ink, fontSize: 26, fontWeight: "900", letterSpacing: -0.8 },
  close: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: colors.surface },
  valueCard: { minHeight: 102, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", padding: 18, borderRadius: 23 },
  value: { fontSize: 40, fontWeight: "900", letterSpacing: -1.5 },
  grade: { fontSize: 16, fontWeight: "900" },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 15, borderWidth: 1, borderColor: colors.line, borderRadius: 20, backgroundColor: colors.card },
  infoIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: colors.brandSoft },
  infoCopy: { minWidth: 0, flex: 1 },
  infoTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  infoText: { marginTop: 4, color: colors.ink2, fontSize: 13, lineHeight: 20 },
  source: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center" },
  done: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: colors.brandDeep },
  doneText: { color: "#fff", fontSize: 15, fontWeight: "900" }
});
