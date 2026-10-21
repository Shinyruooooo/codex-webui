// Real browser coverage for the removal of the built-in interactive terminal.
// No model inference, no account credentials, no user files and no production
// port are used: an isolated server runs on an ephemeral loopback port with a
// throwaway HOME, a throwaway project folder and its own password.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, webkit } from 'playwright';
import { root, launchOptions, artifacts } from './browser-runtime.mjs';

const engineName = process.env.CODEX_WEBUI_TEST_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engineName));
const engine = engineName === 'webkit' ? webkit : chromium;
// The WebKit binary is provided through the environment only; no local path is
// hardcoded in this repository.
const options = engineName === 'webkit'
  ? { headless: true, ...(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH } : {}) }
  : launchOptions();

const home = mkdtempSync(join(tmpdir(), 'codex-terminal-removal-'));
const codexHome = join(home, '.codex');
const workspace = join(home, 'workspace');
mkdirSync(codexHome);
mkdirSync(workspace);
writeFileSync(join(workspace, 'notes.txt'), 'TERMINAL_REMOVAL_FIXTURE\n');
const password = 'terminal-removal-fixture-password';
const port = await new Promise((resolve, reject) => {
  const socket = createServer();
  socket.once('error', reject);
  socket.listen(0, '127.0.0.2', () => { const value = socket.address().port; socket.close(() => resolve(value)); });
});
// 127.0.0.2 stays local but does not match the WebUI's localhost auth bypass,
// so HTTP and WebSocket traffic must use the real login cookie.
const base = `http://127.0.0.2:${port}`;
for (const key of ['NO_PROXY', 'no_proxy']) process.env[key] = [process.env[key], '127.0.0.2'].filter(Boolean).join(',');
const server = Bun.spawn([process.execPath, 'run', 'server.ts'], {
  cwd: root,
  env: {
    ...process.env, HOME: home, CODEX_HOME: codexHome,
    CODEX_AUTH_PATH: join(codexHome, 'auth.json'),
    CODEX_WEBUI_MODELS_JSON: join(home, 'models.json'),
    CODEX_WEBUI_AUTH_STORE: join(home, 'auth.json'),
    CODEX_WEBUI_CWD: workspace, CODEX_WEBUI_REVIEW_ROOT: workspace,
    CODEX_WEBUI_PROJECTLESS: 'false', CODEX_WEBUI_SKILL_EXTRA_ROOTS: '',
    CODEX_WEBUI_PASSWORD: password, CODEX_WEBUI_ACCESS_TOKEN: '',
    SHELL: '/bin/bash', HOST: '127.0.0.2', PORT: String(port),
  },
  stdout: 'ignore', stderr: 'ignore',
});

const log = [];
const record = (message) => { log.push(message); console.log(message); };
const TERMINAL_SELECTORS = [
  '#sidebarTerminalButton', '#filesTerminalButton', '#sideTerminalPanel', '#sideTerminalHost',
  '#terminalHost', '#sideTerminalControls', '#sideTerminalStatus', '#sideTerminalReconnect',
  '#sideTerminalDiagnostics', '#terminalDiagnosticsDialog', '#terminalDiagnosticsText',
  '#bottomPanel', '#toggleBottomPanel', '#bottomPanelLauncher', '#bottomPanelTab',
  '[data-side-panel-action="terminal"]', '[data-bottom-panel-action]',
].join(', ');

let browser;
try {
  let health = null;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const response = await fetch(`${base}/api/health`, { headers: { authorization: `Basic ${Buffer.from(`codex:${password}`).toString('base64')}` } });
      if (response.ok) { health = await response.json(); break; }
    } catch {}
    await Bun.sleep(100);
  }
  assert.ok(health, 'isolated removal server did not become ready');
  record(`[${engineName}] isolated server ready on ${base} (codex bridge connected: ${Boolean(health.codex)})`);

  browser = await engine.launch(options);
  for (const width of [1360, 1000, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => { if (window === window.top) localStorage.setItem('codex-webui-locale', 'en'); });
    const page = await context.newPage();
    const errors = [];
    const terminalSockets = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => {
      const path = new URL(socket.url()).pathname;
      if (path !== '/ws') terminalSockets.push(path);
    });

    await page.goto(base);
    await page.waitForSelector('#passwordGate:not([hidden])');
    await page.fill('#passwordInput', password);
    await page.click('#passwordLoginButton');
    await page.waitForFunction(() => Boolean(globalThis.__codexWebuiDebug));

    // 1. No terminal entry points and no bottom panel in the rendered UI.
    const dom = await page.evaluate(selector => ({
      matches: [...document.querySelectorAll(selector)].map(node => node.id || node.className || node.getAttribute('data-side-panel-action') || node.getAttribute('data-bottom-panel-action')),
      launcherActions: [...document.querySelectorAll('[data-side-panel-action]')].map(node => node.dataset.sidePanelAction),
      bottomPanelActions: [...document.querySelectorAll('[data-bottom-panel-action]')].map(node => node.dataset.bottomPanelAction),
      sidePanelHidden: document.querySelector('#sidePanel')?.hidden ?? true,
    }), TERMINAL_SELECTORS);
    assert.deepEqual(dom.matches, [], `${width}px: the built-in terminal and bottom panel must not exist in the DOM`);
    assert.equal(dom.launcherActions.includes('terminal'), false, `${width}px: the side panel launcher must not offer a terminal`);
    assert.deepEqual(dom.bottomPanelActions, [], `${width}px: the bottom panel actions must be gone`);
    record(`[${engineName}] ${width}px: no terminal or bottom panel entry points (launcher actions: ${dom.launcherActions.join(', ') || 'none'})`);

    // 2. The Cmd/Ctrl+J shortcut must not open anything.
    if (await page.locator('#sidePanel').isVisible()) await page.click('#closeSidePanel');
    await page.keyboard.press('Control+j');
    await page.keyboard.press('Meta+j');
    await page.waitForTimeout(400);
    const afterShortcut = await page.evaluate(selector => ({
      sidePanelHidden: document.querySelector('#sidePanel')?.hidden ?? true,
      terminalMatches: document.querySelectorAll(selector).length,
    }), TERMINAL_SELECTORS);
    assert.equal(afterShortcut.sidePanelHidden, true, `${width}px: Cmd/Ctrl+J must not open a panel`);
    assert.equal(afterShortcut.terminalMatches, 0, `${width}px: Cmd/Ctrl+J must not create a terminal`);
    record(`[${engineName}] ${width}px: Cmd/Ctrl+J has no effect`);

    // 3. The removed transport must stay unreachable, the chat bridge must stay usable.
    const terminalHttp = await context.request.get(`${base}/terminal`);
    assert.equal(terminalHttp.status(), 404, `${width}px: HTTP /terminal must answer 404`);
    assert.deepEqual(terminalSockets, [], `${width}px: the page must not open any non-chat WebSocket`);
    const sockets = await page.evaluate(url => Promise.all([
      new Promise(resolve => {
        const socket = new WebSocket(`${url}/terminal`);
        const timer = setTimeout(() => { try { socket.close(); } catch {} resolve('timeout'); }, 5000);
        socket.onopen = () => { clearTimeout(timer); socket.close(); resolve('open'); };
        socket.onerror = () => { clearTimeout(timer); resolve('denied'); };
        socket.onclose = () => { clearTimeout(timer); resolve('closed'); };
      }),
      new Promise(resolve => {
        const socket = new WebSocket(`${url}/ws`);
        const timer = setTimeout(() => { try { socket.close(); } catch {} resolve('timeout'); }, 5000);
        socket.onopen = () => { clearTimeout(timer); socket.close(); resolve('open'); };
        socket.onerror = () => { clearTimeout(timer); resolve('denied'); };
      }),
    ]), base.replace('http:', 'ws:'));
    assert.ok(['denied', 'closed'].includes(sockets[0]), `${width}px: the /terminal WebSocket must be rejected, not time out`);
    assert.equal(sockets[1], 'open', `${width}px: the /ws chat bridge must still accept connections`);
    assert.deepEqual(terminalSockets, ['/terminal'], `${width}px: only the deliberate probe may reach a non-chat WebSocket`);
    record(`[${engineName}] ${width}px: HTTP /terminal -> 404, WS /terminal -> ${sockets[0]}, WS /ws -> ${sockets[1]}`);

    // 4. Files, the right panel and panel resizing keep working.
    if (await page.evaluate(() => innerWidth < 720 ? !document.querySelector('#sidebar').classList.contains('mobile-open') : document.body.classList.contains('sidebar-hidden'))) await page.click('#toggleSidebar');
    await page.click('#sidebarTabFiles');
    await page.waitForSelector('#sidebarFilesSection:not([hidden]) [data-file-entry-path="notes.txt"]', { timeout: 15000 });
    await page.click('[data-file-entry-path="notes.txt"]');
    await page.waitForFunction(() => document.querySelector('#filesPreviewBody')?.textContent?.includes('TERMINAL_REMOVAL_FIXTURE'), undefined, { timeout: 15000 });
    if (await page.locator('#sidePanel').isHidden()) await page.click('#toggleSidePanel');
    await page.waitForFunction(() => {
      const panel = document.querySelector('#sidePanel');
      return panel && !panel.hidden && panel.getBoundingClientRect().right <= innerWidth + 1;
    });
    const panelState = await page.evaluate(() => ({
      visible: !document.querySelector('#sidePanel').hidden,
      filesVisible: !document.querySelector('#filesPanel').hidden,
      width: document.querySelector('#sidePanel').getBoundingClientRect().width,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    assert.equal(panelState.visible, true, `${width}px: the right panel must still open`);
    assert.equal(panelState.filesVisible, true, `${width}px: the file preview must still render`);
    assert.equal(panelState.scrollWidth <= panelState.innerWidth, true, `${width}px: the layout must not overflow horizontally`);
    record(`[${engineName}] ${width}px: file preview and right panel still work (panel width ${Math.round(panelState.width)}px)`);

    if (width >= 1000) {
      const handle = page.locator('#sidePanelResizeHandle');
      const before = await page.locator('#sidePanel').evaluate(node => node.getBoundingClientRect().width);
      await page.locator('#sidePanel').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + 3, box.y + 80);
      await page.mouse.down();
      await page.mouse.move(box.x - 97, box.y + 80, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(width => document.querySelector('#sidePanel').getBoundingClientRect().width >= width + 60, before, { timeout: 10000 });
      const after = await page.locator('#sidePanel').evaluate(node => node.getBoundingClientRect().width);
      assert.ok(after >= before + 60, `${width}px: the right panel must still be resizable`);
      record(`[${engineName}] ${width}px: right panel resize still works (${Math.round(before)}px -> ${Math.round(after)}px)`);
    }

    assert.deepEqual(errors, [], `${width}px: no uncaught browser errors`);
    await context.close();
    record(`[${engineName}] ${width}px: passed`);
  }
} finally {
  try {
    if (browser) await browser.close();
  } finally {
    server.kill('SIGTERM');
    const stopped = await Promise.race([server.exited.then(() => true), Bun.sleep(7000).then(() => false)]);
    if (!stopped) { server.kill('SIGKILL'); await server.exited; }
    rmSync(home, { recursive: true, force: true });
  }
}

const logPath = join(artifacts, `terminal-removal-${engineName}.log`);
writeFileSync(logPath, `${log.join('\n')}\n`);
console.log(`log written to ${logPath}`);
