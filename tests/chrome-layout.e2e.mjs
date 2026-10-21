import { chromium } from 'playwright';
import { launchOptions } from './browser-runtime.mjs';

const browser=await chromium.launch(launchOptions());
const page=await browser.newPage({viewport:{width:1280,height:800},colorScheme:'dark'});
const baseUrl=process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899';
const pageErrors=[];
page.on('pageerror',error=>pageErrors.push(error.message));
await page.goto(baseUrl,{waitUntil:'networkidle'});

const initial=await page.evaluate(()=>{
  const topbar=document.querySelector('.topbar');
  const sidebar=document.querySelector('.sidebar');
  const main=document.querySelector('.conversation-shell');
  const sidePanel=document.querySelector('#sidePanel');
  const root=getComputedStyle(document.documentElement);
  return {
    topbarHeight:topbar?.getBoundingClientRect().height,
    hasBottomPanelButton:Boolean(document.querySelector('#toggleBottomPanel')),
    summaryToggleHidden:document.querySelector('#toggleSummaryPanel')?.hidden??true,
    hasSidePanelButton:Boolean(document.querySelector('#toggleSidePanel')),
    summaryPanelHidden:document.querySelector('#summaryPanel')?.hidden??null,
    sidePanelPressed:document.querySelector('#toggleSidePanel')?.getAttribute('aria-pressed'),
    sidePanelWidth:sidePanel?.getBoundingClientRect().width??null,
    sidePanelHidden:sidePanel?.hidden??null,
    appIconReferences:[...document.querySelectorAll('.window-brand img,.empty-state img,.assistant-mark img')].map(node=>node.getAttribute('src')).filter(Boolean),
    knotCount:document.querySelectorAll('[data-codex-interface-mark]').length,
    emptyHasKnot:Boolean(document.querySelector('#emptyState [data-codex-interface-mark]')),
    colors:{
      app:root.getPropertyValue('--app-main').trim(),
      sidebar:root.getPropertyValue('--app-sidebar').trim(),
      panel:root.getPropertyValue('--app-panel').trim(),
      border:root.getPropertyValue('--app-border').trim(),
      text:root.getPropertyValue('--app-text').trim(),
      topbar:getComputedStyle(topbar).backgroundColor,
      sidebarComputed:getComputedStyle(sidebar).backgroundColor,
      mainComputed:getComputedStyle(main).backgroundColor,
    },
    hasTerminalEntryPoints:Boolean(document.querySelector('#sidebarTerminalButton, #filesTerminalButton, #sideTerminalPanel, #sideTerminalHost, #terminalHost')),
  };
});

await page.click('#toggleSidePanel');
await page.waitForFunction(()=>document.querySelector('#sidePanel')&&!document.querySelector('#sidePanel').hidden&&document.querySelector('#sidePanel').getBoundingClientRect().width>0);
const opened=await page.evaluate(()=>({
  width:document.querySelector('#sidePanel').getBoundingClientRect().width,
  pressed:document.querySelector('#toggleSidePanel').getAttribute('aria-pressed'),
  title:document.querySelector('#sidePanelTitle')?.textContent?.trim(),
  activeTab:document.querySelector('.side-panel-tab.active')?.textContent?.trim(),
  filesVisible:!document.querySelector('#filesPanel')?.hidden,
  launcherHidden:document.querySelector('#sidePanelLauncher')?.hidden,
  reviewVisible:!document.querySelector('#reviewPanelContent')?.hidden,
  visibleTabs:[...document.querySelectorAll('.side-panel-tab')].filter(node=>node.getClientRects().length).map(node=>node.textContent.trim()),
}));

await page.evaluate(()=>globalThis.__codexWebuiDebug.openReviewPanel());
const review=await page.evaluate(()=>({
  activeTab:document.querySelector('.side-panel-tab.active')?.textContent?.trim(),
  reviewVisible:!document.querySelector('#reviewPanelContent')?.hidden,
  launcherHidden:document.querySelector('#sidePanelLauncher')?.hidden,
  visibleTabs:[...document.querySelectorAll('.side-panel-tab')].filter(node=>node.getClientRects().length).map(node=>node.textContent.trim()),
}));

await page.click('#toggleSidePanel');
await page.waitForFunction(()=>document.querySelector('#sidePanel').hidden||document.querySelector('#sidePanel').getBoundingClientRect().width===0);

console.log(JSON.stringify({initial,opened,review,pageErrors},null,2));
await browser.close();

const valid=pageErrors.length===0
  &&initial.topbarHeight===46
  &&initial.summaryToggleHidden===true
  &&initial.hasSidePanelButton
  &&initial.summaryPanelHidden===true
  &&initial.sidePanelPressed==='false'
  &&initial.sidePanelWidth===0
  &&initial.sidePanelHidden===true
  &&initial.appIconReferences.length===0
  &&initial.knotCount>=2
  &&initial.emptyHasKnot
  &&initial.colors.app
  &&initial.colors.sidebar
  &&initial.colors.panel
  &&initial.colors.border
  &&initial.colors.text
  &&initial.hasTerminalEntryPoints===false
  &&opened.width>=320
  &&opened.pressed==='true'
  &&opened.title==='File preview'
  &&opened.activeTab==='File preview'
  &&opened.filesVisible===true
  &&opened.launcherHidden===true
  &&opened.reviewVisible===false
  &&review.activeTab?.startsWith('Review')
  &&review.reviewVisible===true
  &&review.launcherHidden===true;
if(!valid)process.exit(1);
