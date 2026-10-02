#!/usr/bin/env node
/**
 * Two distinct real-model design briefs: this lane tests a desktop production schedule.
 * Uses real UI send, real API, PGlite and configured DashScope. No fixture/model mock.
 * Read evidence screenshots before writing the visual audit; metrics alone are insufficient.
 * Requires the owned stack and explicit authorization for real-provider requests.
 */
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'evidence/design-html-20261001/fullstack-skill');
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('playwright-core');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
page.setDefaultTimeout(120000);
await page.goto('http://127.0.0.1:3192/login?next=%2Fstudio%2Fdesign-workbench');
await page.getByTestId('login-email').fill('me@local.workspacex');
await page.getByTestId('login-password').fill(JSON.parse(readFileSync('/private/tmp/wsx-html-data/secrets.json', 'utf8')).adminPassword);
await page.getByTestId('login-submit').click();
await page.waitForURL(url => !url.pathname.startsWith('/login'));
async function measureContrast(frame) {
  return frame.evaluate(() => {
    const rgb = value => (value.match(/[0-9.]+/g) || []).map(Number);
    const luminance = color => color.slice(0, 3).map(value => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    return [...document.querySelectorAll('body *')].filter(element => element.childElementCount === 0 && element.innerText?.trim() && element.getBoundingClientRect().height > 0).map(element => {
      const style = getComputedStyle(element), foreground = rgb(style.color);
      let background = [255, 255, 255], opacity = 1;
      for (let parent = element; parent; parent = parent.parentElement) {
        opacity *= Number(getComputedStyle(parent).opacity);
      }
      for (let parent = element; parent; parent = parent.parentElement) {
        const color = rgb(getComputedStyle(parent).backgroundColor);
        if (color.length >= 3 && (color[3] === undefined || color[3] > 0)) { background = color; break; }
      }
      const alpha = (foreground[3] ?? 1) * opacity;
      const effective = foreground.slice(0, 3).map((value, index) => value * alpha + background[index] * (1 - alpha));
      const first = luminance(effective), second = luminance(background);
      const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
      return { text: element.innerText.trim(), class: element.className, foreground: style.color, background, opacity, fontSize: style.fontSize, ratio, ok: ratio >= 4.5 };
    });
  });
}
const token = await page.evaluate(() => localStorage.getItem('wsx.sessionToken'));
let project, result;
const projectArg = process.argv.indexOf('--project');
if (projectArg !== -1) {
  const response = await fetch('http://127.0.0.1:3292/pm-designs', { headers: { authorization: `Bearer ${token}` } });
  project = (await response.json()).items.find(item => item.id === process.argv[projectArg + 1]);
  if (!project) throw Error('Project not found');
  writeFileSync(join(out, 'final-project.json'), JSON.stringify(project, null, 2));
  await page.goto(`http://127.0.0.1:3192/studio/design-workbench/${project.id}`);
  await page.getByTestId('design-detail').waitFor();
} else {
const res = await fetch('http://127.0.0.1:3292/pm-designs', {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ name: '巷口烘焙社·生产排班', template: 'ui', problem: '社区咖啡烘焙师按时间安排烘豆批次，检查设备冲突与交付时间' }),
});
if (!res.ok) throw Error(`Create failed: ${res.status}`);
({ project } = await res.json());
await page.goto(`http://127.0.0.1:3192/studio/design-workbench/${project.id}`);
await page.getByTestId('design-detail').waitFor();
const brief = '设计一个桌面端社区咖啡烘焙生产排班板，只画两页：第一页面是生产排班，第二页是批次明细。服务真实烘焙师的工作，不是营销落地页。明确要求浅色牛皮纸背景 #E8D9BC、深咖啡文字 #3B2D23，辅助色为铜锈橙 #A85532；遵循我的浅色方向，不要自动改成黑色。首屏的记忆点是横向时间刻度和纵向生产行交叉的工作台，呈现08:00-16:00两台烘豆机的真实批次安排与交叠冲突，使用细线表格/时间带而非卡片阵列。内容包括埃塞耶加雪菲水洗12kg、巴西黄波旁18kg、云南花果山15kg，负责人林烘/陈澄，批次R0612-01/02/03，明确开始结束时间、烘焙度、交付时间与冲突。字体请结合印刷工单和烘焙行业的质感有主见地选择，有清晰阅读层级，少量衬线标题搭配清晰工作数据。每个按钮写具体动作，不要空泛Submit/立即开始。第二页有返回排班的交互，第一页面点批次打开明细。桌面信息密度与情绪日记完全不同，但保留舒适留白。请有可见键盘焦点，尊重prefers-reduced-motion，375px可读且无水平溢出；不要装饰性编号、无意义英文全大写眉题或把每个区块做成同款圆角卡。先按主体做设计简报、自审是否模板化，然后完成页面。';
writeFileSync(join(out, 'brief.txt'), brief);
await page.getByTestId('design-detail-input').fill(brief);
const [generated] = await Promise.all([
  page.waitForResponse(response => response.url().endsWith(`/pm-designs/${project.id}/chat`) && response.request().method() === 'POST', { timeout: 600000 }),
  page.getByTestId('design-detail-send').click(),
]);
result = await generated.json();
writeFileSync(join(out, 'real-model-result.json'), JSON.stringify(result, null, 2));
if (result.reply?.source !== 'model' || result.project.prototype.length !== 2 || result.project.prototype.some(node => node.type !== 'html')) throw Error('Real model did not generate two HTML screens');
}
await page.getByTestId('design-detail-view-single').click();
if (process.argv.includes('--revise')) {
  const revisionFrame = (process.argv.includes('--batch-contrast') || process.argv.includes('--batch-id-fix')) ? 1 : 0;
  await page.getByTestId(`design-detail-frame-${revisionFrame}`).click();
  let expectedRef;
  await page.getByTestId('design-detail-more').click();
  await page.getByTestId('design-detail-more-structure').click();
  await page.getByTestId(`design-layer-${project.prototype[revisionFrame].id}`).click();
  await page.getByTestId('design-detail-input').fill(process.argv.includes('--batch-id-fix') ? 'In the selected batch details page, fix only the CSS color for .detail-batch-id from #A85532 to #3B2D23. This one remaining 13px batch number is still low contrast. Preserve the entire existing HTML structure, text, layout and every other CSS declaration. Check the .detail-batch-id declaration explicitly. Output the same whole page with this one color correction.' : process.argv.includes('--business-revision') ? 'Only revise the selected schedule page. Keep the batch details page unchanged. Preserve the approved kraft-paper palette, readable 4-line 13px typography and real 375px vertical layout. The axis is 08:00-16:00, exactly 8 hours. Machine 1 R0612-01 is 08:00-09:30: left 0%, width 18.75%. Machine 1 R0612-02 is 08:30-11:00: left 6.25%, width 31.25%. Machine 2 R0612-03 is 09:30-11:00: left 18.75%, width 18.75%. All percentages must be relative to the entire machine time row. Only R01 and R02 conflict on machine 1 during 08:30-09:30. R03 on the independent machine 2 is not in conflict; do not invent shared cooling equipment. Fix all Chinese conflict labels accordingly, including mobile. Separate overlapping batches into tracks with at least 96px button height and at least 220px machine row height so all four text lines fit without clipping. Use deep coffee #3B2D23 for all text without opacity; copper is decoration only. Check that every bar position, width, printed time and conflict message agrees before returning the full revised page.' : process.argv.includes('--batch-contrast') ? 'Only revise the selected batch details page; leave the schedule page unchanged. Keep the kraft-paper background #E8D9BC and serif work-order title. All dates, batch IDs, labels, status and conflict text must use deep coffee #3B2D23 without opacity; copper #A85532 is for borders and decoration only. All information text must be at least 13px with line-height 1.5, readable and unclipped. At actual 375px rearrange the two-column desktop information into one column with no horizontal scrolling. The displayed batch R0612-01 on machine 1 runs 08:00-09:30 and overlaps R0612-02 on the SAME machine 1 during 08:30-09:30. Correct the conflict explanation to this interval and these two batch IDs. The independent machine 2 R03 running at the same time is NOT an equipment conflict; remove the fictional shared cooling equipment narrative. Keep the semantic return-to-schedule button, visible keyboard focus and reduced-motion support. Self-critique the readable information, semantic consistency and foreground/background color pairs before outputting the whole page.' : process.argv.includes('--contrast-revision') ? '最后只修订当前排班整页的文字对比度，第二页保持不变。布局已经通过：两机台时间带、分轨批次完整四行、独立冲突提示以及375px纵向列表都保留，不要重画布局。铜锈#A85532在牛皮纸#E8D9BC上的小字对比只有3.76:1，不达4.5:1。请所有日期、批次id、状态、冲突提示、时间刻度等小字改用深咖啡#3B2D23，不使用opacity来淡化文字；铜锈继续用于细线、焦点框、冲突边框和装饰，遵守我原配色。时间刻度和所有信息文字至少13px，行高1.5，不被裁切。浅色豆批块#F4EBD8上的文字也用深咖啡，不要低对比度次要文案。保留每批按钮鼠标与键盘点击、focus-visible/reduced-motion及无横滚的真实375响应式。自审小字背景和前景配对后输出整页。' : process.argv.includes('--second-revision') ? '继续修订当前整页排班，第二页保持不变。第一轮虽然修复了width，batch按钮仍仅约40px高，三行span总计约50px被flex压缩，豆名文字上下裁掉，冲突斜纹还穿过批次正文，不能通过视觉验收。请每条生产行至少160px高，重叠批次两轨排列，每轨至少72px高。每个批次至少三到四行，字级不小于13px且line-height:1.5，完整展示批次号、豆名/kg、负责人/烘焙度、开始结束时间；不要任何字被裁掉或省略，不要固定height不足时把span压缩。冲突改成独立顶端提示条或批次边框，禁止overlay穿过按钮内容；每个批次可以正常鼠标点击。保留牛皮纸浅底深咖啡色，留白适度，桌面排班区域用实际信息占据主要空间而不是大片空框。375px保留已通过的按机台纵向列表，无内部横向滚动。保留可见keyboard focus和reduced-motion。模型自审每个span的高度是否足够然后输出整页。' : '请按真实截图自审修订当前生产排班这一整页，第二页保持不变。当前machine-row只占了一个grid cell，导致batch按钮仅18px宽、批次号被挤到零宽；要把每个机器时间行显式grid-column:2 / -1占满全部时间列，机台标题列和时间头网格对齐，并检查百分比定位的父容器宽度。保留牛皮纸浅底和深咖啡文字，批次号、豆名、kg、负责人、起止时间全部可读。冲突区域可显示斜纹但pointer-events:none，不盖住按钮，重叠批次分轨排列，各批次都可鼠标点击。实际375px不能靠桌面缩小或横向滚动，请在media query改成逐机台的纵向时间列表，每批次明确开始结束，所有文字完整可读。保留semantic button、focus-visible、reduced-motion。自审后输出完整修订这一页。');
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/pm-designs/${project.id}/chat`) && response.request().method() === 'POST', { timeout: 600000 }),
    page.getByTestId('design-detail-send').click(),
  ]);
  const sent = response.request().postDataJSON();
  if (sent.focusNodeId !== project.prototype[revisionFrame].id || sent.focusRef !== expectedRef) throw Error('Revision did not target the whole selected page');
  result = await response.json();
  writeFileSync(join(out, process.argv.includes('--batch-id-fix') ? 'batch-element-model-result.json' : process.argv.includes('--batch-contrast') ? 'batch-revised-model-result.json' : process.argv.includes('--business-revision') ? 'business-model-result.json' : 'revised-model-result.json'), JSON.stringify(result, null, 2));
  if (result.reply.source !== 'model') throw Error('Revision returned model fallback');
  if (result.project.prototype[1 - revisionFrame].props.html !== project.prototype[1 - revisionFrame].props.html) throw Error('Unselected batch page changed');
  project = result.project;
  await page.reload();
  await page.getByTestId('design-detail').waitFor();
  await page.getByTestId('design-detail-view-single').click();
}
if (process.argv.includes('--diagnose')) {
  await page.getByTestId('design-html-page').waitFor({ state: 'attached' });
  const frame = await (await page.getByTestId('design-html-page').elementHandle()).contentFrame();
  await frame.locator('[data-ref="r34"]').waitFor({ state: 'attached' });
  const outer = await page.getByTestId('design-html-page').evaluate(element => {
    const ancestors = [];
    for (let current = element; current && ancestors.length < 8; current = current.parentElement) {
      const bounds = current.getBoundingClientRect(), style = getComputedStyle(current);
      ancestors.push({ tag: current.tagName, class: current.className, width: bounds.width, height: bounds.height, display: style.display, position: style.position, minHeight: style.minHeight, flex: style.flex });
    }
    return ancestors;
  });
  const inner = await frame.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    text: document.body.innerText.slice(0, 150),
    nodes: [...document.querySelectorAll('.page,.schedule-grid,.batch-btn,.batch-id,.batch-bean,.batch-meta')].map(element => { const bounds=element.getBoundingClientRect(), style=getComputedStyle(element); return { class: element.className, width: bounds.width, height: bounds.height, y: bounds.y, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflow: style.overflow, display: style.display, visibility: style.visibility, fontSize: style.fontSize }; }),
  }));
  writeFileSync(join(out, 'diagnostics.json'), JSON.stringify({ outer, inner }, null, 2));
  await browser.close();
  console.log(JSON.stringify({ outer, inner }));
  process.exit();
}
await page.frameLocator('[data-testid="design-html-page"]').getByText('生产排班', { exact: true }).first().waitFor();
const geometryFrame = await (await page.getByTestId('design-html-page').elementHandle()).contentFrame();
const geometry = await geometryFrame.evaluate(() => {
  const buttons = [...document.querySelectorAll('button[data-goto="1"]')].filter(button => button.getBoundingClientRect().height > 0);
  return buttons.map(button => {
    const container = button.offsetParent;
    const rect = button.getBoundingClientRect(), parent = container.getBoundingClientRect();
    return { text: button.innerText, containerClass: container.className, width: rect.width, height: rect.height, containerWidth: container.clientWidth, leftRatio: (rect.left - parent.left - container.clientLeft) / container.clientWidth, widthRatio: rect.width / container.clientWidth };
  });
});
const minute = time => { const [hours, minutes] = time.split(':').map(Number); return hours * 60 + minutes; };
const expected = [{ id: 'R0612-01', start: '08:00', end: '09:30' }, { id: 'R0612-02', start: '08:30', end: '11:00' }, { id: 'R0612-03', start: '09:30', end: '11:00' }];
const businessAssertions = expected.map(batch => {
  const actual = geometry.find(button => button.text.includes(batch.id));
  const start = (minute(batch.start) - minute('08:00')) / (minute('16:00') - minute('08:00'));
  const width = (minute(batch.end) - minute(batch.start)) / (minute('16:00') - minute('08:00'));
  const tolerance = actual ? 2 / actual.containerWidth : 0;
  return { ...batch, expectedLeft: start, expectedWidth: width, actual, ok: !!actual && Math.abs(actual.leftRatio - start) <= tolerance && Math.abs(actual.widthRatio - width) <= tolerance && actual.text.includes(batch.start) && actual.text.includes(batch.end) };
});
writeFileSync(join(out, 'business-geometry.json'), JSON.stringify(businessAssertions, null, 2));
const scheduleContrast = await measureContrast(geometryFrame);
await page.screenshot({ path: join(out, '01-schedule-desktop.png'), fullPage: true });
await page.getByTestId('design-detail-frame-1').click();
await page.frameLocator('[data-testid="design-html-page"]').getByText('埃塞耶加雪菲水洗', { exact: true }).waitFor();
await page.screenshot({ path: join(out, '02-batch-desktop.png'), fullPage: true });
const batchFrame = await (await page.getByTestId('design-html-page').elementHandle()).contentFrame();
writeFileSync(join(out, 'text-contrast.json'), JSON.stringify({ schedule: scheduleContrast, batch: await measureContrast(batchFrame) }, null, 2));
await page.getByTestId('design-detail-frame-0').click();
await page.getByTestId('design-detail-mode-preview').click();
const preview = page.frameLocator('[data-testid="design-html-page"]');
const previewFrame = await (await page.getByTestId('design-html-page').elementHandle()).contentFrame();
await previewFrame.waitForFunction(() => document.documentElement.getAttribute('data-mode') === 'preview' && document.readyState === 'complete');
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const link = preview.locator('[data-goto="1"]:visible').first();
const mouseNavigation = [];
for (let index = 0; index < await preview.locator('[data-goto="1"]:visible').count(); index += 1) {
  try {
    await preview.locator('[data-goto="1"]:visible').nth(index).click({ timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="design-detail-frame-1"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 10000 });
    mouseNavigation.push({ index, ok: true });
  } catch (error) { mouseNavigation.push({ index, ok: false, error: error.message }); }
  await page.getByTestId('design-detail-frame-0').click();
}
writeFileSync(join(out, 'mouse-navigation.json'), JSON.stringify(mouseNavigation, null, 2));
await link.focus();
await page.keyboard.press('Tab');
const desktopFrame = await (await page.getByTestId('design-html-page').elementHandle()).contentFrame();
const accessibility = await desktopFrame.evaluate(() => {
  const active = document.activeElement;
  const style = getComputedStyle(active);
  const styles = [...document.querySelectorAll('style')].map(element => element.textContent).join('\n');
  const inputs = [...document.querySelectorAll('input,textarea,select')];
  return {
    focused: { tag: active.tagName, text: active.textContent?.slice(0, 60), visible: active.matches(':focus-visible'), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor },
    reducedMotionRule: styles.includes('prefers-reduced-motion'),
    declaredMotion: /animation\s*:|transition\s*:/.test(styles),
    inputs: inputs.map(input => ({ tag: input.tagName, labelled: !!(input.getAttribute('aria-label') || input.getAttribute('aria-labelledby') || input.labels?.length) })),
  };
});
await page.screenshot({ path: join(out, '05-keyboard-focus.png'), fullPage: true });
await page.emulateMedia({ reducedMotion: 'reduce' });
accessibility.reducedMotionMatches = await desktopFrame.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
writeFileSync(join(out, 'accessibility.json'), JSON.stringify(accessibility, null, 2));
await link.focus();
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelector('[data-testid="design-detail-frame-1"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 10000 });
await page.screenshot({ path: join(out, '03-preview-batch.png'), fullPage: true });
await page.getByTestId('design-detail-frame-0').click();
await page.setViewportSize({ width: 375, height: 812 });
const html = project.prototype[0].props.html;
await page.setContent('<style>body{margin:0}</style><iframe sandbox="allow-scripts" style="width:375px;height:812px;border:0"></iframe>');
await page.locator('iframe').evaluate((element, content) => { element.srcdoc = content; }, html);
const htmlFrame = await (await page.locator('iframe').elementHandle()).contentFrame();
await htmlFrame.getByText('生产排班', { exact: true }).first().waitFor();
const metrics = await htmlFrame.evaluate(() => ({
  clientWidth: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
  internalScrollers: [...document.querySelectorAll('*')].filter(element => element.scrollWidth > element.clientWidth + 1).map(element => ({ class: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: getComputedStyle(element).overflowX })),
}));
await page.screenshot({ path: join(out, '04-schedule-mobile.png'), fullPage: true });
writeFileSync(join(out, 'metrics.json'), JSON.stringify({ url: `http://127.0.0.1:3192/studio/design-workbench/${project.id}`, method: '375px iframe containing persisted model HTML; no saved data edits', viewport375: metrics }, null, 2));
await page.locator('iframe').evaluate((element, content) => { element.srcdoc = content; }, project.prototype[1].props.html);
await htmlFrame.locator('.detail-title').waitFor();
const batchMobileMetrics = await htmlFrame.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
await page.screenshot({ path: join(out, '06-batch-mobile.png'), fullPage: true });
writeFileSync(join(out, 'batch-mobile-metrics.json'), JSON.stringify(batchMobileMetrics, null, 2));
await browser.close();
console.log('Real design skill lane generated and captured; visual review required:', project.id);

} finally {
  await browser.close();
}
