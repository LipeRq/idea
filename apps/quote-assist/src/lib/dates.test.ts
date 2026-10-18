import { describe, expect, it } from "vitest";
import { addBusinessDays, businessDaysBetween, findDateInText, formatJpDate, todayJst } from "./dates";

describe("dates", () => {
  it("日本時間の日付", () => {
    // UTC 15:00 は日本時間の翌日0時
    expect(todayJst(new Date("2026-10-18T15:00:00Z"))).toBe("2026-10-19");
    expect(todayJst(new Date("2026-10-18T14:59:59Z"))).toBe("2026-10-18");
  });

  it("営業日数は土日を除く(2026-10-19は月曜)", () => {
    expect(businessDaysBetween("2026-10-19", "2026-10-23")).toBe(4);
    expect(businessDaysBetween("2026-10-19", "2026-10-26")).toBe(5);
    expect(businessDaysBetween("2026-10-23", "2026-10-25")).toBe(0);
    expect(businessDaysBetween("2026-10-19", "2026-10-19")).toBe(0);
    expect(businessDaysBetween("2026-10-19", "2026-10-16")).toBe(-1);
    expect(addBusinessDays("2026-10-23", 1)).toBe("2026-10-26");
  });

  it("文中の日付を読む", () => {
    expect(findDateInText("希望納期:2026年11月27日 当社着", "2026-10-19")).toBe("2026-11-27");
    expect(findDateInText("10月26日(月)までに", "2026-10-19")).toBe("2026-10-26");
    // 年がなく、受付日より前の月日なら翌年
    expect(findDateInText("1/15までに", "2026-10-19")).toBe("2027-01-15");
    expect(findDateInText("2月30日", "2026-10-19")).toBeNull();
    expect(findDateInText("至急", "2026-10-19")).toBeNull();
  });

  it("和暦表記", () => {
    expect(formatJpDate("2026-11-27", true)).toBe("2026年11月27日(金)");
  });
});
