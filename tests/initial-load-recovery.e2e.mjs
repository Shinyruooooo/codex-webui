// 故障注入：丢掉第一次 model/list 的响应，模拟 app-server 模型目录刷新超时（真实日志里出现过
// “failed to refresh available models: request timed out”）。修复前界面会永久停在静态初值
// “Loading models…”，修复后必须自行重试并渲染出模型与会话列表。
import { chromium } from 'playwright';
import { artifact, launchOptions } from './browser-runtime.mjs';

const base = process.env.CODEX_WEBUI_TEST_URL || 'http://127.0.0.1:8899';
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });

const drops = Number(process.env.DROP_MODEL_LIST || 1);
const stats = { modelListRequests: 0, droppedResults: 0, plannedDrops: drops };
await context.routeWebSocket('**/ws', ws => {
  const server = ws.connectToServer();
  const modelListIds = new Set();
  ws.onMessage(message => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'rpc' && parsed.method === 'model/list') { stats.modelListRequests += 1; modelListIds.add(parsed.id); }
    } catch { /* non-JSON frames belong to the transport test, not this one */ }
    server.send(message);
  });
  server.onMessage(message => {
    try {
      const parsed = JSON.parse(message);
      const isResult = parsed.type === 'rpc/result' || parsed.type === 'rpc/error';
      if (isResult && modelListIds.has(parsed.id) && stats.droppedResults < drops) {
        stats.droppedResults += 1;
        modelListIds.delete(parsed.id);
        return; // 响应在此丢失：客户端不应因此永久卡住
      }
    } catch { /* ignore */ }
    ws.send(message);
  });
});

await context.addInitScript(() => { globalThis.__codexWebuiRpcTimeoutMs = 3000; });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(base, { waitUntil: 'domcontentloaded' });

const body = () => page.evaluate(() => ({
  modelLabel: document.querySelector('#modelLabel')?.textContent?.trim() ?? '',
  models: globalThis.__codexWebuiDebug?.state?.models?.length ?? 0,
  threadItems: document.querySelectorAll('.thread-item').length,
  threadListText: document.querySelector('#threadList')?.textContent?.trim().slice(0, 40) ?? '',
}));

const started = Date.now();
// 关键保证 1：会话列表不被失败的 model/list 拖死，必须很快出现
await page.waitForFunction(() => document.querySelectorAll('.thread-item').length > 0, null, { timeout: 15000 });
const conversationMs = Date.now() - started;
const afterConversation = await body();
// 关键保证 2：丢失的响应由超时 + 重试自愈，模型目录最终恢复
await page.waitForFunction(() => (globalThis.__codexWebuiDebug?.state?.models?.length ?? 0) > 0, null, { timeout: 60000 });
const modelMs = Date.now() - started;
const afterRecovery = await body();

await page.screenshot({ path: artifact('initial-load-recovery.png') });
console.log(JSON.stringify({ stats, conversationMs, modelMs, afterConversation, afterRecovery, errors }, null, 2));
await browser.close();

const problems = [];
if (stats.droppedResults !== drops) problems.push(`expected ${drops} injected response losses, saw ${stats.droppedResults}`);
if (stats.modelListRequests < drops + 1) problems.push(`the client retried ${stats.modelListRequests - 1} times for ${drops} lost responses`);
if (conversationMs > 12000) problems.push(`the conversation list waited ${conversationMs}ms on the failed model catalog`);
if (!afterRecovery.models) problems.push('the model catalog never recovered after the lost response');
if (/Loading models/i.test(afterRecovery.modelLabel)) problems.push('the model label stayed on its static placeholder');
if (!afterRecovery.threadItems) problems.push('the conversation list never rendered');
if (errors.length) problems.push(`browser errors: ${errors.join('; ')}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
