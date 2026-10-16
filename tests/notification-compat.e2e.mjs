// Regression: an optional Notification API must never abort application bootstrap.
// All HTTP/WS data below are synthetic: no Codex, credentials, real histories or model calls.
// Rebuild public/app.bundle.js from public/app.js before running (or supply CODEX_WEBUI_TEST_BUNDLE).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { root, artifact, launchOptions } from './browser-runtime.mjs';

const fixtureThread = {
  id: 'notification-compat-thread', name: 'Compatibility history', cwd: '/workspace',
  source: 'local', status: { type: 'idle' }, updatedAt: 1,
  turns: [{ id: 'fixture-turn', status: 'completed', items: [
    { id: 'fixture-answer', type: 'agentMessage', text: 'Saved history fixture' },
  ] }],
};
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/auth-bootstrap.js', ['auth-bootstrap.js', 'text/javascript']],
  ['/codex-brand.js', ['codex-brand.js', 'text/javascript']],
  ['/i18n.js', ['i18n.js', 'text/javascript']],
  ['/app.bundle.js', ['app.bundle.js', 'text/javascript']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
].map(([url, [file, contentType]]) => [url, {
  // A pre-fix bundle can be supplied for the same regression's A/B check.
  body: readFileSync(file === 'app.bundle.js' && process.env.CODEX_WEBUI_TEST_BUNDLE
    ? process.env.CODEX_WEBUI_TEST_BUNDLE : `${root}/public/${file}`),
  contentType,
}]));

async function createClient(browser, name, origin, notificationMode, mobile) {
  const context = await browser.newContext({
    ...(mobile ? devices['iPad Pro 11'] : { viewport: { width: 1440, height: 900 } }),
    locale: 'zh-CN', reducedMotion: 'reduce',
  });
  await context.addInitScript(mode => {
    if (window !== window.top) return;
    localStorage.setItem('codex-webui-locale', 'zh-CN');
    globalThis.__notificationProbe = { requested: 0, created: 0 };
    if (mode === 'missing') {
      delete globalThis.Notification;
      return;
    }
    if (mode === 'native') return;
    class FixtureNotification {
      static permission = mode === 'denied' ? 'denied' : mode === 'granted' ? 'granted' : 'default';
      static requestPermission() {
        globalThis.__notificationProbe.requested++;
        if (mode === 'throws') throw new TypeError('Notification permission is unavailable');
        if (mode === 'rejects') return Promise.reject(new TypeError('Not permitted'));
        FixtureNotification.permission = 'granted';
        return Promise.resolve('granted');
      }
      constructor() { globalThis.__notificationProbe.created++; }
    }
    globalThis.Notification = FixtureNotification;
  }, notificationMode);
  const methods = [];
  await context.routeWebSocket(`${origin.replace(/^http/, 'ws')}/ws`, ws => {
    ws.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type !== 'rpc') return;
      methods.push(message.method);
      const results = {
        'model/list': { data: [{ id: 'gpt-compat', model: 'gpt-compat', displayName: 'GPT-Compat',
          supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], defaultReasoningEffort: 'medium' }] },
        'thread/list': { data: [fixtureThread] },
        'permissionProfile/list': { data: [] },
        'thread/read': { thread: fixtureThread },
        'thread/turns/list': { data: fixtureThread.turns },
        'host/thread/live': { active: false },
      };
      ws.send(JSON.stringify({ type: 'rpc/result', id: message.id, result: results[message.method] || {} }));
    });
    ws.send(JSON.stringify({ type: 'bridge/status', status: 'connected' }));
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, origin, `Unexpected network request: ${url.origin}`);
    const asset = assets.get(url.pathname);
    if (asset) return route.fulfill({ status: 200, ...asset });
    if (url.pathname.startsWith('/vendor/')) return route.fulfill({ status: 200, body: '', contentType: 'text/css' });
    const data = {
      '/api/auth/status': { authenticated: true, setupRequired: false, passwordRequired: false },
      '/api/config': { home: '/home/test', defaultCwd: '/workspace', projectless: false },
      '/api/account': { type: 'unknown', displayName: null, initials: '?' },
      '/api/skills/catalog': { skills: [], curated: [], errors: [], extraRoots: [] },
      '/api/workspace/context': { cwd: '/workspace', project: 'workspace', environment: 'Local', branch: 'test' },
    }[url.pathname];
    assert.ok(data, `Unexpected endpoint: ${url.pathname}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  const initial = await page.evaluate(() => ({
    secure: isSecureContext, notification: typeof globalThis.Notification,
    debug: !!globalThis.__codexWebuiDebug,
    sidebarHandler: typeof document.querySelector('#toggleSidebar').onclick,
    label: document.querySelector('#modelLabel').textContent,
  }));
  assert.ok(initial.debug, `${name}: bootstrap aborted: ${JSON.stringify({ initial, errors })}`);
  assert.equal(initial.sidebarHandler, 'function', `${name}: sidebar handler never bound`);
  return { name, notificationMode, page, context, methods, errors, initial };
}

async function verifyClient(client, mobile, notificationsUnavailable) {
  const { name, page, methods, errors, initial } = client;
  await page.waitForFunction(() => globalThis.__codexWebuiDebug?.state.models.length > 0);
  const narrow = await page.evaluate(() => innerWidth < 720);
  await page.locator('#toggleSidebar').click();
  if (narrow) {
    await page.waitForFunction(() => document.querySelector('#sidebar').classList.contains('mobile-open'));
  } else {
    await page.waitForFunction(() => document.body.classList.contains('sidebar-hidden'));
    await page.locator('#toggleSidebar').click();
    await page.waitForFunction(() => !document.body.classList.contains('sidebar-hidden'));
  }
  await page.locator('.thread-item').click();
  await page.waitForFunction(() => document.querySelector('#conversation').textContent.includes('Saved history fixture'));
  await page.locator('#modelButton').click();
  assert.equal(await page.locator('#modelMenu').isVisible(), true, `${name}: model menu unresponsive`);
  await page.keyboard.press('Escape');
  await page.locator('#modeButton').click();
  assert.equal(await page.locator('#permissionMenu').isVisible(), true, `${name}: permission menu unresponsive`);
  await page.keyboard.press('Escape');
  await page.locator('#accountButton').click();
  await page.waitForSelector('#settingsDialog[open]');
  if (narrow) {
    await page.locator('#toggleSidebar').click();
    await page.waitForFunction(() => !document.querySelector('#sidebar').classList.contains('mobile-open'));
  }
  const toggle = page.locator('#settingsTaskNotifyToggle');
  assert.equal(await toggle.getAttribute('data-unsupported'), String(notificationsUnavailable), `${name}: notification capability not reflected in UI`);
  if (notificationsUnavailable) {
    assert.equal(await toggle.isChecked(), false);
    assert.ok(await toggle.getAttribute('title'), `${name}: unavailable notification setting has no explanation`);
    assert.ok((await page.locator('#settingsTaskNotifyDescription').textContent())?.includes('HTTPS'), `${name}: description did not explain HTTPS/localhost requirement`);
    await page.locator('#settingsTaskNotifyRow').click();
    assert.equal(await toggle.isChecked(), false);
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent?.includes('HTTPS'));
  } else {
    // Exercise both the settings handler and permission requests, including
    // denied/synchronously throwing/asynchronously rejecting implementations.
    await page.locator('#settingsTaskNotifyRow').click();
    await page.locator('#settingsTaskNotifyRow').click();
    await page.waitForFunction(() => localStorage.getItem('codex-webui-task-notify') === 'true');
  }
  // Exercise task-completion notifications too, not only the boot/settings paths.
  await page.evaluate(() => {
    document.hasFocus = () => false;
    globalThis.__codexWebuiDebug.notify('turn/completed', {
      threadId: 'notification-compat-thread', turn: { id: 'fixture-turn', status: 'completed' },
    });
  });
  const probe = await page.evaluate(() => globalThis.__notificationProbe);
  if (notificationsUnavailable) {
    assert.equal(probe.requested, 0, `${name}: unavailable API was invoked`);
    assert.equal(probe.created, 0);
  } else {
    const mode = client.notificationMode;
    assert.equal(probe.requested, ['throws', 'rejects'].includes(mode) ? 2 : mode === 'default' ? 1 : 0,
      `${name}: permission request path was skipped or duplicated`);
    assert.equal(probe.created, ['granted', 'default'].includes(mode) ? 1 : 0,
      `${name}: completion notification path was skipped or called without permission`);
  }
  assert.deepEqual(errors, [], `${name}: browser errors`);
  assert.ok(methods.includes('model/list') && methods.includes('thread/read'), `${name}: connection/history was never loaded`);
  await page.screenshot({ path: artifact(`notification-compat-${name}.png`) });
  return { name, ...initial, modelsLoaded: true, historyLoaded: true, controlsWork: true, probe, errors };
}

const browser = await chromium.launch(launchOptions());
try {
  const cases = [
    // Same insecure origin, simultaneously open: macOS/Chromium still exposes Notification;
    // iPad Safari may omit it completely. Neither condition may break the app.
    ['ipad-http-missing', 'http://192.0.2.2', 'missing', true, true],
    ['mac-http-native', 'http://192.0.2.2', 'native', false, true],
    ['ipad-localhost-missing', 'http://localhost', 'missing', true, true],
    ['desktop-notification-default', 'http://localhost', 'default', false, false],
    ['desktop-notification-denied', 'http://localhost', 'denied', false, false],
    ['desktop-notification-granted', 'http://localhost', 'granted', false, false],
    ['desktop-notification-throws', 'http://localhost', 'throws', false, false],
    ['desktop-notification-rejects', 'http://localhost', 'rejects', false, false],
  ];
  const results = [];
  // Keep the first (iPad) client open while exercising the Mac client on the same origin.
  const clients = [];
  for (const [name, origin, mode, mobile, unavailable] of cases) {
    const client = await createClient(browser, name, origin, mode, mobile);
    clients.push(client);
    results.push(await verifyClient(client, mobile, unavailable));
  }
  // Mac activity must not break the already-open iPad client.
  await clients[0].page.locator('#closeSettingsNav').click();
  await clients[0].page.waitForSelector('#settingsDialog', { state: 'hidden' });
  await clients[0].page.locator('#modelButton').click();
  assert.equal(await clients[0].page.locator('#modelMenu').isVisible(), true);
  assert.deepEqual(clients[0].errors, []);
  console.log(JSON.stringify({ results, existingIpadStillInteractive: true }, null, 2));
} finally {
  await browser.close();
}
