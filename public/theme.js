export const THEME_STORAGE_KEY = "codex-webui-theme";
export const THEME_PREFERENCES = Object.freeze(["system", "light", "dark"]);

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : "system";
}

export function resolveTheme(preference, prefersDark = false) {
  const normalized = normalizeThemePreference(preference);
  if (normalized === "system") return prefersDark ? "dark" : "light";
  return normalized;
}

export function readStoredTheme(storage = globalThis.localStorage) {
  try { return normalizeThemePreference(storage?.getItem?.(THEME_STORAGE_KEY)); }
  catch { return "system"; }
}

export function storeTheme(preference, storage = globalThis.localStorage) {
  const normalized = normalizeThemePreference(preference);
  try { storage?.setItem?.(THEME_STORAGE_KEY, normalized); }
  catch { /* Storage can be unavailable in private or restricted contexts. */ }
  return normalized;
}

export function applyTheme(preference, { root = globalThis.document?.documentElement, prefersDark = false } = {}) {
  const normalized = normalizeThemePreference(preference);
  const resolved = resolveTheme(normalized, prefersDark);
  if (root) {
    root.dataset.theme = resolved;
    root.dataset.themePreference = normalized;
    root.style.colorScheme = resolved;
  }
  return resolved;
}
