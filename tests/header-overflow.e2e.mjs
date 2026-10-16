// Deterministic layout regression: actual application markup/styles, no Codex or network required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { root, artifact, launchOptions } from './browser-runtime.mjs';

const html = readFileSync(`${root}/public/index.html`, 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link\b[^>]*>/gi, '');
const css = readFileSync(`${root}/public/style.css`, 'utf8');
const titles = [
  '审计目前的结果你觉得kg方法可以用来做计算吗',
  '@刘杰作业运行详单_20260831-20261014.xlsx @消费详情-20261015.xlsx 使用这个数据参考统计pdf输出一份新的pdf报告 Attached files: @2026年9月数据',
  'a-single-unbroken-title-'.repeat(30),
];
const browser = await chromium.launch(launchOptions());
const reports = [];
try {
  const page = await browser.newPage({ viewport: { width: 980, height: 900 }, reducedMotion: 'reduce' });
  await page.setContent(html);
  await page.addStyleTag({ content: css });
  for (const width of [1280, 980, 820, 720, 591, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const collapsed of [false, true]) {
      for (const title of titles) {
        const result = await page.evaluate(({ title, collapsed }) => {
          document.documentElement.classList.add('mobile-device');
          document.body.classList.toggle('sidebar-hidden', collapsed);
          document.querySelector('#threadTitle').textContent = title;
          document.querySelector('#threadPath').textContent = '~/project/1_GST/Paper_data/work/04_conductivity/kubogreenwood/validation_04';
          document.querySelector('#threadActionsWrap').hidden = false;
          const rect = node => { const r = node.getBoundingClientRect(); return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height }; };
          const heading=document.querySelector('.thread-heading'),label=document.querySelector('#threadTitle'),path=document.querySelector('#threadPath'),bar=document.querySelector('.topbar'),actions=document.querySelector('.top-actions');
          return {
            heading:rect(heading),title:rect(label),path:rect(path),bar:rect(bar),actions:rect(actions),main:rect(document.querySelector('.conversation-shell')),
            whiteSpace:getComputedStyle(label).whiteSpace,overflow:getComputedStyle(label).overflowX,textOverflow:getComputedStyle(label).textOverflow,
            labelOverflow:label.scrollWidth>label.clientWidth,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,
            controls:[...document.querySelectorAll('#toggleSidebar,#threadActionsButton,#toggleSidePanel')].map(node=>({ ...rect(node),over:document.elementFromPoint(node.getBoundingClientRect().left+16,23)?.closest('button')?.id===node.id })),
          };
        }, { title, collapsed });
        assert.equal(result.whiteSpace,'nowrap',`Title wraps at ${width}px`);
        assert.equal(result.textOverflow,'ellipsis');
        assert.equal(result.overflow,'hidden');
        assert.equal(result.bar.height,46);
        assert.ok(result.heading.height<=46.5,`Heading exceeds header: ${JSON.stringify(result)}`);
        assert.ok(result.title.top>=result.bar.top-.5 && result.title.bottom<=result.main.top+.5,`Title covers conversation at ${width}px: ${JSON.stringify(result)}`);
        assert.ok(result.title.right<=result.heading.right+.5 && result.path.right<=result.heading.right+.5);
        assert.ok(result.heading.right<=result.actions.left+.5,`Heading covers actions at ${width}px`);
        assert.ok(result.title.width>20,`No usable title area at ${width}px`);
        assert.ok(result.scrollWidth<=result.viewport);
        assert.ok(result.controls.every(c=>c.over&&c.width>=31.5&&c.right<=result.viewport+.5),`Header controls obscured: ${JSON.stringify(result)}`);
        reports.push({width,collapsed,titleHeight:result.title.height,truncated:result.labelOverflow});
      }
    }
    if(width===980)await page.screenshot({path:artifact('header-long-title-ipad-split.png')});
  }
  // Empty path must not leave a reserved project column or suppress the title.
  await page.evaluate(()=>document.querySelector('#threadPath').textContent='');
  assert.equal(await page.locator('#threadPath').evaluate(el=>getComputedStyle(el).display),'none');
  console.log(JSON.stringify({cases:reports.length,overflow:false,controlsVisible:true,reports:reports.filter((_,i)=>i%3===0)},null,2));
} finally { await browser.close(); }
