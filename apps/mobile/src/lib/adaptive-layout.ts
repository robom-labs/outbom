// 야외봄을 작은 휴대전화부터 폴더블·태블릿까지 같은 정보 위계로 배치하는 화면 규칙을 제공한다.
export type AdaptiveWidthClass = "compact" | "medium" | "expanded";

export type AdaptiveLayout = {
  widthClass: AdaptiveWidthClass;
  pageMaxWidth: number;
  horizontalPadding: number;
  navMaxWidth: number;
  modalMaxWidth: number;
  useCenteredModal: boolean;
  useTwoColumns: boolean;
  metricColumns: 1 | 2 | 3 | 4;
};

export function getAdaptiveLayout(width: number, fontScale = 1): AdaptiveLayout {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 390;
  const safeFontScale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const largeText = safeFontScale >= 1.35;
  const veryLargeText = safeFontScale >= 1.8;

  if (safeWidth < 600) {
    return {
      widthClass: "compact",
      pageMaxWidth: 620,
      horizontalPadding: safeWidth <= 340 ? 10 : 14,
      navMaxWidth: 620,
      modalMaxWidth: 620,
      useCenteredModal: false,
      useTwoColumns: false,
      metricColumns: veryLargeText || safeWidth <= 360 ? 2 : 4,
    };
  }

  if (safeWidth < 840) {
    return {
      widthClass: "medium",
      pageMaxWidth: 780,
      horizontalPadding: 22,
      navMaxWidth: 680,
      modalMaxWidth: 680,
      useCenteredModal: true,
      useTwoColumns: !largeText,
      metricColumns: veryLargeText ? 1 : largeText ? 2 : 3,
    };
  }

  return {
    widthClass: "expanded",
    pageMaxWidth: 1080,
    horizontalPadding: 28,
    navMaxWidth: 760,
    modalMaxWidth: 720,
    useCenteredModal: true,
    useTwoColumns: !largeText,
    metricColumns: veryLargeText ? 1 : largeText ? 2 : 3,
  };
}

export function percentageForColumns(columns: 1 | 2 | 3 | 4) {
  if (columns === 1) return "100%" as const;
  if (columns === 2) return "48.8%" as const;
  if (columns === 3) return "32%" as const;
  return "23.8%" as const;
}
