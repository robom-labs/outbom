// 야외봄의 화면 폭·큰 글자별 적응형 배치 계약을 회귀 테스트한다.
import { describe, expect, it } from "vitest";
import { getAdaptiveLayout, percentageForColumns } from "../lib/adaptive-layout";

describe("adaptive layout", () => {
  it("320px 휴대전화에서는 여백과 날씨 카드를 줄인다", () => {
    expect(getAdaptiveLayout(320)).toMatchObject({
      widthClass: "compact",
      horizontalPadding: 10,
      metricColumns: 2,
      useCenteredModal: false,
      useTwoColumns: false,
    });
  });

  it("일반 휴대전화에서는 사진 기준의 네 지표 한 줄을 유지한다", () => {
    expect(getAdaptiveLayout(390)).toMatchObject({ widthClass: "compact", metricColumns: 4 });
  });

  it("태블릿은 공간이 충분할 때 두 열과 세 지표 열을 사용한다", () => {
    expect(getAdaptiveLayout(1024)).toMatchObject({
      widthClass: "expanded",
      pageMaxWidth: 1080,
      useCenteredModal: true,
      useTwoColumns: true,
      metricColumns: 3,
    });
  });

  it("큰 글자에서는 넓은 화면도 한 열로 돌아가 잘림을 막는다", () => {
    expect(getAdaptiveLayout(1024, 2)).toMatchObject({ useTwoColumns: false, metricColumns: 1 });
  });

  it("열 수를 카드 너비로 변환한다", () => {
    expect(percentageForColumns(1)).toBe("100%");
    expect(percentageForColumns(2)).toBe("48.8%");
    expect(percentageForColumns(3)).toBe("32%");
    expect(percentageForColumns(4)).toBe("23.8%");
  });
});
