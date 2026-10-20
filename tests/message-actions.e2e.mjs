// Isolated conversation fixtures: no user messages, SSH keys, model inference
// or reads of existing clipboard contents. Clipboard payloads are fixtures;
// covers layout, API fallback and a real browser DOM copy event.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, webkit } from 'playwright';
import { root, artifact, launchOptions } from './browser-runtime.mjs';

const engineName = process.env.CODEX_WEBUI_TEST_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engineName));
const engine = engineName === 'webkit' ? webkit : chromium;
const options = engineName === 'webkit'
  ? { headless: true, ...(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH } : {}) }
  : launchOptions();
const home = mkdtempSync(join(tmpdir(), 'codex-message-actions-'));
const workspace = join(home, 'workspace'), codexHome = join(home, '.codex');mkdirSync(workspace);mkdirSync(codexHome);
const port = await new Promise((resolve, reject) => { const s = createServer();s.on('error', reject);s.listen(0, '127.0.0.1', () => { const p = s.address().port;s.close(() => resolve(p)); }); });
const base = `http://127.0.0.1:${port}`;
const server = Bun.spawn(['bun', 'run', 'server.ts'], { cwd: root, env: {
  ...process.env, HOME: home, CODEX_HOME: codexHome, CODEX_AUTH_PATH: join(codexHome, 'auth.json'),
  CODEX_WEBUI_CWD: workspace, CODEX_WEBUI_REVIEW_ROOT: workspace, CODEX_WEBUI_MODELS_JSON: join(home, 'models.json'),
  CODEX_WEBUI_AUTH_STORE: join(home, 'auth.json'), CODEX_WEBUI_PASSWORD: '', CODEX_WEBUI_ACCESS_TOKEN: '',
  CODEX_WEBUI_PROJECTLESS: 'false', CODEX_WEBUI_SKILL_EXTRA_ROOTS: '', HOST: '127.0.0.1', PORT: String(port),
}, stdout: 'ignore', stderr: 'ignore' });
const longToken = 'FAKE_PUBLIC_KEY_FIXTURE_' + 'AbCd0123456789'.repeat(130);
const userText = `Settings\nFixture shell transcript\nssh-rsa ${longToken} fixture@example.invalid\nsecond line\nssh-ed25519 ${longToken}\nend`;
const codeOne = `  printf '%s\\n' '<tag> & "quoted"'\n\tprintf '中文 😀'`;
const codeTwo = `const fixture = "${longToken}";`;
const agentText = `## Copyable response\n\nText with **Markdown** and 中文.\n\n\`\`\`bash\n${codeOne}\n\`\`\`\n\n\`\`\`js\n${codeTwo}\n\`\`\`\n\n\`\`\`html\n<img src=x onerror="window.__copyInjection=true">\n\`\`\``;
let browser;
try {
  let ready = false;for (let i = 0; i < 150; i++) { try { if ((await (await fetch(`${base}/api/health`)).json()).codex) { ready = true;break; } } catch {} await Bun.sleep(100); }
  assert.ok(ready);
  browser = await engine.launch(options);
  for (const width of [1360, 1000, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'light', ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) });
    await context.addInitScript(() => { if (window === window.top) localStorage.setItem('codex-webui-locale', 'en'); });
    const page = await context.newPage(), errors = [], inferenceCalls = [];
    page.on('pageerror', error => errors.push(error.message));
    const thread = { id: 'copy-fixture-thread', cwd: workspace, source: 'local', name: 'Copy fixture', recencyAt: Math.floor(Date.now() / 1000), updatedAt: Math.floor(Date.now() / 1000), turns: [] };
    await context.routeWebSocket(`ws://127.0.0.1:${port}/ws`, socket => {
      socket.onMessage(raw => {
        const message = JSON.parse(String(raw));if (message.type !== 'rpc') return;
        if (['turn/start', 'turn/steer'].includes(message.method)) inferenceCalls.push(message.method);
        let result = {};
        if (message.method === 'model/list') result = { data: [{ model: 'gpt-copy-fixture', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low' }] };
        else if (message.method === 'thread/list') result = { data: [thread] };
        else if (message.method === 'permissionProfile/list' || message.method === 'thread/turns/list') result = { data: [] };
        else if (message.method === 'thread/read' || message.method === 'thread/resume') result = { thread };
        socket.send(JSON.stringify({ type: 'rpc/result', id: message.id, result }));
      });
      socket.send(JSON.stringify({ type: 'bridge/status', status: 'connected' }));
    });
    await page.goto(base);await page.waitForFunction(() => globalThis.__codexWebuiDebug?.state.threadsLoaded);
    await page.evaluate(({ thread, userText, agentText }) => {
      const api = globalThis.__codexWebuiDebug;api.state.active = thread;
      api.notify('item/completed', { threadId: thread.id, turnId: 'copy-turn', item: { id: 'local-copy-user', type: 'userMessage', content: [{ type: 'text', text: userText }] } });
      api.notify('item/completed', { threadId: thread.id, turnId: 'copy-turn', item: { id: 'server-copy-user', type: 'userMessage', content: [{ type: 'text', text: userText }] } });
      api.notify('item/completed', { threadId: thread.id, turnId: 'copy-turn', item: { id: 'copy-assistant', type: 'agentMessage', text: agentText } });
      document.querySelector('#prompt').value = 'Keep this draft unchanged';
      globalThis.__copies = [];globalThis.__copyAllowed = true;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { if (!globalThis.__copyAllowed) throw new Error('fixture clipboard permission denied');globalThis.__copies.push({ path: 'native', text }); } } });
      globalThis.__nativeExecCommand = document.execCommand.bind(document);
      document.execCommand = command => { if (command !== 'copy' || !globalThis.__copyAllowed) return false;globalThis.__copies.push({ path: 'fallback', text: document.activeElement.value });return true; };
      globalThis.__fixtureExecCommand = document.execCommand;
    }, { thread, userText, agentText });
    const user = page.locator('.user-turn'), assistant = page.locator('[data-local-conversation-final-assistant]');
    assert.equal(await user.count(), 1, 'copy actions must not break optimistic reconciliation');
    assert.equal(await user.locator('.user-message').textContent(), userText);
    assert.equal(await assistant.locator('pre > code').count(), 3);
    assert.equal(await assistant.locator('[data-copy-kind="code"]').count(), 3);

    // Controlled before/after demonstrates that unbreakable tokens, not image
    // width or text truncation, caused the original bubble overflow.
    const oldStyle = await page.addStyleTag({ content: '.user-message{overflow-wrap:normal!important;word-break:normal!important}' });
    assert.ok(await user.locator('.user-message').evaluate(node => node.scrollWidth > node.clientWidth));
    await oldStyle.evaluate(node => node.remove());
    const assertLayout = async () => {
      const geometry = await page.evaluate(() => {
        const bubble = document.querySelector('.user-message'), b = bubble.getBoundingClientRect();
        const wrappers = [...document.querySelectorAll('.code-block-copy')].map(node => { const rect = node.getBoundingClientRect();return { left: rect.left, right: rect.right, width: rect.width, parent: node.closest('.message-text').getBoundingClientRect().right }; });
        return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bubbleWidth: bubble.clientWidth, bubbleScroll: bubble.scrollWidth, bubbleLeft: b.left, bubbleRight: b.right, wrappers };
      });
      assert.ok(geometry.documentWidth <= geometry.viewport + 1);
      assert.ok(geometry.bubbleScroll <= geometry.bubbleWidth + 1, `${engineName} ${width}px: user text overflows its bubble`);
      assert.ok(geometry.bubbleLeft >= 0 && geometry.bubbleRight <= geometry.viewport + 1);
      assert.ok(geometry.wrappers.every(block => block.left >= 0 && block.right <= block.parent + 1 && block.right <= geometry.viewport + 1));
    };
    await assertLayout();
    if (width === 1360) { await page.click('#toggleSidePanel');await page.waitForFunction(() => !document.querySelector('#sidePanel').hidden);await assertLayout();await page.click('#closeSidePanel'); }
    await page.evaluate(open => globalThis.__codexWebuiDebug.setSidebarOpen(open), width > 720);
    const sidebarExpanded = await page.locator('#toggleSidebar').getAttribute('aria-expanded');
    const clickCopy = async (button, expected, path = 'native') => {
      const count = await page.evaluate(() => globalThis.__copies.length);await button.click();
      await page.waitForFunction(count => globalThis.__copies.length === count + 1, count);
      const copied = await page.evaluate(() => globalThis.__copies.at(-1));assert.equal(copied.text, expected);assert.equal(copied.path, path);
      assert.equal(await button.getAttribute('data-copied'), 'true');
    };
    if (width === 390) {
      assert.equal(await user.locator('.message-copy-actions').evaluate(node => getComputedStyle(node).opacity), '1', 'touch copy controls must not depend on hover');
    }
    await user.hover().catch(() => {});
    await clickCopy(user.locator('[data-copy-kind="message"]'), userText);
    const keyboardCount = await page.evaluate(() => globalThis.__copies.length);
    await user.locator('[data-copy-kind="message"]').focus();await page.keyboard.press('Enter');
    await page.waitForFunction(count => globalThis.__copies.length === count + 1, keyboardCount);
    assert.equal((await page.evaluate(() => globalThis.__copies.at(-1))).text, userText);
    await assistant.hover().catch(() => {});
    await clickCopy(assistant.locator(':scope > .message-copy-actions [data-copy-kind="message"]'), agentText);
    await clickCopy(assistant.locator('[data-copy-kind="code"]').nth(0), codeOne);
    const longCode = assistant.locator('pre').nth(1);
    assert.ok(await longCode.evaluate(node => { node.scrollLeft = node.scrollWidth;return node.scrollLeft > 0; }), 'long code must remain accessible through an internal horizontal scrollbar');
    await clickCopy(assistant.locator('[data-copy-kind="code"]').nth(1), codeTwo);
    await longCode.evaluate(node => { node.scrollLeft = 0; });
    const htmlCode = '<img src=x onerror="window.__copyInjection=true">';
    await clickCopy(assistant.locator('[data-copy-kind="code"]').nth(2), htmlCode);
    assert.equal(await page.evaluate(() => globalThis.__copyInjection), undefined);
    assert.equal(await page.inputValue('#prompt'), 'Keep this draft unchanged');
    assert.equal(await page.locator('#toggleSidebar').getAttribute('aria-expanded'), sidebarExpanded, 'copy actions must not collapse the sidebar');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
    await clickCopy(assistant.locator('[data-copy-kind="code"]').nth(0), codeOne, 'fallback');
    await page.evaluate(() => {
      document.execCommand = globalThis.__nativeExecCommand;
      document.addEventListener('copy', event => { globalThis.__domCopiedText = document.activeElement.value;event.clipboardData.setData('text/plain', globalThis.__domCopiedText);event.preventDefault(); }, { once: true });
    });
    await assistant.locator('[data-copy-kind="code"]').nth(0).click();
    await page.waitForFunction(() => typeof globalThis.__domCopiedText === 'string');
    assert.equal(await page.evaluate(() => globalThis.__domCopiedText), codeOne);
    assert.equal(await assistant.locator('[data-copy-kind="code"]').nth(0).getAttribute('data-copied'), 'true');
    await page.evaluate(() => { document.execCommand = globalThis.__fixtureExecCommand;globalThis.__copyAllowed = false; });
    await assistant.locator('[data-copy-kind="code"]').nth(0).click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Copy failed'));
    assert.notEqual(await assistant.locator('[data-copy-kind="code"]').nth(0).getAttribute('data-copied'), 'true');
    await page.evaluate(() => { globalThis.__copyAllowed = true; });

    const first = 'Stream start 中文\n\n```sh\nprintf ', rest = "'final stream'\n```\nDone";
    await page.evaluate(({ first, rest }) => {
      const api = globalThis.__codexWebuiDebug;
      api.notify('item/started', { threadId: api.state.active.id, turnId: 'stream-turn', item: { id: 'stream-copy', type: 'agentMessage', text: '' } });
      api.notify('item/agentMessage/delta', { threadId: api.state.active.id, turnId: 'stream-turn', itemId: 'stream-copy', delta: first });
    }, { first, rest });
    await page.waitForFunction(() => globalThis.__codexWebuiDebug.state.items.get('stream-copy')?.querySelector('[data-copy-kind="message"]'));
    await page.evaluate(rest => { const api = globalThis.__codexWebuiDebug;api.notify('item/agentMessage/delta', { threadId: api.state.active.id, turnId: 'stream-turn', itemId: 'stream-copy', delta: rest }); }, rest);
    await page.waitForFunction(text => globalThis.__codexWebuiDebug.state.items.get('stream-copy')?.querySelector('.message-text')?.dataset.raw === text, first + rest);
    const streamRoot = page.locator('[data-turn-id="stream-turn"] [data-local-conversation-final-assistant]');
    await streamRoot.hover();
    await clickCopy(streamRoot.locator(':scope > .message-copy-actions [data-copy-kind="message"]'), first + rest, 'fallback');
    await page.evaluate(text => { const api = globalThis.__codexWebuiDebug;for (let i = 0; i < 2; i++) api.notify('item/completed', { threadId: api.state.active.id, turnId: 'stream-turn', item: { id: 'stream-copy', type: 'agentMessage', text } }); }, first + rest);
    assert.equal(await streamRoot.locator(':scope > .message-copy-actions').count(), 1);
    assert.equal(await streamRoot.locator('[data-copy-kind="code"]').count(), 1);
    await clickCopy(streamRoot.locator('[data-copy-kind="code"]'), "printf 'final stream'", 'fallback');

    await page.evaluate(() => globalThis.__codexWebuiI18n.setPreference('zh-CN'));
    await page.waitForFunction(() => document.querySelector('.user-turn [data-copy-kind="message"]').getAttribute('aria-label') === '复制消息');
    await assertLayout();assert.equal(await user.locator('.user-message').textContent(), userText);
    assert.deepEqual(inferenceCalls, []);assert.deepEqual(errors, []);
    await page.screenshot({ path: artifact(`message-copy-${engineName}-${width}.png`), fullPage: false });
    await context.close();console.log(`${engineName}: message wrap/copy ${width}px passed`);
  }
} finally {
  await browser?.close();server.kill('SIGTERM');const done = await Promise.race([server.exited.then(() => true), Bun.sleep(7000).then(() => false)]);
  if (!done) { server.kill('SIGKILL');await server.exited; }
  rmSync(home, { recursive: true, force: true });
}
