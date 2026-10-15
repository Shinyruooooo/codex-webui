// Deterministic UX regression: delayed Codex session/start responses, real UI taps,
// stream events, usage accounting and external CLI ownership. No model calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { root, artifact, launchOptions } from './browser-runtime.mjs';

const base='http://192.0.2.2';
const threads=[
  {id:'cli-thread',name:'CLI session',cwd:'/workspace',canAcceptDirectInput:false,turns:[]},
  {id:'other-thread',name:'Other session',cwd:'/workspace',canAcceptDirectInput:true,turns:[]},
];
const usage={total:{inputTokens:12000,cachedInputTokens:9000,outputTokens:2500,reasoningOutputTokens:1800,totalTokens:14500},last:{inputTokens:6000,cachedInputTokens:4000,outputTokens:500,reasoningOutputTokens:300,totalTokens:6500},modelContextWindow:100000};
const assets=new Map([
  ['/','index.html','text/html'],['/style.css','style.css','text/css'],
  ['/auth-bootstrap.js','auth-bootstrap.js','text/javascript'],['/codex-brand.js','codex-brand.js','text/javascript'],
  ['/i18n.js','i18n.js','text/javascript'],['/app.bundle.js','app.bundle.js','text/javascript'],
  ['/favicon.svg','favicon.svg','image/svg+xml'],
].map(([url,file,contentType])=>[url,{body:readFileSync(file==='app.bundle.js'&&process.env.CODEX_WEBUI_TEST_BUNDLE?process.env.CODEX_WEBUI_TEST_BUNDLE:`${root}/public/${file}`),contentType}]));

async function fixture(browser,mobile=false){
  const context=await browser.newContext({...mobile?devices['iPad Pro 11']:{viewport:{width:1280,height:820}},locale:'en',reducedMotion:'reduce'});
  await context.addInitScript(()=>{if(window===window.top){delete globalThis.Notification;localStorage.setItem('codex-webui-locale','en')}});
  const requests=[],held=new Map(),live=new Map(),turns=new Map(),deferredReads=new Set();let socket;
  const result=(message,value)=>socket.send(JSON.stringify({type:'rpc/result',id:message.id,result:value}));
  await context.routeWebSocket('ws://192.0.2.2/ws',ws=>{
    socket=ws;
    ws.onMessage(raw=>{
      const message=JSON.parse(String(raw));requests.push(message);
      if(message.type!=='rpc'){ws.send(JSON.stringify({type:'ack'}));return}
      const {method,params}=message;
      if(method==='thread/read'&&deferredReads.has(params.threadId)){held.set(`thread/read:${params.threadId}`,message);return}
      if(['thread/start','thread/resume','turn/start','turn/interrupt'].includes(method)){held.set(method,message);return}
      const values={
        'model/list':{data:[{id:'gpt-test',model:'gpt-test',displayName:'GPT-Test',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]},
        'thread/list':{data:threads},'permissionProfile/list':{data:[]},
        'thread/read':{thread:threads.find(t=>t.id===params.threadId)},
        'thread/turns/list':{data:turns.get(params.threadId)||[]},
        'host/thread/live':live.get(params.threadId)||{active:false},
      };
      result(message,values[method]||{});
    });
    ws.send(JSON.stringify({type:'bridge/status',status:'connected'}));
  });
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());assert.equal(url.origin,base);
    if(assets.has(url.pathname))return route.fulfill({status:200,...assets.get(url.pathname)});
    if(url.pathname.startsWith('/vendor/'))return route.fulfill({status:200,contentType:'text/css',body:''});
    if(url.pathname.startsWith('/assets/codex-motion/'))return route.fulfill({status:200,contentType:'application/json',body:'{}'});
    const data={
      '/api/auth/status':{authenticated:true},'/api/config':{home:'/home/test',defaultCwd:'/workspace'},
      '/api/account':{type:'unknown'},'/api/workspace/context':{cwd:'/workspace',project:'workspace',branch:'test'},
    }[url.pathname];
    assert.ok(data,`Unexpected HTTP endpoint: ${url.pathname}`);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(8000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.models.length>0);
  const release=(method,value,error)=>{
    const message=held.get(method);assert.ok(message,`No pending ${method}`);held.delete(method);
    if(error)socket.send(JSON.stringify({type:'rpc/error',id:message.id,...error}));else result(message,value);
    return message;
  };
  const emit=(method,params)=>socket.send(JSON.stringify({type:'codex/notification',payload:{method,params}}));
  const waitHeld=async method=>{
    const deadline=Date.now()+8000;while(!held.has(method)){assert.ok(Date.now()<deadline,`${method} was never sent`);await new Promise(r=>setTimeout(r,10))}
  };
  return{context,page,errors,requests,held,release,emit,waitHeld,live,turns,deferredReads,send:payload=>socket.send(JSON.stringify(payload))};
}

const browser=await chromium.launch(launchOptions());
const reports=[];
try{
  // New session: user sees their prompt and local preparation before thread/start replies.
  const f=await fixture(browser,true),p=f.page;
  assert.equal(await p.locator('#runtimeTokenSummary').textContent(),'—');
  await p.locator('#prompt').fill('Show immediate feedback');
  const started=Date.now();await p.locator('#sendButton').tap();
  assert.equal(await p.locator('.user-message').textContent(),'Show immediate feedback');
  assert.equal(await p.locator('#runtimeStatus').textContent(),'Preparing session…');
  assert.equal(await p.locator('#runtimeStatus').evaluate(node=>node.classList.contains('sr-only')),true);
  assert.equal(await p.locator('#runtimeStatusIcon svg').count(),1);
  const feedbackMs=Date.now()-started;assert.ok(feedbackMs<1000,`Local feedback took ${feedbackMs}ms`);
  assert.equal(await p.locator('#sendButton').isDisabled(),true);
  await p.evaluate(()=>{document.querySelector('#composer').requestSubmit();document.querySelector('#composer').requestSubmit()});
  await f.waitHeld('thread/start');
  assert.equal(f.requests.filter(r=>r.method==='thread/start').length,1,'duplicate submission');
  f.release('thread/start',{thread:{id:'new-thread',name:'New session',cwd:'/workspace',canAcceptDirectInput:true}});
  await f.waitHeld('turn/start');
  assert.equal(await p.locator('#runtimeStatus').textContent(),'Sending to Codex…');
  f.release('turn/start',{turn:{id:'new-turn',status:'inProgress'}});
  await p.waitForFunction(()=>document.querySelector('#runtimeStatus').textContent==='Waiting for Codex…');
  assert.equal(await p.locator('.thread-item[data-id="new-thread"]').getAttribute('data-thread-status'),'running');
  assert.equal(await p.locator('.thread-item[data-id="new-thread"] .thread-status-spinner').count(),1);
  assert.equal(await p.locator('#sendButton').isDisabled(),false);
  assert.equal(await p.locator('#sendButton').getAttribute('data-submit-mode'),'stop');
  await p.waitForFunction(()=>document.querySelector('#runtimeElapsed').textContent!=='0s');

  // Notifications from another CLI/browser thread must not pollute this conversation/status/usage.
  f.emit('item/agentMessage/delta',{threadId:'other-thread',turnId:'foreign-turn',itemId:'foreign-text',delta:'FOREIGN CONTENT'});
  f.emit('thread/tokenUsage/updated',{threadId:'other-thread',tokenUsage:usage});
  f.send({type:'codex/request',payload:{id:900,method:'item/commandExecution/requestApproval',params:{threadId:'other-thread',turnId:'foreign-turn',command:'pwd'}}});
  await p.waitForTimeout(60);
  assert.equal(await p.locator('[data-codex-approval-surface]').count(),0);
  assert.equal(f.requests.filter(r=>r.type==='codex/response'&&r.requestId===900).length,0);
  assert.equal(await p.locator('#conversation').textContent().then(t=>t.includes('FOREIGN CONTENT')),false);
  assert.equal(await p.locator('#runtimeTokenSummary').textContent(),'—');
  f.emit('item/started',{threadId:'new-thread',turnId:'new-turn',item:{id:'reason',type:'reasoning',summary:[]}});
  await p.waitForFunction(()=>document.querySelector('#runtimeFooter').dataset.phase==='thinking');
  f.emit('item/started',{threadId:'new-thread',turnId:'new-turn',item:{id:'command',type:'commandExecution',command:'pwd'}});
  await p.waitForFunction(()=>document.querySelector('#runtimeFooter').dataset.phase==='running');
  f.send({type:'codex/request',payload:{id:901,method:'item/commandExecution/requestApproval',params:{threadId:'new-thread',turnId:'new-turn',itemId:'command',command:'pwd',cwd:'/workspace'}}});
  await p.waitForFunction(()=>document.querySelector('#runtimeFooter').dataset.phase==='approval');
  await p.locator('.approval-deny').click();
  await p.waitForFunction(()=>document.querySelector('#runtimeFooter').dataset.phase==='waiting');
  f.emit('item/completed',{threadId:'new-thread',turnId:'new-turn',item:{id:'reason',type:'reasoning',status:'completed',summary:['Checked the request']}});
  f.emit('item/completed',{threadId:'new-thread',turnId:'new-turn',item:{id:'command',type:'commandExecution',status:'declined',command:'pwd'}});
  f.emit('thread/tokenUsage/updated',{threadId:'new-thread',tokenUsage:usage});
  await p.waitForFunction(()=>document.querySelector('#runtimeTokenSummary').textContent.includes('↑12k'));
  assert.equal(await p.locator('#runtimeTokenSummary').textContent(),'↑12k ↓2.5k · 7%');
  await p.locator('#runtimeTokenSummary').tap();
  assert.ok((await p.locator('#runtimeUsageDetails').textContent()).includes('9,000'));
  assert.ok((await p.locator('#runtimeUsageDetails').textContent()).includes('1,800'));
  await p.locator('#runtimeTokenSummary').tap();
  for(let i=0;i<20;i++)f.emit('item/agentMessage/delta',{threadId:'new-thread',turnId:'new-turn',itemId:'answer',delta:`word${i} `});
  await p.waitForFunction(()=>document.querySelector('#conversation').textContent.includes('word19'));
  await p.waitForFunction(()=>document.querySelector('#runtimeFooter').dataset.phase==='responding');
  f.emit('turn/completed',{threadId:'new-thread',turn:{id:'new-turn',status:'completed'}});
  await p.waitForFunction(()=>document.querySelector('#runtimeFooter').dataset.phase==='completed');
  // Active thread is already being viewed: its sidebar item goes back to idle (no permanent unread dot).
  assert.equal(await p.locator('.thread-item[data-id="new-thread"]').getAttribute('data-thread-status'),'idle');
  assert.equal(await p.locator('.thread-item[data-id="new-thread"] .thread-status-dot.is-completed').count(),0);
  // Background thread completion shows the unread dot until first opened, then clears it permanently.
  f.emit('turn/started',{threadId:'cli-thread',turn:{id:'bg-turn',status:'inProgress'}});
  assert.equal(await p.locator('.thread-item[data-id="cli-thread"]').getAttribute('data-thread-status'),'running');
  f.emit('turn/completed',{threadId:'cli-thread',turn:{id:'bg-turn',status:'completed'}});
  assert.equal(await p.locator('.thread-item[data-id="cli-thread"]').getAttribute('data-thread-status'),'completed');
  assert.equal(await p.locator('.thread-item[data-id="cli-thread"] .thread-status-dot.is-completed').count(),1);
  assert.equal(await p.locator('#sendButton').getAttribute('data-submit-mode'),'send');
  // Native history hydration may emit late item completions after turn/completed.
  f.emit('item/completed',{threadId:'new-thread',turnId:'new-turn',item:{id:'answer',type:'agentMessage',text:'Final answer'}});
  await p.waitForTimeout(60);
  assert.equal(await p.locator('#runtimeFooter').getAttribute('data-phase'),'completed');
  assert.deepEqual(f.errors,[]);
  await p.screenshot({path:artifact('runtime-feedback-ipad.png')});
  reports.push({scenario:'immediate-send-stream-usage',feedbackMs,tokens:await p.locator('#runtimeTokenSummary').textContent(),errors:f.errors});
  // A background approval is retained, not discarded, and reappears on selection.
  // Clicking the completed background thread clears its unread dot on first entry,
  // and keeps the docked sidebar open until the user manually toggles it.
  await p.locator('[data-id="cli-thread"]').tap();
  await p.waitForFunction(()=>globalThis.__codexWebuiDebug.state.active?.id==='cli-thread');
  assert.equal(await p.locator('.thread-item[data-id="cli-thread"]').getAttribute('data-thread-status'),'idle');
  assert.equal(await p.locator('.thread-item[data-id="cli-thread"] .thread-status-dot.is-completed').count(),0);
  assert.equal(await p.evaluate(()=>document.body.classList.contains('sidebar-hidden')),false);
  await p.locator('[data-id="other-thread"]').tap();
  await p.waitForSelector('[data-codex-approval-surface]');
  await p.locator('.approval-deny').tap();
  await p.waitForFunction(()=>!document.querySelector('[data-codex-approval-surface]'));
  assert.equal(f.requests.filter(x=>x.type==='codex/response'&&x.requestId===900).length,1);
  reports.push({scenario:'background-approval-restored',errors:f.errors});
  await f.context.close();

  // CLI-owned thread: slow resume exposes preparation; a writer conflict preserves input.
  const c=await fixture(browser),q=c.page;
  await q.locator('[data-id="cli-thread"]').click();
  await q.locator('#prompt').fill('Keep my prompt on CLI ownership errors');
  await q.locator('#sendButton').click();await c.waitHeld('thread/resume');
  assert.equal(await q.locator('#runtimeFooter').getAttribute('data-phase'),'preparing');
  assert.ok((await q.locator('#conversation').textContent()).includes('Keep my prompt'));
  c.release('thread/resume',null,{error:'thread cli-thread already has an active writer',code:'thread_active_writer'});
  await q.waitForFunction(()=>document.querySelector('#runtimeFooter').dataset.phase==='failed');
  assert.equal(await q.locator('#prompt').inputValue(),'Keep my prompt on CLI ownership errors');
  assert.equal(c.requests.filter(r=>r.method==='turn/start').length,0);
  assert.equal(await q.locator('#sendButton').isDisabled(),false);
  reports.push({scenario:'cli-conflict-preserves-input',errors:c.errors});
  assert.deepEqual(c.errors,[]);await c.context.close();

  // Switching threads while resume is pending must never redirect the prompt to the new selection.
  const s=await fixture(browser),r=s.page;
  await r.locator('[data-id="cli-thread"]').click();await r.locator('#prompt').fill('Belongs only to CLI session');
  await r.locator('#sendButton').click();await s.waitHeld('thread/resume');
  await r.locator('[data-id="other-thread"]').click();
  await r.waitForFunction(()=>globalThis.__codexWebuiDebug.state.active.id==='other-thread');
  s.release('thread/resume',{thread:{...threads[0],canAcceptDirectInput:true}});
  await s.waitHeld('turn/start');assert.equal(s.held.get('turn/start').params.threadId,'cli-thread');
  s.release('turn/start',{turn:{id:'background-turn',status:'inProgress'}});
  s.emit('item/agentMessage/delta',{threadId:'cli-thread',turnId:'background-turn',itemId:'background-answer',delta:'Wrong thread text'});
  await r.waitForTimeout(60);
  assert.equal(await r.evaluate(()=>globalThis.__codexWebuiDebug.state.active.id),'other-thread');
  assert.ok(!(await r.locator('#conversation').textContent()).includes('Wrong thread text'));
  assert.deepEqual(s.errors,[]);reports.push({scenario:'switch-during-submit-isolated',errors:s.errors});await s.context.close();

  // Once turn/started provides an ID, Stop must work even while turn/start is pending.
  const stop=await fixture(browser),sp=stop.page;
  await sp.locator('#prompt').fill('Start slowly but allow stopping');await sp.locator('#sendButton').click();
  await stop.waitHeld('thread/start');stop.release('thread/start',{thread:{id:'stop-thread',cwd:'/workspace',canAcceptDirectInput:true}});
  await stop.waitHeld('turn/start');stop.emit('turn/started',{threadId:'stop-thread',turn:{id:'stop-turn'}});
  await sp.waitForFunction(()=>document.querySelector('#sendButton').dataset.submitMode==='stop'&&!document.querySelector('#sendButton').disabled);
  await sp.locator('#sendButton').click();await stop.waitHeld('turn/interrupt');
  assert.equal(stop.held.get('turn/interrupt').params.threadId,'stop-thread');
  assert.equal(stop.held.get('turn/interrupt').params.turnId,'stop-turn');stop.release('turn/interrupt',{});
  stop.emit('turn/completed',{threadId:'stop-thread',turn:{id:'stop-turn',status:'interrupted'}});
  await sp.waitForFunction(()=>document.querySelector('#runtimeFooter').dataset.phase==='stopped');
  stop.release('turn/start',{turn:{id:'stop-turn',status:'inProgress'}});
  await sp.waitForFunction(()=>!document.querySelector('#composer').getAttribute('aria-busy')||document.querySelector('#composer').getAttribute('aria-busy')==='false');
  assert.equal(await sp.locator('#sendButton').getAttribute('data-submit-mode'),'send');
  assert.equal(await sp.locator('#runtimeFooter').getAttribute('data-phase'),'stopped');
  reports.push({scenario:'interrupt-before-start-ack',errors:stop.errors});assert.deepEqual(stop.errors,[]);await stop.context.close();

  // A completed polling snapshot preceding the RPC reply must be replayed after unlocking.
  const done=await fixture(browser),dp=done.page;
  await dp.locator('#prompt').fill('Completion may precede acknowledgement');await dp.locator('#sendButton').click();
  await done.waitHeld('thread/start');done.release('thread/start',{thread:{id:'done-thread',cwd:'/workspace',canAcceptDirectInput:true}});
  await done.waitHeld('turn/start');
  await dp.evaluate(()=>globalThis.__codexWebuiDebug.syncTurnSnapshot({id:'done-turn',status:'completed',items:[]}));
  done.release('turn/start',{turn:{id:'done-turn',status:'inProgress'}});
  await dp.waitForFunction(()=>document.querySelector('#runtimeFooter').dataset.phase==='completed');
  assert.equal(await dp.locator('#sendButton').getAttribute('data-submit-mode'),'send');
  reports.push({scenario:'completed-snapshot-before-ack',errors:done.errors});assert.deepEqual(done.errors,[]);await done.context.close();

  // A deferred side-session read can finish after a submission begins on the still-visible thread.
  const deferred=await fixture(browser),df=deferred.page;
  await df.locator('[data-id="cli-thread"]').click();deferred.deferredReads.add('late-thread');
  await df.evaluate(()=>{void globalThis.__codexWebuiDebug.openThread('late-thread',{id:'late-thread',cwd:'/workspace',name:'Late session'})});
  await deferred.waitHeld('thread/read:late-thread');
  await df.locator('#prompt').fill('Submit on original visible thread');await df.locator('#sendButton').click();await deferred.waitHeld('thread/resume');
  deferred.release('thread/read:late-thread',{thread:{id:'late-thread',cwd:'/workspace',turns:[]}});
  await df.waitForFunction(()=>globalThis.__codexWebuiDebug.state.active.id==='late-thread');
  deferred.release('thread/resume',{thread:{...threads[0],canAcceptDirectInput:true}});
  await deferred.waitHeld('turn/start');assert.equal(deferred.held.get('turn/start').params.threadId,'cli-thread');
  deferred.release('turn/start',{turn:{id:'original-turn',status:'inProgress'}});
  await df.waitForFunction(()=>document.querySelector('#composer').getAttribute('aria-busy')==='false');
  assert.equal(await df.locator('#sendButton').getAttribute('data-turn-id'),'');
  assert.equal(await df.evaluate(()=>globalThis.__codexWebuiDebug.state.active.id),'late-thread');
  reports.push({scenario:'deferred-read-does-not-steal-submission',errors:deferred.errors});assert.deepEqual(deferred.errors,[]);await deferred.context.close();

  // Read-only external CLI polling supplies status and usage, without resuming/taking its writer lock.
  const cli=await fixture(browser),v=cli.page;
  cli.live.set('cli-thread',{active:true,tokenUsage:usage,turn:{id:'cli-turn',status:'inProgress',items:[{id:'cli-reason',type:'reasoning',status:'inProgress',summary:['CLI working']} ]}});
  await v.locator('[data-id="cli-thread"]').click();
  await v.waitForFunction(()=>document.querySelector('#runtimeFooter').dataset.phase==='thinking');
  await v.waitForFunction(()=>document.querySelector('#runtimeTokenSummary').textContent.includes('↑12k'));
  assert.equal(cli.requests.filter(x=>x.method==='thread/resume').length,0);
  assert.equal(await v.locator('#sendButton').getAttribute('data-submit-mode'),'stop');
  assert.deepEqual(cli.errors,[]);reports.push({scenario:'external-cli-status-and-usage',errors:cli.errors});
  await cli.context.close();
  console.log(JSON.stringify({reports},null,2));
}finally{await browser.close()}
