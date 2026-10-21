import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchOptions } from './browser-runtime.mjs';

const base=process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899';
const browser=await chromium.launch(launchOptions());
const page=await browser.newPage({viewport:{width:1280,height:760},colorScheme:'dark'});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.goto(base,{waitUntil:'networkidle'});
await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.notify);
const terminalEntryPoints=await page.evaluate(()=>({
  sidebarTerminalButton:Boolean(document.querySelector('#sidebarTerminalButton')),
  filesTerminalButton:Boolean(document.querySelector('#filesTerminalButton')),
  sideTerminalPanel:Boolean(document.querySelector('#sideTerminalPanel')),
  bottomPanel:Boolean(document.querySelector('#bottomPanel,#toggleBottomPanel')),
  launcherActions:[...document.querySelectorAll('[data-side-panel-action]')].map(node=>node.dataset.sidePanelAction),
}));

await page.evaluate(()=>globalThis.__codexWebuiDebug.notify('item/started',{turnId:'side-task-turn',item:{id:'spawn-side-task',type:'collabAgentToolCall',tool:'spawnAgent',status:'inProgress',senderThreadId:'parent-thread',receiverThreadIds:['child-thread'],prompt:'Inspect the browser compatibility issue.',model:'gpt-5.6-terra',reasoningEffort:'medium',agentsStates:{'child-thread':{status:'running',message:'Checking redirects'}}}}));
await page.evaluate(()=>globalThis.__codexWebuiDebug.openUtilityPanel('side-task'));
await page.waitForFunction(()=>document.querySelector('#sideTaskList .side-task-card'));
const sideTask=await page.evaluate(()=>({
  panelVisible:!document.querySelector('#sideTaskPanel').hidden,
  title:document.querySelector('#utilityTab').textContent.trim(),
  taskTitle:document.querySelector('.side-task-card strong')?.textContent.trim(),
  taskBody:document.querySelector('.side-task-card small')?.textContent.trim(),
  taskStatus:document.querySelector('.side-task-status')?.textContent.trim(),
}));

await page.evaluate(()=>{
  const {state}=globalThis.__codexWebuiDebug,cwd=state.active?.cwd||state.config.defaultCwd;
  state.transport='ws';
  state.ws={readyState:WebSocket.OPEN,send(raw){
    const request=JSON.parse(raw);
    queueMicrotask(()=>{
      const pending=state.pending.get(request.id);
      if(!pending)return;
      state.pending.delete(request.id);
      if(request.method==='thread/read'&&request.params.threadId==='child-thread')pending.resolve({thread:{id:'child-thread',cwd,source:'local',turns:[{id:'child-turn',items:[{id:'child-agent',type:'agentMessage',phase:'final_answer',text:'Child task result'}]}]}});
      else pending.reject(new Error(`Unexpected RPC ${request.method}`));
    });
  }};
});
await page.click('.side-task-card');
await page.waitForFunction(()=>globalThis.__codexWebuiDebug.state.active?.id==='child-thread'&&document.querySelector('.assistant-response .message-text')?.textContent.includes('Child task result'));
const sideTaskNavigation=await page.evaluate(()=>({
  activeId:globalThis.__codexWebuiDebug.state.active?.id,
  storedId:localStorage.getItem('codex-webui-active-thread'),
  heading:document.querySelector('#threadTitle')?.textContent.trim(),
  response:document.querySelector('.assistant-response .message-text')?.textContent.trim(),
}));
await page.screenshot({path:join(tmpdir(),'codex-webui-side-task-open.png'),fullPage:false});

await page.evaluate(()=>globalThis.__codexWebuiDebug.notify('item/started',{turnId:'missing-side-task-turn',item:{id:'missing-side-task',type:'collabAgentToolCall',tool:'spawnAgent',status:'inProgress',receiverThreadIds:['missing-child-thread'],prompt:'Unavailable child task',model:'gpt-5.6-terra',agentsStates:{'missing-child-thread':{status:'running'}}}}));
await page.evaluate(()=>globalThis.__codexWebuiDebug.openUtilityPanel('side-task'));
await page.click('.side-task-card[data-thread-id="missing-child-thread"]');
await page.waitForFunction(()=>document.querySelector('#toast')?.classList.contains('show'));
const failedSideTaskNavigation=await page.evaluate(()=>({
  activeId:globalThis.__codexWebuiDebug.state.active?.id,
  storedId:localStorage.getItem('codex-webui-active-thread'),
  heading:document.querySelector('#threadTitle')?.textContent.trim(),
  toast:document.querySelector('#toast')?.textContent.trim(),
  disabled:document.querySelector('.side-task-card[data-thread-id="missing-child-thread"]')?.disabled,
  busy:document.querySelector('.side-task-card[data-thread-id="missing-child-thread"]')?.getAttribute('aria-busy'),
}));

await page.evaluate(()=>globalThis.__codexWebuiDebug.openUtilityPanel('side-task'));
await page.waitForFunction(()=>document.querySelector('#sideTaskList .side-task-card'));
const restoredSideTask=await page.evaluate(()=>({
  panelVisible:!document.querySelector('#sideTaskPanel').hidden,
  title:document.querySelector('#utilityTab').textContent.trim(),
  cardCount:document.querySelectorAll('#sideTaskList .side-task-card').length,
  launcherActions:[...document.querySelectorAll('[data-side-panel-action]')].map(node=>node.dataset.sidePanelAction),
}));

console.log(JSON.stringify({terminalEntryPoints,sideTask,sideTaskNavigation,failedSideTaskNavigation,restoredSideTask,errors},null,2));
await browser.close();
if(errors.length||terminalEntryPoints.sidebarTerminalButton||terminalEntryPoints.filesTerminalButton||terminalEntryPoints.sideTerminalPanel||terminalEntryPoints.bottomPanel||terminalEntryPoints.launcherActions.includes('terminal'))process.exit(1);
if(!sideTask.panelVisible||sideTask.title!=='Side tasks'||sideTask.taskTitle!=='gpt-5.6-terra'||sideTask.taskBody!=='Checking redirects'||sideTask.taskStatus!=='running')process.exit(1);
if(sideTaskNavigation.activeId!=='child-thread'||sideTaskNavigation.storedId!=='child-thread'||sideTaskNavigation.heading!=='gpt-5.6-terra'||sideTaskNavigation.response!=='Child task result')process.exit(1);
if(failedSideTaskNavigation.activeId!=='child-thread'||failedSideTaskNavigation.storedId!=='child-thread'||failedSideTaskNavigation.heading!=='gpt-5.6-terra'||!failedSideTaskNavigation.toast.includes('Unexpected RPC thread/read')||failedSideTaskNavigation.disabled||failedSideTaskNavigation.busy!==null)process.exit(1);
if(!restoredSideTask.panelVisible||restoredSideTask.title!=='Side tasks'||restoredSideTask.cardCount<1||restoredSideTask.launcherActions.includes('terminal'))process.exit(1);
