import { describe, expect, it } from "vitest";
import { builtinFormat, formatNumber, general } from "@/engine/parsers/xlsx-format";
import { colIndex, colLetters } from "@/engine/parsers/xlsx";

const f = (v: number, code: string | undefined, d1904 = false) => formatNumber(v, code, d1904).text;
const serial = (y: number, m: number, d: number, h = 0, mi = 0) => (Date.UTC(y, m - 1, d, h, mi) - Date.UTC(1899, 11, 30)) / 86400000;

describe("General", () => {
  it.each([
    [1234.5, "1234.5"],
    [0.1 + 0.2, "0.3"],
    [100, "100"],
    [-7.25, "-7.25"],
    [1e12, "1E+12"],
    [123456789012, "1.23457E+11"],
    [0.000000001234, "1.234E-09"],
    [0, "0"],
  ])("%s → %s", (v, out) => expect(general(v)).toBe(out));
});

describe("number formats (values checked against what Excel and LibreOffice print)", () => {
  it.each([
    [3.14159, "0.00", "3.14"],
    [2.5, "0", "3"],
    [1234567.89, "#,##0", "1,234,568"],
    [1234.5, "#,##0.00", "1,234.50"],
    [0.256, "0%", "26%"],
    [0.0123, "0.0%", "1.2%"],
    [12345, "0.00E+00", "1.23E+04"],
    [1234.5, '"$"#,##0.00', "$1,234.50"],
    [1234.5, "$#,##0.00", "$1,234.50"],
    [1234.5, "[$€-407]#,##0.00", "€1,234.50"],
    [7, "000", "007"],
    [-1234.5, "#,##0;(#,##0)", "(1,235)"],
    [1234.5, "#,##0;(#,##0)", "1,235"],
    [0, "0.00;-0.00;\"zero\"", "zero"],
    [5, '0" units"', "5 units"],
    [1500000, "#,##0,,", "2"],
    [0.5, "#.00", ".50"],
    [42, "@", "42"],
  ])("%s with %j → %j", (v, code, out) => expect(f(v, code)).toBe(out));

  it("negative numbers without a negative section get a minus sign", () => {
    expect(f(-3.5, "0.00")).toBe("-3.50");
    expect(f(-1234.5, "#,##0.00")).toBe("-1,234.50");
  });

  it("unsupported formats fall back to General and say so", () => {
    expect(formatNumber(1.5, "# ?/?", false)).toEqual({ text: "1.5", unsupported: true });
    expect(formatNumber(1.5, "[>100]0;0", false).unsupported).toBe(true);
    expect(formatNumber(3.5, "[h]:mm:ss", false).unsupported).toBe(true);
  });
});

describe("dates and times", () => {
  it.each([
    [serial(2024, 1, 15), "yyyy-mm-dd", "2024-01-15"],
    [serial(2024, 1, 15), "m/d/yyyy", "1/15/2024"],
    [serial(2024, 1, 15), "dd/mm/yy", "15/01/24"],
    [serial(2024, 1, 15), "d-mmm-yy", "15-Jan-24"],
    [serial(2024, 1, 15), "dddd", "Monday"],
    [serial(2024, 1, 15), "ddd", "Mon"],
    [serial(2024, 1, 15), "mmmm d, yyyy", "January 15, 2024"],
    [serial(2024, 3, 1, 9, 30), "d mmm yyyy h:mm AM/PM", "1 Mar 2024 9:30 AM"],
    [serial(2024, 3, 1, 21, 5), "h:mm AM/PM", "9:05 PM"],
    [serial(2024, 3, 1, 21, 5), "hh:mm", "21:05"],
    [0.75, "h:mm:ss", "18:00:00"],
    [serial(2023, 12, 31), "yyyy", "2023"],
    [serial(2024, 2, 29), "dd.mm.yyyy", "29.02.2024"],
    [serial(2024, 1, 15), '"Due:" yyyy-mm-dd', "Due: 2024-01-15"],
  ])("serial %s with %j → %j", (v, code, out) => expect(f(v, code)).toBe(out));

  it("distinguishes months from minutes", () => {
    expect(f(serial(2024, 5, 7, 14, 9), "h:mm")).toBe("14:09");
    expect(f(serial(2024, 5, 7, 14, 9), "mm/dd/yyyy")).toBe("05/07/2024");
    expect(f(serial(2024, 5, 7, 14, 9), "mm:ss")).toBe("09:00");
  });

  it("honours the 1904 date system", () => {
    // Serial 0 in the 1904 system is 1904-01-01.
    expect(f(0, "yyyy-mm-dd", true)).toBe("1904-01-01");
    expect(f(1461, "yyyy-mm-dd", true)).toBe("1908-01-01"); // 1904 was a leap year: 4 years = 1,461 days
  });

  it("built-in ids map to the documented formats", () => {
    expect(builtinFormat(14)).toBe("m/d/yyyy");
    expect(builtinFormat(10)).toBe("0.00%");
    expect(builtinFormat(4)).toBe("#,##0.00");
    expect(builtinFormat(999)).toBeUndefined();
  });
});

describe("cell references", () => {
  it.each([
    ["A", 0],
    ["Z", 25],
    ["AA", 26],
    ["AZ", 51],
    ["XFD", 16383],
  ])("%s ↔ %i", (l, i) => {
    expect(colIndex(l)).toBe(i);
    expect(colLetters(i)).toBe(l);
  });
});
