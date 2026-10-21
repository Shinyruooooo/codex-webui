import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const html = read("public/index.html");
const app = read("public/app.js");
const icons = read("public/codex-icons.js");
const server = read("server.ts");
const pkg = JSON.parse(read("package.json"));

// Elements that used to belong to the built-in interactive terminal.
const REMOVED_ELEMENT_IDS = [
  "sidebarTerminalButton",
  "filesTerminalButton",
  "sideTerminalPanel",
  "sideTerminalHost",
  "terminalHost",
  "sideTerminalControls",
  "sideTerminalStatus",
  "sideTerminalReconnect",
  "sideTerminalDiagnostics",
  "terminalDiagnosticsDialog",
  "terminalDiagnosticsTitle",
  "terminalDiagnosticsText",
  "copyTerminalDiagnostics",
];

// The bottom panel only served the terminal and a duplicate file entry, so it goes away with them.
const REMOVED_BOTTOM_PANEL_IDS = ["toggleBottomPanel", "bottomPanel", "bottomPanelLauncher", "bottomPanelTab", "bottomPanelUtility"];

describe("built-in terminal removal", () => {
  test("the UI shell exposes no terminal entry points", () => {
    for (const id of REMOVED_ELEMENT_IDS) {
      expect(html).not.toContain(`id="${id}"`);
    }
    expect(html).not.toMatch(/data-side-panel-action="terminal"/);
    expect(html).not.toMatch(/data-bottom-panel-action="terminal"/);
    expect(html).not.toContain("terminal-host");
    expect(html).not.toContain("terminal-session-tools");
    expect(html).not.toContain("terminal-diagnostics-dialog");
    expect(html).not.toMatch(/aria-label="Terminal"/);
  });

  test("the bottom panel toggle and legacy launcher are gone", () => {
    for (const id of REMOVED_BOTTOM_PANEL_IDS) {
      expect(html).not.toContain(`id="${id}"`);
    }
    expect(html).not.toContain("data-bottom-panel-action");
    expect(app).not.toContain("toggleBottomPanel");
    expect(app).not.toContain("bottomPanelLauncher");
    expect(app).not.toContain("data-bottom-panel-action");
  });

  test("the browser client has no terminal transport left", () => {
    expect(app.toLowerCase()).not.toContain("xterm");
    for (const symbol of ["__codexTerminals", "initializeTerminal", "fitTerminal", "terminalStates", "terminalDiagnostics"]) {
      expect(app).not.toContain(symbol);
    }
    expect(app).not.toMatch(/["'`]\/terminal/);
  });

  test("the server dropped the terminal endpoint and its PTY worker", () => {
    expect(server).not.toContain("node-pty");
    expect(server).not.toContain("terminal-service");
    expect(server).not.toContain("terminal-worker");
    const serverFiles = readdirSync(join(root, "server")).filter(name => /terminal|pty/i.test(name));
    expect(serverFiles).toEqual([]);
    expect(server).toContain('url.pathname === "/terminal"');
    expect(server).toMatch(/pathname !== "\/ws"/);
  });

  test("the chat bridge over /ws is still served", () => {
    expect(server).toContain('pathname !== "/ws"');
    expect(server).toContain('wss.handleUpgrade');
    expect(app).toContain("/ws");
    expect(app).toContain("fallbackToSse");
  });

  test("the terminal dependencies and terminal test scripts are gone from the package", () => {
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("node-pty");
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@xterm/xterm");
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@xterm/addon-fit");
    expect(Object.keys(pkg.scripts ?? {}).filter(name => /terminal/i.test(name))).toEqual([]);
    expect(pkg.scripts["test:unit"]).toContain("tests/terminal-removal.test.ts");
  });

  test("agent command execution, its terminal icon and approvals are preserved", () => {
    expect(html).toContain('id="modeButton"');
    expect(html).toContain("Terminal commands");
    expect(html).toMatch(/data-icon="terminal"/);
    expect(icons).toMatch(/terminal:\s*'/);
    expect(app).toContain("commandExecution");
    expect(app).toContain("commandActions");
    expect(app).toContain("item/commandExecution/terminalInteraction");
    expect(app).toContain("approvalIcon");
  });

  test("the documentation no longer advertises the built-in terminal", () => {
    const readme = read("README.md");
    const readmeZh = read("README-zh.md");
    const contributing = read("CONTRIBUTING.md");
    expect(readme).not.toMatch(/terminal panel|Terminal diagnostics|Open the terminal|terminal or diff/i);
    expect(readmeZh).not.toMatch(/终端面板|终端诊断|打开终端|终端和 Diff/);
    expect(contributing).not.toContain("test:terminal");
    expect(contributing).not.toContain("for the PTY worker");
  });
});
