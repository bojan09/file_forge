// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, STORAGE_KEY, getSettings, resetSettings, sanitizeSettings, updateSettings } from "@/lib/settings";

describe("settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSettings();
  });
  it("persists only known, valid values", () => {
    updateSettings({ theme: "light", accent: "emerald", suffix: "_x" });
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toMatchObject({ theme: "light", accent: "emerald", suffix: "_x" });
    expect(getSettings().accent).toBe("emerald");
  });
  it("sanitizes tampered storage", () => {
    const s = sanitizeSettings({ theme: "<script>", accent: 5, pageSize: "A0", suffix: "a/b\\c:d" + "x".repeat(100), junk: 1 });
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(s.accent).toBe(DEFAULT_SETTINGS.accent);
    expect(s.pageSize).toBe("A4");
    expect(s.suffix).not.toMatch(/[\\/:]/);
    expect(s.suffix.length).toBeLessThanOrEqual(30);
    expect(s).not.toHaveProperty("junk");
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
  it("clears preferences", () => {
    updateSettings({ theme: "dark" });
    resetSettings();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("survives unavailable storage", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(() => updateSettings({ theme: "dark" })).not.toThrow();
      expect(getSettings().theme).toBe("dark");
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
