// Real offline Codex skills discovery/configuration with a disposable HOME/CODEX_HOME.
// Only conversation RPCs are mocked: no model inference, no changes to the user's skills/config.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import { root, artifact, launchOptions } from './browser-runtime.mjs';

const home = mkdtempSync(join(tmpdir(), 'codex-webui-skills-e2e-'));
const codexHome = join(home, '.codex');
const workspace = join(home, 'workspace');
const external = join(home, 'external-skills');
const curatedRepo = join(codexHome, 'vendor_imports', 'skills');
const curatedPath = join(curatedRepo, 'skills', '.curated', 'e2e-official');
const skillMd = (name, desc) => `---\nname: ${name}\ndescription: ${JSON.stringify(desc)}\n---\n\n# ${name}\n\nRead inputs and verify outputs.\n`;
mkdirSync(workspace, {recursive:true});
mkdirSync(join(external, 'external-demo'), {recursive:true});
writeFileSync(join(external, 'external-demo', 'SKILL.md'), skillMd('external-demo','Read-only mounted skill'));
mkdirSync(join(curatedRepo, '.git'), {recursive:true});
writeFileSync(join(curatedRepo, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/openai/skills.git\n');
mkdirSync(join(curatedPath, 'scripts'), {recursive:true});
writeFileSync(join(curatedPath, 'SKILL.md'), skillMd('e2e-official','Offline curated fixture'));
writeFileSync(join(curatedPath, 'scripts', 'helper.txt'),'Example resource; never executed by the installer.\n');
writeFileSync(join(codexHome,'vendor_imports','skills-curated-cache.json'), JSON.stringify({skills:[{id:'e2e-official',name:'e2e-official',description:'Offline curated fixture',repoPath:'skills/.curated/e2e-official'}]}));
const port = await new Promise((resolve,reject)=>{
 const probe=createServer();probe.on('error',reject);probe.listen(0,'127.0.0.1',()=>{const p=probe.address().port;probe.close(()=>resolve(p))});
});
const base=`http://127.0.0.1:${port}`;
const server=Bun.spawn(['bun','run','server.ts'],{cwd:root,env:{...process.env,HOME:home,CODEX_HOME:codexHome,CODEX_WEBUI_CWD:workspace,CODEX_WEBUI_REVIEW_ROOT:workspace,CODEX_WEBUI_SKILL_EXTRA_ROOTS:external,CODEX_WEBUI_AUTH_STORE:join(home,'webui-auth.json'),CODEX_WEBUI_PASSWORD:'',CODEX_WEBUI_ACCESS_TOKEN:'',HOST:'127.0.0.1',PORT:String(port)},stdout:'ignore',stderr:'pipe'});
const stderrPromise=new Response(server.stderr).text();
const api=async(path,body,method='POST')=>{
 const response=await fetch(`${base}${path}`,body===undefined?undefined:{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 return {status:response.status,data:await response.json()};
};
let browser, page;
try {
 let ready=false;
 for(let i=0;i<160;i++){try{if((await api('/api/health')).data.codex){ready=true;break}}catch{}await Bun.sleep(50)}
 assert.ok(ready,'Test Codex bridge did not initialize');
 browser=await chromium.launch(launchOptions());
 const context=await browser.newContext({viewport:{width:1360,height:860},colorScheme:'dark'});
 await context.addInitScript(()=>{if(window===window.top)localStorage.setItem('codex-webui-locale','en')});
 page=await context.newPage();
 const errors=[],calls=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.routeWebSocket(`ws://127.0.0.1:${port}/ws`,ws=>{
  ws.onMessage(async raw=>{
   const msg=JSON.parse(String(raw));if(msg.type!=='rpc')return;
   calls.push(msg);const {method,params}=msg;let result={};
   if(method==='model/list')result={data:[{model:'gpt-fixture',displayName:'Fixture',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]};
   else if(method==='thread/list'||method==='permissionProfile/list'||method==='thread/turns/list')result={data:[]};
   else if(method==='thread/start')result={thread:{id:'skill-thread',cwd:workspace,canAcceptDirectInput:true}};
   else if(method==='turn/start')result={turn:{id:'skill-turn',status:'completed'}};
   else if(method==='skills/config/write'){
    const response=await api('/api/rpc',{id:msg.id,method,params});
    ws.send(JSON.stringify(response.data));return;
   }
   ws.send(JSON.stringify({type:'rpc/result',id:msg.id,result}));
  });
  ws.send(JSON.stringify({type:'bridge/status',status:'connected'}));
 });
 await page.goto(base,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>globalThis.__codexWebuiDebug?.state.threadsLoaded);
 await page.click('#sidebarTabSkills');
 await page.waitForSelector('.skills-card[data-skill-name="openai-docs"]');
 await page.click('.skills-card[data-skill-name="openai-docs"]');
 await page.waitForSelector('#skillInspectorBody .message-text');
 assert.equal(await page.locator('#skillInspectorEditButton').isHidden(),true);
 assert.equal(await page.locator('#skillInspectorDeleteButton').isHidden(),true);

 // Create through UI and assert native discovery (not a synthetic local list).
 await page.click('#skillsNewButton');
 await page.fill('#skillCreateNameInput','e2e-personal');
 await page.fill('#skillEditorTextarea',skillMd('e2e-personal','Initial description')+'\nPreserve my custom instructions.\n');
 await page.fill('#skillCreateDescInput','Custom workflow');
 assert.ok((await page.inputValue('#skillEditorTextarea')).includes('Preserve my custom instructions.'));
 const saveResponse=page.waitForResponse(r=>r.url().endsWith('/api/skills/personal')&&r.request().method()==='POST');
 await page.click('#skillInspectorSaveButton');
 assert.equal((await saveResponse).status(),200);
 await page.waitForSelector('.skills-card[data-skill-name="e2e-personal"]');
 const personalPath=join(codexHome,'skills','e2e-personal','SKILL.md');
 assert.ok(readFileSync(personalPath,'utf8').includes('Custom workflow'));
 const native=await api('/api/rpc',{id:1,method:'skills/list',params:{cwds:[workspace],forceReload:true}});
 assert.ok(native.data.result.data[0].skills.some(s=>s.path===personalPath&&s.name==='e2e-personal'));

 await page.waitForFunction(()=>!document.querySelector('#skillInspectorEditButton').hidden);
 await page.click('#skillInspectorEditButton');
 await page.fill('#skillEditorTextarea',skillMd('e2e-personal','Edited native skill')+'\nEdited instructions.\n');
 await page.click('#skillInspectorSaveButton');
 await page.waitForFunction(()=>document.querySelector('#skillInspectorBody')?.textContent?.includes('Edited instructions.'));

 // Enable/disable is persisted by Codex, and survives refresh. Disabled skill cannot be used.
 const personalCard=page.locator('.skills-card[data-skill-name="e2e-personal"]');
 assert.equal(await personalCard.locator('.skills-card-actions button').count(),1,'Installed skill cards should only show the enable switch');
 assert.equal(await personalCard.locator('.skills-mini-btn').count(),0);
 await personalCard.locator('.skills-switch').click();
 await page.waitForFunction(()=>document.querySelector('.skills-card[data-skill-name="e2e-personal"] .skills-switch')?.getAttribute('aria-checked')==='false');
 assert.equal(await page.locator('#skillInspectorUseButton').isDisabled(),true);
 await page.click('#skillsRefreshButton');
 await page.waitForFunction(()=>document.querySelector('.skills-card[data-skill-name="e2e-personal"] .skills-switch')?.getAttribute('aria-checked')==='false');
 await personalCard.locator('.skills-switch').click();
 await page.waitForFunction(()=>document.querySelector('.skills-card[data-skill-name="e2e-personal"] .skills-switch')?.getAttribute('aria-checked')==='true');
 await page.click('#skillInspectorUseButton');
 assert.equal(await page.locator('.composer-context-chip').count(),1,'Inspector Use must work after disable → refresh → enable');
 await page.locator('.composer-context-chip button').click();

 // Read-only external skill inspector; not editable/deletable even though it is a user-scope skill.
 await page.click('.skills-card[data-skill-name="external-demo"]');
 await page.waitForFunction(()=>document.querySelector('#skillInspectorBody')?.textContent?.includes('external-demo'));
 assert.equal(await page.locator('#skillInspectorEditButton').isHidden(),true);
 assert.equal(await page.locator('#skillInspectorDeleteButton').isHidden(),true);
 const denied=await api('/api/skills/personal',{path:join(external,'external-demo','SKILL.md')},'DELETE');
 assert.equal(denied.status,400);
 const arbitraryToggle=await api('/api/rpc',{id:4,method:'skills/config/write',params:{path:'/etc/SKILL.md',enabled:true}});
 assert.equal(arbitraryToggle.data.type,'rpc/error');

 // Complete curated bundle is copied once. Installed official skill remains in the Official tab.
 await page.click('#skillsFilterOfficial');
 const curatedCard=page.locator('.skills-card[data-skill-name="e2e-official"]');
 await curatedCard.click();
 await page.waitForFunction(()=>document.querySelector('#skillInspectorBody')?.textContent?.includes('e2e-official'));
 page.once('dialog',d=>d.accept());
 await page.click('#skillInspectorInstallButton');
 await page.waitForSelector('.skills-card[data-skill-name="e2e-official"][data-skill-category="official"]');
 assert.ok(existsSync(join(codexHome,'skills','e2e-official','scripts','helper.txt')));
 const duplicate=await api('/api/skills/install',{id:'e2e-official'});assert.equal(duplicate.status,400);
 await page.screenshot({path:artifact('skills-official-and-inspector.png')});

 // DSH-style /skill plus Codex-style $skill: selection creates a structured skill chip.
 await page.fill('#prompt','/e2e-per');
 await page.waitForSelector('[data-autocomplete-id^="skill:"]');
 await page.locator('[data-autocomplete-id^="skill:"]').first().click();
 assert.equal(await page.locator('.composer-context-chip').count(),1);
 await page.locator('.composer-context-chip button').click();
 await page.fill('#prompt','$e2e-per');
 await page.waitForSelector('[data-autocomplete-id^="skill:"]');
 await page.locator('[data-autocomplete-id^="skill:"]').first().click();
 await page.click('#sendButton'); // skill-only input is valid too
 await page.waitForFunction(()=>globalThis.__codexWebuiDebug.state.pending.size===0);
 const sent=calls.find(c=>c.method==='turn/start');
 assert.ok(sent,'Expected a turn/start from skill-only input');
 assert.deepEqual(sent.params.input.find(i=>i.type==='skill'),{type:'skill',name:'e2e-personal',path:personalPath});

 await page.click('#skillsFilterPersonal');
 await personalCard.click();
 await page.waitForFunction(()=>!document.querySelector('#skillInspectorDeleteButton').hidden);
 page.once('dialog',d=>d.accept());
 await page.click('#skillInspectorDeleteButton');
 await page.waitForFunction(()=>!document.querySelector('.skills-card[data-skill-name="e2e-personal"]'));
 assert.equal(existsSync(personalPath),false);
 // On tablet-width overlay panels, Use returns to the editable composer.
 await page.click('#closeSidePanel');
 await page.setViewportSize({width:980,height:900});
 await page.click('.skills-card[data-skill-name="external-demo"]');
 await page.waitForSelector('#skillsPanel:not([hidden]) #skillInspectorBody .message-text');
 await page.click('#skillInspectorUseButton');
 assert.equal(await page.locator('#sidePanel').isHidden(),true);
 assert.equal(await page.evaluate(()=>document.activeElement?.id),'prompt');
 assert.equal(await page.evaluate(()=>document.querySelector('.conversation-shell').inert),false);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({nativeDiscovery:true,createEditDelete:true,disabledSurvivesRefresh:true,externalReadOnly:true,curatedInstall:true,nativeSkillInput:true,errors},null,2));
} catch(error) {
 if(page){await page.screenshot({path:artifact('skills-failure.png')}).catch(()=>{});console.error(await page.evaluate(()=>({toast:document.querySelector('#toast')?.textContent,skills:globalThis.__codexWebuiDebug?.skillsState,editor:document.querySelector('#skillEditorTextarea')?.value})).catch(()=>({})));}
 throw error;
} finally {
 await browser?.close();server.kill();await server.exited;
 const stderr=await stderrPromise;if(server.exitCode&&server.exitCode!==143)console.error(stderr.slice(-5000));
 rmSync(home,{recursive:true,force:true});
}
