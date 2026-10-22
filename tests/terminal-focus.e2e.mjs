// Real PTY + authenticated browser coverage. No model inference, account
// credentials, user commands or user files are required.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, webkit } from 'playwright';
import { root, launchOptions } from './browser-runtime.mjs';

const engineName = process.env.CODEX_WEBUI_TEST_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engineName));
const engine = engineName === 'webkit' ? webkit : chromium;
const options = engineName === 'webkit'
  ? { headless: true, ...(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH } : {}) }
  : launchOptions();
const home = mkdtempSync(join(tmpdir(), 'codex-terminal-focus-'));
const codexHome = join(home, '.codex'), workspace = join(home, 'workspace');
mkdirSync(codexHome);mkdirSync(workspace);
const password = 'terminal-browser-fixture-password';
const port = await new Promise((resolve, reject) => {
  const socket = createServer();socket.once('error', reject);
  socket.listen(0, '127.0.0.2', () => { const port = socket.address().port;socket.close(() => resolve(port)); });
});
// A second loopback address stays local but does not match the WebUI's
// localhost auth bypass, so HTTP AND WebSocket must use the real login cookie.
const base = `http://127.0.0.2:${port}`;
const readinessAuthorization = `Basic ${Buffer.from(`codex:${password}`).toString('base64')}`;
for (const key of ['NO_PROXY', 'no_proxy']) process.env[key] = [process.env[key], '127.0.0.2'].filter(Boolean).join(',');
const server = Bun.spawn(['bun', 'run', 'server.ts'], {
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
const contextOptions = viewport => ({ viewport, deviceScaleFactor: 2 });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { if ((await (await fetch(`${base}/api/health`, { headers: { authorization: readinessAuthorization } })).json()).codex) { ready = true;break; } } catch {}
    await Bun.sleep(100);
  }
  assert.ok(ready, 'isolated terminal server did not become ready');
  browser = await engine.launch(options);
  for (const width of [1360, 1000, 390]) {
    const context = await browser.newContext(contextOptions({ width, height: 900 }));
    await context.addInitScript(() => { if (window === window.top) localStorage.setItem('codex-webui-locale', 'en'); });
    const page = await context.newPage();const errors = [];let sockets = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => { if (new URL(socket.url()).pathname === '/terminal') sockets++; });
    await page.goto(base);
    await page.waitForSelector('#passwordGate:not([hidden])');
    assert.equal((await (await context.request.get(`${base}/api/auth/status`)).json()).authenticated, false);
    if (width === 1360) {
      const denied = await page.evaluate(url => new Promise(resolve => {
        const socket = new WebSocket(url);const timer = setTimeout(() => { socket.close();resolve('timeout'); }, 3000);
        socket.onopen = () => { clearTimeout(timer);socket.close();resolve('unexpected-open'); };
        socket.onerror = () => { clearTimeout(timer);resolve('denied'); };
      }), base.replace('http:', 'ws:') + '/terminal');
      assert.equal(denied, 'denied', 'browser fixture must enforce terminal authentication');
      sockets = 0;
    }
    await page.fill('#passwordInput', password);await page.click('#passwordLoginButton');
    await page.waitForFunction(() => Boolean(globalThis.__codexWebuiDebug));
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const openTerminal = async () => {
      await page.evaluate(() => globalThis.__codexWebuiDebug.setSidebarOpen(true));
      await page.click('#sidebarTerminalButton');
      await page.waitForFunction(() => document.querySelector('#sideTerminalHost')?.dataset.connected === 'true');
      await frames();
    };
    const assertInputWorks = async phase => {
      const focused = await page.evaluate(() => Boolean(document.activeElement?.closest('#sideTerminalHost')));
      assert.ok(focused, `${width}px ${phase}: opening a terminal must focus its input, not the close button`);
      const marker = `PTY_FOCUS_${width}_${phase}_OK`;
      await page.keyboard.type(`printf '%s%s\\n' 'PTY_FOCUS_${width}_${phase}_' 'OK'`);
      await page.keyboard.press('Enter');
      await page.waitForFunction(marker => {
        const term = globalThis.__codexTerminals?.side?.term;
        return term && Array.from({ length: term.buffer.active.length }, (_, i) => term.buffer.active.getLine(i)?.translateToString(true) || '').some(line => line.includes(marker));
      }, marker, { timeout: 5000 });
    };
    await openTerminal();await assertInputWorks('first');
    await page.click('#closeSidePanel');await openTerminal();await assertInputWorks('reopened');
    assert.equal(sockets, 1, 'reopening must reuse the connected PTY');
    await page.evaluate(() => new Promise(resolve => globalThis.__codexTerminals.side.term.write('\r\nPRIVATE_DIAGNOSTICS_FIXTURE\r\n', resolve)));
    await page.click('#sideTerminalDiagnostics');
    await page.waitForFunction(() => JSON.parse(document.querySelector('#terminalDiagnosticsText').textContent).httpAuthenticated === true);
    const rawDiagnostics = await page.textContent('#terminalDiagnosticsText'), diagnostics = JSON.parse(rawDiagnostics);
    assert.equal(diagnostics.phase, 'connected');assert.ok(diagnostics.receivedBytes > 0);assert.ok(diagnostics.rowsWithText > 0);assert.equal(diagnostics.xtermStylesLoaded, true);
    assert.ok(!rawDiagnostics.includes('PRIVATE_DIAGNOSTICS_FIXTURE') && !rawDiagnostics.includes(password));
    await page.evaluate(() => { document.execCommand = command => { if (command !== 'copy') return false;globalThis.__copiedTerminalDiagnostics = document.activeElement.value;return true; }; });
    await page.click('#copyTerminalDiagnostics');
    assert.equal(await page.evaluate(() => globalThis.__copiedTerminalDiagnostics), rawDiagnostics, 'copy must include only the safe diagnostic JSON');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#sidePanel').isVisible(), true, 'closing diagnostics must not close the terminal');
    page.once('dialog', dialog => dialog.dismiss());await page.click('#sideTerminalReconnect');
    assert.equal(sockets, 1, 'cancelling restart must preserve the shell');
    page.once('dialog', dialog => dialog.accept());await page.click('#sideTerminalReconnect');
    await page.waitForFunction(() => globalThis.__codexTerminals?.side?.connectionAttempts === 2 && document.querySelector('#sideTerminalHost')?.dataset.connected === 'true');
    await frames();await assertInputWorks('reconnected');assert.equal(sockets, 2);

    const handle = page.locator('#sidePanelResizeHandle');
    if (width > 720) {
      const initialWidth = await page.locator('#sidePanel').evaluate(node => node.getBoundingClientRect().width);
      const oldCols = await page.evaluate(() => globalThis.__codexTerminals.side.term.cols);
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + 3, box.y + 80);await page.mouse.down();
      await page.mouse.move(box.x - 97, box.y + 80, { steps: 8 });await page.mouse.up();
      await page.waitForFunction(width => document.querySelector('#sidePanel').getBoundingClientRect().width >= width + 90, initialWidth);
      await page.waitForFunction(cols => globalThis.__codexTerminals.side.term.cols > cols, oldCols);
      assert.equal(await page.evaluate(() => document.body.classList.contains('resizing-right-panel')), false);
      await assertInputWorks('resized');
      const draggedWidth = await page.locator('#sidePanel').evaluate(node => node.getBoundingClientRect().width);
      await handle.focus();await page.keyboard.press('Shift+ArrowLeft');
      const persisted = Number(await page.evaluate(() => localStorage.getItem('codex-webui-right-panel-width')));
      assert.ok(persisted >= draggedWidth + 49);
      await page.reload();await page.waitForFunction(() => Boolean(globalThis.__codexWebuiDebug));await openTerminal();
      assert.ok(Math.abs((await page.locator('#sidePanel').evaluate(node => node.getBoundingClientRect().width)) - persisted) <= 1);
      await handle.dblclick();
      assert.equal(await page.evaluate(() => localStorage.getItem('codex-webui-right-panel-width')), '340');
      await page.setViewportSize({ width: 390, height: 900 });await frames();assert.equal(await handle.isVisible(), false);
      await page.setViewportSize({ width, height: 900 });await frames();
      assert.ok(Math.abs((await page.locator('#sidePanel').evaluate(node => node.getBoundingClientRect().width)) - 340) <= 1);
      if (width === 1360) {
        await page.evaluate(() => globalThis.__codexWebuiDebug.setSidebarOpen(false, { manual: true }));
        await handle.focus();await page.keyboard.press('End');
        const widePreference = Number(await page.evaluate(() => localStorage.getItem('codex-webui-right-panel-width')));
        assert.ok(widePreference > 900);
        await page.click('#toggleSidebar');
        await page.locator('#sidebar').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
        assert.ok((await page.locator('.conversation-shell').evaluate(node => node.getBoundingClientRect().width)) >= 400, 'opening the left sidebar must re-clamp the right panel after its animation');
        assert.equal(Number(await page.evaluate(() => localStorage.getItem('codex-webui-right-panel-width'))), widePreference, 'responsive clamps must not overwrite the user preference');
      }
    } else assert.equal(await handle.isVisible(), false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);await context.close();
    console.log(`${engineName}: authenticated terminal ${width}px passed: real output, focus, reconnect, diagnostics and panel resize`);
  }

  // A socket can open without delivering a single shell frame. This must be
  // visible to the user instead of looking like a healthy blank terminal.
  const context = await browser.newContext(contextOptions({ width: 1360, height: 900 }));
  await context.addInitScript(() => { if (window === window.top) localStorage.setItem('codex-webui-locale', 'en'); });
  await context.request.post(`${base}/api/auth/login`, { data: { password } });
  await context.routeWebSocket(new RegExp(`^ws://127\\.0\\.0\\.2:${port}/terminal`), socket => { socket.onMessage(() => {}); });
  const page = await context.newPage();await page.goto(base);await page.waitForFunction(() => Boolean(globalThis.__codexWebuiDebug));
  await page.evaluate(() => globalThis.__codexWebuiDebug.openUtilityPanel('terminal'));
  await page.waitForFunction(() => document.querySelector('#sideTerminalStatus')?.dataset.state === 'waiting-output', null, { timeout: 6000 });
  await page.click('#sideTerminalDiagnostics');
  await page.waitForFunction(() => JSON.parse(document.querySelector('#terminalDiagnosticsText').textContent).httpAuthenticated === true);
  const silent = JSON.parse(await page.textContent('#terminalDiagnosticsText'));
  assert.equal(silent.receivedBytes, 0);assert.equal(silent.rowsWithText, 0);assert.equal(silent.phase, 'waiting-output');
  await context.close();console.log(`${engineName}: silent terminal reports waiting for shell output`);
  const failedContext = await browser.newContext(contextOptions({ width: 1360, height: 900 }));
  await failedContext.request.post(`${base}/api/auth/login`, { data: { password } });
  await failedContext.routeWebSocket(new RegExp(`^ws://127\\.0\\.0\\.2:${port}/terminal`), socket => { socket.close({ code: 1011, reason: 'Fixture terminal unavailable' }); });
  const failedPage = await failedContext.newPage();await failedPage.goto(base);await failedPage.waitForFunction(() => Boolean(globalThis.__codexWebuiDebug));
  await failedPage.evaluate(() => globalThis.__codexWebuiDebug.openUtilityPanel('terminal'));
  await failedPage.waitForFunction(() => globalThis.__codexTerminals?.side?.lastCloseCode === 1011);
  await failedPage.click('#sideTerminalDiagnostics');
  await failedPage.waitForFunction(() => JSON.parse(document.querySelector('#terminalDiagnosticsText').textContent).httpAuthenticated === true);
  const failed = JSON.parse(await failedPage.textContent('#terminalDiagnosticsText'));
  assert.equal(failed.lastCloseCode, 1011);assert.equal(failed.lastCloseReason, 'Fixture terminal unavailable');assert.equal(failed.receivedBytes, 0);
  await failedContext.close();console.log(`${engineName}: failed terminal reports close status without exposing output`);
} finally {
  await browser?.close();server.kill('SIGTERM');
  const stopped = await Promise.race([server.exited.then(() => true), Bun.sleep(7000).then(() => false)]);
  if (!stopped) { server.kill('SIGKILL');await server.exited; }
  rmSync(home, { recursive: true, force: true });
}
