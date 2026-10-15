import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THEME_PREFERENCES, THEME_STORAGE_KEY, applyTheme, normalizeThemePreference, readStoredTheme, resolveTheme, storeTheme } from "../public/theme.js";

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { values.set(key, String(value)); },
    read: key => values.get(key),
  };
}

describe("theme preference", () => {
  test("exposes the supported preferences", () => {
    expect(THEME_PREFERENCES).toEqual(["system", "light", "dark"]);
  });

  test("falls back to system for unknown values", () => {
    expect(normalizeThemePreference("midnight")).toBe("system");
    expect(normalizeThemePreference(undefined)).toBe("system");
    expect(normalizeThemePreference("dark")).toBe("dark");
  });

  test("resolves the system preference from the color scheme", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  test("reads and writes the stored preference", () => {
    const storage = fakeStorage();
    expect(readStoredTheme(storage)).toBe("system");
    expect(storeTheme("dark", storage)).toBe("dark");
    expect(storage.read(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredTheme(storage)).toBe("dark");
    storeTheme("bogus", storage);
    expect(readStoredTheme(storage)).toBe("system");
  });

  test("survives storage that throws", () => {
    const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
    expect(readStoredTheme(throwing)).toBe("system");
    expect(storeTheme("dark", throwing)).toBe("dark");
  });

  test("applies the resolved theme to the root element", () => {
    const root = { dataset: {}, style: {} };
    expect(applyTheme("system", { root, prefersDark: true })).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.themePreference).toBe("system");
    expect(root.style.colorScheme).toBe("dark");
    expect(applyTheme("light", { root, prefersDark: true })).toBe("light");
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.themePreference).toBe("light");
  });

  test("applyTheme without a root still resolves", () => {
    expect(applyTheme("system", { root: null, prefersDark: false })).toBe("light");
  });
});

describe("theme stylesheet", () => {
  const css = readFileSync(join(import.meta.dir, "..", "public", "style.css"), "utf8");

  const declarations = body => new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1]));
  const block = pattern => {
    const found = [...css.matchAll(pattern)];
    expect(found.length).toBeGreaterThan(0);
    return declarations(found.at(-1)[1]);
  };

  const light = block(/:root\[data-theme=light\]\{([^}]*)\}/g);
  const dark = block(/:root\[data-theme=dark\]\{([^}]*)\}/g);
  const systemDark = block(/@media\(prefers-color-scheme:dark\)\{:root\{([^}]*)\}\}/g);
  const base = [...css.matchAll(/:root\{([^}]*)\}/g)]
    .map(match => declarations(match[1]))
    .find(tokens => tokens.has("--app-main"));

  test("explicit light and dark themes define the same tokens", () => {
    expect([...light].sort()).toEqual([...dark].sort());
  });

  test("explicit themes stay in sync with the default token layer", () => {
    // 基础令牌层同时充当浅色默认值，所以它必须覆盖显式浅色主题的全部令牌。
    for (const token of light) expect(base.has(token)).toBe(true);
    // 显式深色主题必须至少覆盖系统深色层使用的令牌。
    for (const token of systemDark) expect(dark.has(token)).toBe(true);
  });

  test("every used app token is defined by the default token layer", () => {
    const used = new Set([...css.matchAll(/var\((--app-[a-z0-9-]+)/g)].map(match => match[1]));
    expect(used.size).toBeGreaterThan(10);
    for (const token of used) expect(base.has(token)).toBe(true);
  });

  test("defines the selection token that the active thread item reads", () => {
    expect(css).toContain("var(--app-selection)");
    for (const layer of [base, light, dark, systemDark]) expect(layer.has("--app-selection")).toBe(true);
  });
});
