import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const root = join(import.meta.dir, "..");
const html = readFileSync(join(root, "public", "index.html"), "utf8");
const app = readFileSync(join(root, "public", "app.js"), "utf8");
const i18n = readFileSync(join(root, "public", "i18n.js"), "utf8");
const dom = new JSDOM(html, { url: "http://127.0.0.1:8899/" });
const document = dom.window.document;

describe("ChatGPT sign-in surface", () => {
  test("offers a device-code dialog with the code, the verification page and a cancel action", () => {
    const dialog = document.querySelector("#loginDialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.tagName).toBe("DIALOG");
    expect(document.querySelector("#loginUserCode")?.tagName).toBe("CODE");
    expect(document.querySelector("#loginVerificationLink")?.getAttribute("href")).toBe("#");
    expect(document.querySelector("#loginVerificationLink")?.getAttribute("target")).toBe("_blank");
    expect(document.querySelector("#loginVerificationLink")?.getAttribute("rel")).toContain("noopener");
    expect(document.querySelector("#loginCopyCode")).not.toBeNull();
    expect(document.querySelector("#loginCancel")).not.toBeNull();
    expect(document.querySelector("#loginClose")).not.toBeNull();
  });

  test("exposes the sign-in entry in the profile settings page", () => {
    expect(document.querySelector("#settingsAccountLogin")).not.toBeNull();
    expect(document.querySelector("#settingsAccountSignedOut")).not.toBeNull();
    expect(document.querySelector('[data-settings-content="profile"]')?.querySelector("#settingsAccountLogin")).not.toBeNull();
  });

  test("starts the device-code flow and reacts to the completion notification", () => {
    expect(app).toContain("rpc('account/login/start',{type:'chatgptDeviceCode'})");
    expect(app).toContain("rpc('account/login/cancel'");
    expect(app).toContain("account/login/completed");
    expect(app).toContain("/api/login/status");
  });

  test("copies the code with the fallback that works on plain HTTP", () => {
    // The WebUI is often reached over plain HTTP through a tunnel, where the
    // native clipboard API is unavailable.
    expect(app).toContain("copyTextToClipboard(code)");
    expect(app).not.toContain("navigator.clipboard.writeText");
    expect(app).toContain("t('Code copied')");
  });

  test("polls the sign-in state while the dialog is open", () => {
    expect(app).toContain("startLoginPolling");
    expect(app).toContain("resolveLoginStatus");
    expect(app).toContain("stopLoginPolling");
  });

  test("translates the sign-in surface", () => {
    for (const message of ["Log in with ChatGPT", "Copy code", "Open verification page", "Signed in to ChatGPT", "Not signed in"]) {
      expect(i18n).toContain(`"${message}":`);
    }
    expect(i18n).toContain('"Log in with ChatGPT": "使用 ChatGPT 登录"');
  });
});
