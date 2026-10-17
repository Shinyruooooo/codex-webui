import { chromium } from 'playwright';
import { artifact, launchOptions } from './browser-runtime.mjs';

const browser=await chromium.launch(launchOptions());
const page=await browser.newPage({viewport:{width:1018,height:980},colorScheme:'dark'});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.goto(process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899',{waitUntil:'networkidle'});

const selectedProject=await page.evaluate(()=>({
  projectButton:document.querySelector('#projectButton')?.textContent?.trim(),
  sidebar:document.querySelector('#projectName')?.textContent?.trim(),
  heading:document.querySelector('#emptyState h1')?.textContent?.trim(),
}));
await page.click('#projectButton');
await page.waitForSelector('#folderDialog[open]');
await page.screenshot({path:artifact('composer-project-picker.png'),fullPage:false});
const picker=await page.evaluate(()=>({
  projectless:document.querySelector('#projectlessOption')?.textContent?.replace(/\s+/g,' ').trim(),
  title:document.querySelector('#folderDialog .folder-head strong')?.textContent?.trim(),
}));
await page.click('#projectlessOption');
await page.locator('#prompt').fill('@file');
await page.waitForSelector('#composerAutocomplete:not([hidden])');
await page.screenshot({path:artifact('composer-projectless.png'),fullPage:false});
const chooseProjectAction=await page.evaluate(()=>({
  exists:Boolean(document.querySelector('#composerAutocomplete [data-autocomplete-id="choose-project"]')),
  text:document.querySelector('#composerAutocomplete [data-autocomplete-id="choose-project"]')?.textContent?.replace(/\s+/g,' ').trim(),
}));
await page.click('#composerAutocomplete [data-autocomplete-id="choose-project"]');
const projectPickerReopened=await page.locator('#folderDialog').evaluate(dialog=>dialog.open);
await page.locator('#folderDialog .folder-cancel').click();
const projectless=await page.evaluate(()=>({
  heading:document.querySelector('#emptyState h1')?.textContent?.trim(),
  sidebar:document.querySelector('#projectName')?.textContent?.trim(),
  path:document.querySelector('#projectPath')?.textContent?.trim(),
  threadPath:document.querySelector('#threadPath')?.textContent?.trim(),
  projectButton:document.querySelector('#projectButton')?.textContent?.replace(/\s+/g,' ').trim(),
  dialogOpen:document.querySelector('#folderDialog')?.open,
  mentionMessage:document.querySelector('#composerAutocomplete')?.textContent?.trim(),
}));
await page.evaluate(()=>{const api=globalThis.__codexWebuiDebug;api.state.active={id:'existing',name:'Existing task',cwd:`${api.state.config.home}/projects/codex-webui`,source:'local'};api.renderHeader()});
const existing=await page.evaluate(()=>({projectButton:document.querySelector('#projectButton')?.textContent?.trim(),placeholder:document.querySelector('#prompt')?.placeholder}));
console.log(JSON.stringify({selectedProject,picker,chooseProjectAction,projectPickerReopened,projectless,existing,errors},null,2));
await browser.close();

if(!selectedProject.projectButton?.includes('Projects')
  ||!selectedProject.heading?.includes(selectedProject.sidebar)
  ||picker.title!=='Project'
  ||!picker.projectless?.includes('None')||!picker.projectless?.includes("Don't work in a project")
  ||projectless.heading!=='What can I help?'
  ||projectless.sidebar!=='Tasks'
  ||projectless.path!=='~'
  ||projectless.threadPath!==''
  ||!projectless.projectButton?.includes('Projects')
  ||projectless.dialogOpen
  ||!chooseProjectAction.exists||!chooseProjectAction.text?.includes('Choose project')
  ||!projectPickerReopened
  ||!existing.projectButton?.includes('Projects')
  ||existing.placeholder!=='Ask for follow-up changes'
  ||errors.length)process.exit(1);
