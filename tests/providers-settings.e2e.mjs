// Provider settings surface smoke test: real server + disposable store, mocked
// conversation RPCs (model/list is mocked to prove custom entries survive the
// frontend filter and render in the model picker).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import { root, artifact, launchOptions } from './browser-runtime.mjs';
import { providerCatalogModels } from '../server/model-providers.ts';

const home = mkdtempSync(join(tmpdir(), 'codex-webui-providers-e2e-'));
const codexHome = join(home, '.codex');
const workspace = join(home, 'workspace');
mkdirSync(codexHome, { recursive: true });
mkdirSync(workspace, { recursive: true });
const modelsJson = join(home, 'models.json');
let discoveryFailure = false;
const discoveryRequests = [];
const discoveryServer = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request) {
  discoveryRequests.push({ path: new URL(request.url).pathname, key: request.headers.get('authorization') });
  return discoveryFailure ? new Response('Do not echo vendor errors', { status: 401 })
    : Response.json({ data: [{ id: 'e2e-model' }, { id: 'e2e-model-2' }, { id: 'e2e-discovered' }] });
} });
const fixtureEndpoint = `http://127.0.0.1:${discoveryServer.port}/v1`;
writeFileSync(modelsJson, JSON.stringify({
  version: 1,
  providers: [{
    id: 'e2e-demo',
    name: 'E2E Demo Provider',
    baseUrl: fixtureEndpoint,
    apiKey: 'e2e-secret-key',
    models: [{ id: 'e2e-model', displayName: 'E2E Model', efforts: ['low', 'medium', 'high'] }],
  }],
}, null, 2));

const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
});
const base = `http://127.0.0.1:${port}`;
const server = Bun.spawn(['bun', 'run', 'server.ts'], {
  cwd: root,
  env: {
    ...process.env,
    HOME: home,
    CODEX_HOME: codexHome,
    CODEX_WEBUI_CWD: workspace,
    CODEX_WEBUI_REVIEW_ROOT: workspace,
    CODEX_WEBUI_MODELS_JSON: modelsJson,
    CODEX_WEBUI_AUTH_STORE: join(home, 'webui-auth.json'),
    CODEX_WEBUI_PASSWORD: '',
    CODEX_WEBUI_ACCESS_TOKEN: '',
    HOST: '127.0.0.1',
    PORT: String(port),
  },
  stdout: 'ignore',
  stderr: 'pipe',
});
const stderrPromise = new Response(server.stderr).text();
const api = async (path, body, method = 'POST') => {
  const response = await fetch(`${base}${path}`, body === undefined ? undefined : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
};

let browser, page;
try {
  let ready = false;
  for (let i = 0; i < 160; i++) { try { if ((await api('/api/health')).data.codex) { ready = true; break; } } catch {} await Bun.sleep(50); }
  assert.ok(ready, 'Test Codex bridge did not initialize');

  browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, colorScheme: 'dark' });
  await context.addInitScript(() => { if (window === window.top) localStorage.setItem('codex-webui-locale', 'en'); });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.routeWebSocket(`ws://127.0.0.1:${port}/ws`, ws => {
    ws.onMessage(raw => {
      const msg = JSON.parse(String(raw));
      if (msg.type !== 'rpc') return;
      let result = {};
      if (msg.method === 'model/list') {
        result = { data: [
          { model: 'gpt-fixture', displayName: 'Fixture', isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
          ...providerCatalogModels(JSON.parse(readFileSync(modelsJson, 'utf8')).providers),
        ] };
      } else if (['thread/list', 'permissionProfile/list', 'thread/turns/list'].includes(msg.method)) result = { data: [] };
      ws.send(JSON.stringify({ type: 'rpc/result', id: msg.id, result }));
    });
    ws.send(JSON.stringify({ type: 'bridge/status', status: 'connected' }));
  });

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__codexWebuiDebug?.state.threadsLoaded);

  // The custom model survives the GPT-only picker filter and is selectable.
  await page.click('#modelButton');
  await page.click('#modelSubmenuButton');
  await page.waitForSelector('.model-option[data-model="e2e-model"]');
  await page.click('.model-option[data-model="e2e-model"]');
  assert.ok(String(await page.textContent('#modelLabel')).includes('E2E Model'));
  await page.evaluate(() => {
    localStorage.setItem('codex-webui-model', 'gpt-fixture');
    localStorage.setItem('codex-webui-effort:e2e-model', 'low');
    const debug = globalThis.__codexWebuiDebug;
    debug.state.active = { id: 'fixture-active-chat', model: 'e2e-model' };
    document.querySelector('#effortSelect').value = 'high';
    debug.renderModels();
  });
  assert.equal(await page.inputValue('#effortSelect'), 'high', 'active chat effort wins over global effort');
  assert.ok(String(await page.textContent('#modelLabel')).includes('E2E Model'));

  // Settings: providers page lists the configured provider without the API key.
  await page.evaluate(() => globalThis.__codexWebuiDebug.openSettings('providers'));
  await page.waitForSelector('[data-settings-content="providers"]:not([hidden])');
  await page.waitForSelector('#providerRows .provider-meta');
  const rowText = await page.textContent('#providerRows');
  assert.ok(rowText.includes('E2E Demo Provider'));
  assert.ok(rowText.includes(fixtureEndpoint));
  assert.ok(rowText.includes('e2e-model'));
  assert.ok(!rowText.includes('e2e-secret-key'), 'API key must not reach the DOM');

  // Saving an edit persists to the store (name + extra model) through the real API.
  await page.click('#providerRows .provider-actions button:first-child');
  await page.waitForSelector('#providerForm:not([hidden])');
  assert.equal(await page.inputValue('#providerIdInput'), 'e2e-demo');
  assert.ok(await page.locator('#providerIdInput').isDisabled(), 'provider id is immutable after creation');
  await page.fill('#providerNameInput', 'Renamed Demo');
  await page.fill('#providerModelsInput', 'e2e-model | E2E Model | low,high\ne2e-model-2');
  await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('show'));
  await page.click('#providerSaveButton');
  await page.waitForFunction(() => String(document.querySelector('#toast')?.textContent || '').includes('Provider saved'), null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#providerRows')?.textContent.includes('Renamed Demo'));
  const stored = JSON.parse(readFileSync(modelsJson, 'utf8'));
  assert.equal(stored.providers[0].name, 'Renamed Demo');
  assert.equal(stored.providers[0].apiKey, 'e2e-secret-key', 'omitted key must be preserved');
  assert.deepEqual(stored.providers[0].models.map(model => model.id), ['e2e-model', 'e2e-model-2']);
  // Editing only model metadata no longer restarts Codex, but must refresh the
  // initiating tab's picker even while it ignores its own broadcast.
  await page.click('#providerRows .provider-actions button:first-child');
  await page.fill('#providerModelsInput', `${await page.inputValue('#providerModelsInput')}\ne2e-local-only`);
  const metadataResponse = page.waitForResponse(response => response.url() === `${base}/api/providers` && response.request().method() === 'POST');
  await page.click('#providerSaveButton');
  assert.equal((await (await metadataResponse).json()).restarted, false);
  await page.waitForFunction(() => !document.querySelector('#providerAddButton').disabled);
  assert.ok((await page.evaluate(() => globalThis.__codexWebuiDebug.state.models.map(model => model.model))).includes('e2e-local-only'));

  // Client-side model parsing errors surface as a toast.
  await page.click('#providerRows .provider-actions button:first-child');
  await page.waitForSelector('#providerForm:not([hidden])');
  await page.fill('#providerModelsInput', '');
  await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('show'));
  await page.click('#providerSaveButton');
  await page.waitForFunction(() => String(document.querySelector('#toast')?.textContent || '').includes('at least one model'), null, { timeout: 15000 });

  await page.click('#providerCancelButton');
  // Leave a snapshot editor open while model selection/discovery change in the
  // same tab; saving that snapshot must return 409 instead of losing changes.
  await page.click('#providerRows .provider-actions button:first-child');
  const group = '[data-provider-id="e2e-demo"].provider-group';
  await page.click(`${group} .provider-models > summary`);
  const toggle = async selector => {
    await page.locator(selector).locator('..').click();
    await page.waitForFunction(() => !document.querySelector('#providerAddButton').disabled);
  };
  const firstModel = `${group} input[data-model-id="e2e-model"]`;
  await toggle(firstModel);
  assert.equal(await page.locator(firstModel).isChecked(), false);
  assert.ok(!(await page.evaluate(() => globalThis.__codexWebuiDebug.state.models.map(model => model.model))).includes('e2e-model'));
  assert.equal(JSON.parse(readFileSync(modelsJson, 'utf8')).providers[0].apiKey, 'e2e-secret-key');
  await toggle(`${group} .provider-actions input[role="switch"]`);
  assert.equal(await page.locator(firstModel).isChecked(), true, 'provider switch enables the whole model group');

  await page.click(`[data-refresh-provider="e2e-demo"]`);
  await page.waitForFunction(() => !document.querySelector('#providerAddButton').disabled);
  assert.equal(discoveryRequests.at(-1).path, '/v1/models');
  assert.equal(discoveryRequests.at(-1).key, 'Bearer e2e-secret-key');
  const discoveredModel = `${group} input[data-model-id="e2e-discovered"]`;
  assert.ok(await page.locator(discoveredModel).isVisible());
  assert.equal(await page.locator(discoveredModel).isChecked(), false);
  assert.ok((await page.textContent(`${group} .provider-refresh-info`)).includes('Provider catalog refreshed'));
  assert.ok(!(await page.evaluate(() => globalThis.__codexWebuiDebug.state.models.map(model => model.model))).includes('e2e-discovered'));
  await toggle(discoveredModel);
  assert.ok((await page.evaluate(() => globalThis.__codexWebuiDebug.state.models.map(model => model.model))).includes('e2e-discovered'));
  const beforeFailure = readFileSync(modelsJson, 'utf8');
  discoveryFailure = true;
  await page.click(`[data-refresh-provider="e2e-demo"]`);
  await page.waitForFunction(() => !document.querySelector('#providerAddButton').disabled);
  assert.ok(String(await page.textContent('#toast')).includes('request failed'));
  assert.equal(readFileSync(modelsJson, 'utf8'), beforeFailure, 'failed refresh must not overwrite existing settings');
  discoveryFailure = false;
  const staleResponse = page.waitForResponse(response => response.url() === `${base}/api/providers` && response.request().method() === 'POST');
  await page.click('#providerSaveButton');
  assert.equal((await staleResponse).status(), 409);
  await page.waitForFunction(() => !document.querySelector('#providerAddButton').disabled);
  assert.ok(String(await page.textContent('#toast')).includes('Reopen the editor'));
  assert.equal(readFileSync(modelsJson, 'utf8'), beforeFailure, 'stale editor must not remove discoveries or undo switches');
  assert.ok(await page.locator('#providerForm').isVisible());
  await page.click('#providerCancelButton');
  // Global refresh is exercised before adding GLM, so no vendor is contacted.
  await page.click('#providerRefreshAllButton');
  await page.waitForFunction(() => !document.querySelector('#providerAddButton').disabled);
  assert.ok(String(await page.textContent('#toast')).includes('1/1'));

  await page.click('[data-preset-id="custom"] .provider-card-main');
  assert.equal(await page.locator('#providerPresetSelect').count(), 0);
  assert.equal(await page.inputValue('#providerIdInput'), '');
  assert.equal(await page.inputValue('#providerBaseUrlInput'), '');
  assert.equal(await page.locator('#providerAdvancedDetails').evaluate(node => node.open), true);
  await page.click('#providerCancelButton');

  // Built-in presets: selecting the vendor fills every field; only the key
  // needs typing. Changing vendors must never carry a secret to another URL.
  assert.equal(await page.locator('.provider-preset-card').count(), 4);
  assert.ok(await page.locator('[data-preset-id="zai-cn"] input[role="switch"]').isDisabled());
  await page.click('[data-preset-id="zai-cn"] .provider-card-main');
  assert.equal(await page.locator('#providerPresetSelect').count(), 0, 'provider dropdown was removed, not merely hidden');
  assert.ok((await page.textContent('#providerEditorTitle')).includes('China'));
  assert.equal(await page.inputValue('#providerBaseUrlInput'), 'https://open.bigmodel.cn/api/v1');
  assert.equal(await page.locator('#providerAdvancedDetails').evaluate(node => node.open), false);
  await page.fill('#providerApiKeyInput', 'must-not-follow-preset-switch');
  await page.click('[data-preset-id="deepseek"] .provider-card-main');
  assert.equal(await page.inputValue('#providerApiKeyInput'), '');
  assert.equal(await page.inputValue('#providerIdInput'), 'deepseek');
  assert.equal(await page.inputValue('#providerBaseUrlInput'), 'https://api.deepseek.com');
  assert.ok((await page.inputValue('#providerModelsInput')).includes('deepseek-flash'));
  await page.click('[data-preset-id="zai-cn"] .provider-card-main');
  await page.fill('#providerApiKeyInput', 'e2e-glm-key');
  let releaseSave, requestArrived, saveCount = 0;
  const gate = new Promise(resolve => { releaseSave = resolve; });
  const arrived = new Promise(resolve => { requestArrived = resolve; });
  await page.route(`${base}/api/providers`, async route => {
    if (route.request().method() === 'POST') { saveCount++; requestArrived(); await gate; }
    await route.continue();
  });
  const savedResponse = page.waitForResponse(response => response.url() === `${base}/api/providers` && response.request().method() === 'POST');
  await page.click('#providerSaveButton');
  await arrived;
  assert.ok(await page.locator('#providerCancelButton').isDisabled());
  assert.ok(await page.locator('#providerAddButton').isDisabled());
  assert.ok(await page.locator('[data-preset-id="deepseek"] .provider-card-main').isDisabled());
  await page.evaluate(() => {
    document.querySelector('#providerCancelButton').onclick();
    document.querySelector('#providerAddButton').onclick();
    document.querySelector('[data-preset-id="deepseek"] .provider-card-main').onclick();
    document.querySelector('#providerForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(await page.inputValue('#providerApiKeyInput'), 'e2e-glm-key', 'pending save cannot replace or clear its editor');
  assert.ok(await page.locator('#providerForm').isVisible());
  assert.equal(saveCount, 1, 'overlapping mutations must be prevented');
  releaseSave();
  assert.equal((await savedResponse).status(), 200);
  await page.unroute(`${base}/api/providers`);
  await page.waitForSelector('#providerForm[hidden]', { state: 'attached' });
  const presetStored = JSON.parse(readFileSync(modelsJson, 'utf8'));
  assert.equal(presetStored.providers.length, 2, 'custom provider must survive a preset save');
  const glm = presetStored.providers.find(provider => provider.id === 'zai');
  assert.equal(glm.apiKey, 'e2e-glm-key');
  assert.equal(glm.baseUrl, 'https://open.bigmodel.cn/api/v1');
  assert.equal(glm.models[0].id, 'glm-5.3');
  assert.deepEqual(glm.models[0].efforts, ['low', 'high', 'max']);
  assert.ok(!(await page.textContent('#providerRows')).includes('e2e-glm-key'));
  assert.equal(await page.inputValue('#providerApiKeyInput'), '', 'successful saves clear the secret input');
  await page.waitForFunction(() => !document.querySelector('#providerAddButton').disabled);
  assert.equal(await page.evaluate(() => globalThis.__codexWebuiDebug.state.selectedModel), 'e2e-model', 'provider save refresh preserves active model');
  assert.equal(await page.inputValue('#effortSelect'), 'high');
  await page.evaluate(() => globalThis.__codexWebuiDebug.loadInitial());
  assert.equal(await page.evaluate(() => globalThis.__codexWebuiDebug.state.selectedModel), 'e2e-model', 'bridge reconnect refresh preserves active model');
  assert.equal(await page.inputValue('#effortSelect'), 'high');
  await page.evaluate(() => {
    const debug = globalThis.__codexWebuiDebug;
    debug.state.selectedModel = 'removed-custom-model';
    debug.renderModels();
  });
  assert.equal(await page.evaluate(() => globalThis.__codexWebuiDebug.state.selectedModel), 'removed-custom-model', 'removed model must not silently switch providers');
  await page.evaluate(() => { const debug = globalThis.__codexWebuiDebug; debug.state.active = null; debug.renderModels(); });
  const glmSwitch = '[data-preset-id="zai-cn"] input[role="switch"]';
  assert.equal(await page.locator('[data-preset-id="zai-cn"]').getAttribute('data-configured'), 'true');
  await toggle(glmSwitch);
  assert.equal(await page.locator(glmSwitch).isChecked(), false);
  const disabledGlm = JSON.parse(readFileSync(modelsJson, 'utf8')).providers.find(provider => provider.id === 'zai');
  assert.equal(disabledGlm.apiKey, 'e2e-glm-key');
  assert.equal(disabledGlm.enabled, false);
  await toggle(glmSwitch);
  assert.equal(await page.locator(glmSwitch).isChecked(), true);

  await page.click('#providerAddButton');
  // Regression for the reported black rectangle: require readable opaque text
  // and at least WCAG AA text contrast, in both existing themes.
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => globalThis.__codexWebuiDebug.setThemePreference(theme), theme);
    const colors = await page.locator('#providerSaveButton').evaluate(button => {
      const style = getComputedStyle(button);
      return { fg: style.color, bg: style.backgroundColor, text: button.textContent.trim() };
    });
    assert.equal(colors.text, 'Save provider');
    const rgb = value => value.match(/[\d.]+/g).map(Number);
    const fg = rgb(colors.fg), bg = rgb(colors.bg);
    assert.ok(fg.length === 3 || fg[3] === 1, 'button text must be opaque');
    const luminance = channels => channels.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const lum = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
    assert.ok((lum[1] + .05) / (lum[0] + .05) >= 4.5, `${theme}: save text contrast too low`);
    await page.locator('#settingsContent').evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: artifact(`providers-cards-${theme}.png`), fullPage: false });
  }

  await page.evaluate(() => globalThis.__codexWebuiI18n.setPreference('zh-CN'));
  await page.waitForFunction(() => document.querySelector('#providerSaveButton').textContent === '保存提供商');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('#settingsDialog').dataset.mobilePage === 'true');
  assert.equal(await page.locator('#providerPresetSelect').count(), 0);
  assert.ok(await page.locator('#providerApiKeyInput').isVisible());
  assert.ok((await page.textContent('#providerEditorTitle')).includes('国内'));
  const dimensions = await page.locator('[data-settings-content="providers"]').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.width + 1, 'preset page must not overflow horizontally on mobile');
  await page.screenshot({ path: artifact('providers-presets-mobile-zh.png'), fullPage: false });
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  discoveryServer.stop(true);
  server.kill('SIGTERM');
  const exited = await Promise.race([server.exited.then(() => true), Bun.sleep(5000).then(() => false)]);
  if (!exited) server.kill('SIGKILL');
  await server.exited;
  rmSync(home, { recursive: true, force: true });
}
const stderr = await stderrPromise;
if (stderr) console.log(`[server stderr]\n${stderr.slice(0, 4000)}`);
console.log('providers settings e2e passed');
