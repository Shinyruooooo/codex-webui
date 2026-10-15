import { chromium, devices } from 'playwright';
import { artifact, launchOptions } from './browser-runtime.mjs';

const browser=await chromium.launch(launchOptions());
const context=await browser.newContext({
  ...devices['Pixel 7'],
  viewport:{width:980,height:1800},
  screen:{width:412,height:915},
  isMobile:true,
  hasTouch:true,
});
const page=await context.newPage();
await page.goto(process.env.CODEX_WEBUI_TEST_URL||'http://127.0.0.1:8899',{waitUntil:'networkidle'});
const before=await page.evaluate(()=>({
  innerWidth,
  coarse:matchMedia('(pointer: coarse)').matches,
  mobileClass:document.documentElement.classList.contains('mobile-device'),
  sidebarX:document.querySelector('#sidebar').getBoundingClientRect().x,
  sidebarWidth:document.querySelector('#sidebar').getBoundingClientRect().width,
  mainX:document.querySelector('.conversation-shell').getBoundingClientRect().x,
  sidebarPosition:getComputedStyle(document.querySelector('#sidebar')).position,
  bodyHidden:document.body.classList.contains('sidebar-hidden'),
}));
await page.click('#toggleSidebar');
await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().width===0);
const closed=await page.evaluate(()=>({
  sidebarWidth:document.querySelector('#sidebar').getBoundingClientRect().width,
  mainX:document.querySelector('.conversation-shell').getBoundingClientRect().x,
  bodyHidden:document.body.classList.contains('sidebar-hidden'),
}));
await page.click('#toggleSidebar');
await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().width===275);
await page.click('.thread-item');
const after=await page.evaluate(()=>{const sidebar=document.querySelector('#sidebar'),rect=sidebar.getBoundingClientRect(),mainRect=document.querySelector('.conversation-shell').getBoundingClientRect();return{
  x:rect.x,
  right:rect.right,
  width:rect.width,
  mainX:mainRect.x,
  bodyHidden:document.body.classList.contains('sidebar-hidden'),
  position:getComputedStyle(sidebar).position,
}});
await page.screenshot({path:artifact('mobile-device-sidebar.png'),fullPage:false});
console.log(JSON.stringify({before,closed,after},null,2));
await browser.close();
if(!before.coarse||!before.mobileClass||before.sidebarPosition==='fixed'||before.sidebarWidth!==275||before.mainX!==275||before.bodyHidden||closed.sidebarWidth!==0||closed.mainX!==0||!closed.bodyHidden||after.bodyHidden||after.width!==275||after.mainX!==275)process.exit(1);
