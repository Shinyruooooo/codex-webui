import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const html = readFileSync(join(import.meta.dir, "..", "public", "index.html"), "utf8");
const dom = new JSDOM(html, { url: "http://127.0.0.1:8899/" });
const document = dom.window.document;

describe("settings surface", () => {
  test("keeps only settings pages that map to a real surface", () => {
    const pages = [...document.querySelectorAll("[data-settings-page]")].map(node => node.dataset.settingsPage);
    expect(pages).toEqual(["general-settings", "appearance", "agent", "profile", "keyboard-shortcuts"]);
  });

  test("drops placeholder integrations, coding, and archived groups", () => {
    const groups = [...document.querySelectorAll("[data-settings-group]")].map(node => node.dataset.settingsGroup);
    expect(groups).toEqual(["personal"]);
    expect(document.querySelector('[data-settings-group="integrations"]')).toBeNull();
    expect(document.querySelector('[data-settings-group="coding"]')).toBeNull();
    expect(document.querySelector('[data-settings-group="archived"]')).toBeNull();
  });

  test("exposes a theme control backed by a real appearance page", () => {
    const select = document.querySelector("#themeSelect");
    expect(select).not.toBeNull();
    expect([...select.options].map(option => option.value)).toEqual(["system", "light", "dark"]);
    expect(document.querySelector('[data-settings-content="appearance"]')?.hidden).toBe(true);
  });
});

describe("sidebar product label", () => {
  test("is a plain brand mark without a fake mode dropdown", () => {
    const label = document.querySelector("#productModeButton");
    expect(label).not.toBeNull();
    expect(label.tagName).toBe("SPAN");
    expect(label.querySelector("strong")?.textContent.trim()).toBe("Codex");
    expect(label.querySelector(".chevron")).toBeNull();
    expect(label.hasAttribute("aria-haspopup")).toBe(false);
  });
});

describe("theme bootstrap", () => {
  const apply = (stored, prefersDark) => {
    const dom = new JSDOM(html, {
      url: "http://127.0.0.1:8899/",
      runScripts: "dangerously",
      beforeParse(window) {
        window.matchMedia = () => ({ matches: prefersDark, addEventListener() {}, removeEventListener() {} });
        if (stored) window.localStorage.setItem("codex-webui-theme", stored);
      },
    });
    return dom.window.document.documentElement;
  };

  test("follows the system color scheme when no preference is stored", () => {
    expect(apply(null, true).dataset.theme).toBe("dark");
    expect(apply(null, false).dataset.theme).toBe("light");
    expect(apply(null, true).dataset.themePreference).toBe("system");
  });

  test("applies an explicit stored preference regardless of the system scheme", () => {
    expect(apply("light", true).dataset.theme).toBe("light");
    const dark = apply("dark", false);
    expect(dark.dataset.theme).toBe("dark");
    expect(dark.dataset.themePreference).toBe("dark");
  });

  test("ignores an unsupported stored preference", () => {
    const root = apply("midnight", true);
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.themePreference).toBe("system");
  });
});
