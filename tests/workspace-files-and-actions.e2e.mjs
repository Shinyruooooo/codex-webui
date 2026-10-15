// End-to-end browser verification for Pi Web-aligned workspace basics:
// real Files panel (tree, preview, mention), file/image upload & paste,
// per-session drafts, IME Enter protection, thread rename/export/compact,
// and converged panel actions without fake native-bridge placeholders.
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { root, artifact, launchOptions } from './browser-runtime.mjs';

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
  'base64',
);

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') return reject(new Error('No free port'));
      probe.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitFor(check, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await check()) return; } catch {}
    await Bun.sleep(50);
  }
  throw new Error('Timed out waiting for workspace test server');
}

const workspaceDir = join(process.env.HOME || root, `.codex-webui-workspace-test-${process.pid}`);
mkdirSync(join(workspaceDir, 'docs'), { recursive: true });
writeFileSync(join(workspaceDir, 'README.md'), '# Project Guide\n\nHello from workspace preview.\n');
writeFileSync(join(workspaceDir, 'docs', 'notes.txt'), 'line one\nline two\n');

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const server = Bun.spawn(['bun', 'run', 'server.ts'], {
  cwd: root,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    CODEX_WEBUI_CWD: workspaceDir,
    CODEX_WEBUI_REVIEW_ROOT: workspaceDir,
  },
  stdout: 'ignore',
  stderr: 'ignore',
});

let browser;
try {
  await waitFor(async () => (await fetch(`${base}/api/health`)).ok);
  browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, colorScheme: 'dark' });
  await context.addInitScript(() => { if (window === window.top) localStorage.setItem('codex-webui-locale', 'en'); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  const threads = [
    {
      id: 'thread-alpha',
      name: 'Alpha session',
      cwd: workspaceDir,
      canAcceptDirectInput: true,
      turns: [{
        id: 'turn-alpha-1',
        status: 'completed',
        items: [
          { id: 'u-1', type: 'userMessage', content: [{ type: 'text', text: 'Summarize README.md' }] },
          { id: 'c-1', type: 'commandExecution', status: 'completed', command: 'ls -la', exitCode: 0 },
          { id: 'a-1', type: 'agentMessage', phase: 'final_answer', text: 'README has the project guide.' },
        ],
      }],
    },
    {
      id: 'thread-beta',
      name: 'Beta session',
      cwd: `${workspaceDir}-other`,
      recencyAt: 100,
      canAcceptDirectInput: true,
      turns: [],
    },
  ];
  threads[0].recencyAt = 200;
  const rpcCalls = [];
  await context.routeWebSocket(`ws://127.0.0.1:${port}/ws`, ws => {
    ws.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type !== 'rpc') return;
      rpcCalls.push(message);
      const { method, params } = message;
      let result = {};
      if (method === 'model/list') {
        result = { data: [{ id: 'gpt-5.4-mini', model: 'gpt-5.4-mini', displayName: 'GPT-5.4-Mini', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }] };
      } else if (method === 'account/rateLimits/read') {
        result = {
          ordinaryUsageAllowed: true,
          rateLimits: {
            limitId: 'codex',
            primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 7200 },
            secondary: { usedPercent: 3, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 86400 * 5 },
            planType: 'plus',
          },
          rateLimitResetCredits: { availableCount: 3 },
        };
      } else if (method === 'thread/list') {
        result = { data: threads };
      } else if (method === 'permissionProfile/list') {
        result = { data: [] };
      } else if (method === 'thread/read') {
        result = { thread: threads.find(item => item.id === params.threadId) };
      } else if (method === 'thread/turns/list') {
        result = { data: threads.find(item => item.id === params.threadId)?.turns || [] };
      } else if (method === 'host/thread/live') {
        result = { active: false };
      } else if (method === 'thread/name/set') {
        const target = threads.find(item => item.id === params.threadId);
        if (target) target.name = params.name;
        result = {};
      } else if (method === 'thread/compact/start') {
        result = {};
      } else if (method === 'turn/start') {
        result = { turn: { id: 'turn-uploaded', status: 'inProgress' } };
      }
      ws.send(JSON.stringify({ type: 'rpc/result', id: message.id, result }));
    });
    ws.send(JSON.stringify({ type: 'bridge/status', status: 'connected' }));
  });

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__codexWebuiDebug?.state?.threadsLoaded);

  // 1. Converged Pi Web 3-column shell: bottom panel & summary toggle are hidden;
  // left sidebar toggle sits in the left heading; sidebar tabs are icon-only;
  // right side panel is opened from left actions without a launcher chooser.
  const converged = await page.evaluate(() => {
    const toggleBox = document.querySelector('#toggleSidebar').getBoundingClientRect();
    const rightBox = document.querySelector('#toggleSidePanel').getBoundingClientRect();
    return {
      bottomToggleHidden: document.querySelector('#toggleBottomPanel')?.hidden,
      bottomPanelHidden: document.querySelector('#bottomPanel')?.hidden,
      summaryToggleHidden: document.querySelector('#toggleSummaryPanel')?.hidden,
      dictationHidden: document.querySelector('[data-composer-control="dictation"]')?.hidden,
      sidebarToggleInHeading: Boolean(document.querySelector('.thread-heading #toggleSidebar')),
      sidebarToggleLeftOfRightToggle: toggleBox.left < rightBox.left - 200,
      sidebarTabs: [...document.querySelectorAll('[data-sidebar-tab]')].map(node => ({
        tab: node.dataset.sidebarTab,
        hasIcon: Boolean(node.querySelector('svg')),
        srOnlyText: Boolean(node.querySelector('.sr-only')),
      })),
      newTabLauncherHidden: document.querySelector('#newTab')?.hidden,
      openSidePanelTabHidden: document.querySelector('#openSidePanelTab')?.hidden,
      hasSidebarTerminalButton: Boolean(document.querySelector('#sidebarTerminalButton')),
      runtimeSummaryText: document.querySelector('#runtimeTokenSummary')?.textContent?.trim(),
      runtimeDetailsHtml: document.querySelector('#runtimeUsageDetails')?.innerHTML || '',
    };
  });
  assert.equal(converged.bottomToggleHidden, true);
  assert.equal(converged.bottomPanelHidden, true);
  assert.equal(converged.summaryToggleHidden, true);
  assert.equal(converged.dictationHidden, true);
  assert.equal(converged.sidebarToggleInHeading, true);
  assert.equal(converged.sidebarToggleLeftOfRightToggle, true);
  assert.deepEqual(converged.sidebarTabs.map(item => item.tab), ['sessions', 'files']);
  assert.equal(converged.sidebarTabs.every(item => item.hasIcon && item.srOnlyText), true);
  assert.equal(converged.newTabLauncherHidden, true);
  assert.equal(converged.openSidePanelTabHidden, true);
  assert.equal(converged.hasSidebarTerminalButton, true);
  assert.ok(converged.runtimeSummaryText?.includes('5h: 80%'));
  assert.ok(converged.runtimeSummaryText?.includes('Weekly: 97%'));
  assert.ok(converged.runtimeDetailsHtml.includes('Remaining quota'));

  // 2. Per-session draft persistence across new chat and existing threads,
  // and sidebar project group / thread order remains fixed when clicking between sessions.
  const initialProjectOrder = await page.evaluate(() => [...document.querySelectorAll('.sidebar-project-group')].map(el => el.dataset.project));
  const initialThreadOrder = await page.evaluate(() => [...document.querySelectorAll('.thread-item')].map(el => el.dataset.id));
  await page.locator('#prompt').fill('Draft for a brand new task');
  await page.click('.thread-item[data-id="thread-alpha"]');
  await page.waitForFunction(() => globalThis.__codexWebuiDebug.state.active?.id === 'thread-alpha');
  assert.equal(await page.locator('#prompt').inputValue(), '');
  await page.locator('#prompt').fill('Draft specifically for alpha');
  await page.click('.thread-item[data-id="thread-beta"]');
  await page.waitForFunction(() => globalThis.__codexWebuiDebug.state.active?.id === 'thread-beta');
  assert.deepEqual(
    await page.evaluate(() => [...document.querySelectorAll('.sidebar-project-group')].map(el => el.dataset.project)),
    initialProjectOrder,
  );
  assert.deepEqual(
    await page.evaluate(() => [...document.querySelectorAll('.thread-item')].map(el => el.dataset.id)),
    initialThreadOrder,
  );
  assert.equal(await page.locator('#prompt').inputValue(), '');
  await page.click('.thread-item[data-id="thread-alpha"]');
  await page.waitForFunction(() => globalThis.__codexWebuiDebug.state.active?.id === 'thread-alpha');
  assert.equal(await page.locator('#prompt').inputValue(), 'Draft specifically for alpha');
  await page.click('#newTask');
  assert.equal(await page.locator('#prompt').inputValue(), 'Draft for a brand new task');
  await page.locator('#prompt').fill('');

  // 3. IME composition Enter must not submit prematurely.
  await page.click('.thread-item[data-id="thread-alpha"]');
  await page.waitForFunction(() => globalThis.__codexWebuiDebug.state.active?.id === 'thread-alpha');
  await page.locator('#prompt').fill('中文输入中');
  const startCountBeforeIme = rpcCalls.filter(call => call.method === 'turn/start').length;
  await page.evaluate(() => {
    const prompt = document.querySelector('#prompt');
    prompt.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    prompt.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  assert.equal(rpcCalls.filter(call => call.method === 'turn/start').length, startCountBeforeIme);
  assert.equal(await page.locator('#prompt').inputValue(), '中文输入中');
  await page.locator('#prompt').fill('');

  // 4. Thread rename, Markdown/JSON export, and /compact.
  await page.click('#threadActionsButton');
  assert.equal(await page.locator('#threadActionsMenu').isVisible(), true);
  await page.evaluate(() => globalThis.__codexWebuiDebug.renameActiveThread('Alpha Renamed'));
  assert.equal(await page.locator('#threadTitle').textContent(), 'Alpha Renamed');
  assert.equal(rpcCalls.some(call => call.method === 'thread/name/set' && call.params.name === 'Alpha Renamed'), true);

  const mdExport = await page.evaluate(() => globalThis.__codexWebuiDebug.exportActiveThread('md'));
  assert.ok(mdExport.filename.endsWith('.md'));
  assert.ok(mdExport.content.includes('# Alpha Renamed'));
  assert.ok(mdExport.content.includes('README has the project guide.'));

  const jsonExport = await page.evaluate(() => globalThis.__codexWebuiDebug.exportActiveThread('json'));
  assert.ok(jsonExport.filename.endsWith('.json'));
  assert.equal(JSON.parse(jsonExport.content).thread.name, 'Alpha Renamed');

  await page.evaluate(() => globalThis.__codexWebuiDebug.compactActiveThread());
  assert.equal(rpcCalls.some(call => call.method === 'thread/compact/start' && call.params.threadId === 'thread-alpha'), true);

  // 5. Left sidebar Files tab browses the project tree; hover @ button mentions file directly,
  // and typing @ in composer immediately lists project files & supports folder drilldown.
  await page.click('#sidebarTabFiles');
  await page.waitForSelector('#sidebarFilesSection:not([hidden]) [data-file-entry-path="README.md"]');
  await page.click('[data-file-entry-path="README.md"]');
  await page.waitForSelector('#sidePanel:not([hidden]) #filesPanel:not([hidden])');
  assert.ok((await page.locator('#filesPreviewBody').textContent()).includes('Hello from workspace preview.'));
  await page.click('[data-file-entry-path="README.md"] .files-entry-mention', { force: true });
  assert.ok((await page.locator('#prompt').inputValue()).includes('@README.md'));
  assert.equal(await page.locator('.composer-context-chip').count(), 1);

  await page.locator('#prompt').fill('@');
  await page.waitForFunction(() => document.querySelectorAll('#composerAutocomplete [data-autocomplete-id]').length > 0);
  await page.locator('#prompt').fill('@README.md ');

  await page.click('[data-file-entry-path="docs"]');
  await page.waitForSelector('[data-file-entry-path="docs/notes.txt"]');
  await page.click('[data-file-entry-path="docs/notes.txt"]');
  await page.waitForFunction(() => document.querySelector('#filesPreviewBody')?.textContent?.includes('line two'));
  await page.click('#filesUpButton');
  await page.waitForSelector('[data-file-entry-path="README.md"]');

  // Opening Terminal from the left sidebar directly opens the right terminal panel.
  await page.click('#filesTerminalButton');
  await page.waitForSelector('#sidePanel:not([hidden]) #sideTerminalPanel:not([hidden])');
  assert.equal(await page.locator('#sidePanelLauncher').isHidden(), true);
  await page.click('[data-file-entry-path="README.md"]');
  await page.waitForSelector('#sidePanel:not([hidden]) #filesPanel:not([hidden])');

  // 6. Real file & image upload from composer, then send structured UserInput to Codex.
  await page.setInputFiles('#composerFileInput', [
    { name: 'diagram.png', mimeType: 'image/png', buffer: pngBytes },
    { name: 'spec.txt', mimeType: 'text/plain', buffer: Buffer.from('spec content\n') },
  ]);
  await page.waitForFunction(() => globalThis.__codexWebuiDebug.state.composerAttachments.length === 2);
  await page.click('#sendButton');
  await waitFor(() => rpcCalls.some(call => call.method === 'turn/start'));
  const turnStart = rpcCalls.findLast(call => call.method === 'turn/start');
  const inputTypes = turnStart.params.input.map(item => item.type);
  assert.ok(inputTypes.includes('text'));
  assert.ok(inputTypes.includes('mention'));
  assert.ok(inputTypes.includes('localImage'));
  assert.ok(turnStart.params.input.find(item => item.type === 'text').text.includes('@spec.txt'));

  // 7. Project switch must not overwrite the destination project's new-chat draft.
  await page.click('#sidebarTabSessions');
  await page.click('#newTask');
  await page.evaluate(dir => {
    localStorage.setItem(`codex-webui-draft:new:${dir}/docs`, JSON.stringify({ text: 'Existing docs project draft', mentions: [] }));
  }, workspaceDir);
  await page.locator('#prompt').fill('Draft in root project');
  await page.click('#projectButton');
  await page.waitForSelector('#folderDialog[open] .folder-item');
  await page.click('#folderDialog .folder-item');
  await page.click('#folderConfirm');
  assert.equal(await page.locator('#prompt').inputValue(), 'Existing docs project draft');
  assert.equal(await page.evaluate(dir => JSON.parse(localStorage.getItem(`codex-webui-draft:new:${dir}`) || '{}').text, workspaceDir), 'Draft in root project');

  await page.screenshot({ path: artifact('workspace-files-and-actions.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ converged, renamed: 'Alpha Renamed', mdExport: mdExport.filename, jsonExport: jsonExport.filename, inputTypes, errors }, null, 2));
} finally {
  await browser?.close();
  server.kill();
  await server.exited;
  rmSync(workspaceDir, { recursive: true, force: true });
}
