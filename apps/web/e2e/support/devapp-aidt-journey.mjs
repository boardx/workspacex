/** Live Dev acceptance: only visible UI creates/edits/explicitly confirms owned QA data.
 * A synthetic journey checks software behavior, never real interviews or classroom outcomes.
 * Credentials, request allowlists, run identity and evidence publication belong to the runner.
 */
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';

export const REQUIRED_CHECKS = Object.freeze([
  'overview', 's1-draft-not-complete', 's1-confirmed-reentry',
  's2-interview-handoff', 's2-distinct-threads', 's3-definition-hmw-handoff',
  's4-three-distinct-descriptions', 's5-prototype-question-version',
  's6-test-reflection', 'report-confirmed-source-export',
  'six-stage-completion', 'anonymous-access-boundary',
]);
const fail = code => { throw new ProbeFailure(code); };
const SYNTHETIC = '合成验收数据，非真实访谈';

// A small, valid, run-specific schematic fixture. It is not a generated prototype or person photo.
export function schematicPng(identity, ordinal) {
  const width = 240, height = 120;
  const seed = createHash('sha256').update(`${identity}:${ordinal}`).digest();
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const block = x > 18 && x < 222 && y > 24 && y < 96;
      for (let c = 0; c < 3; c++) raw[start + 1 + x * 3 + c] = block ? seed[(Math.floor(x / 60) + c + ordinal) % seed.length] : 245;
    }
  }
  const crc = bytes => {
    let n = 0xffffffff;
    for (const byte of bytes) { n ^= byte; for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); }
    return (n ^ 0xffffffff) >>> 0;
  };
  const chunk = (kind, data) => {
    const type = Buffer.from(kind); const head = Buffer.alloc(4), tail = Buffer.alloc(4);
    head.writeUInt32BE(data.length); tail.writeUInt32BE(crc(Buffer.concat([type, data])));
    return Buffer.concat([head, type, data, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from(`QA synthetic schematic\0${identity}:${ordinal}`)), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export async function runAidtJourney({ page, expect, scope, checkpoint, capture, api,
  saveStage, reviewAndSave, report, registerFixture, saveReport, saveDownload,
  armDesignCreate, armDesignGeneration, createAnonymousPage }) {
  if (scope.syntheticLabel !== SYNTHETIC) fail('SYNTHETIC_SCOPE_REQUIRED');
  const root = `/aidt/${encodeURIComponent(scope.projectId)}`;
  const origin = new URL(page.url()).origin;
  const unique = `${scope.runId}-${scope.runAttempt}`.replace(/[^a-zA-Z0-9-]/g, '').slice(-28);
  const text = value => `${SYNTHETIC}。${value}`;
  const owned = href => {
    const url = new URL(href, origin);
    if (url.origin !== origin || url.pathname !== root) fail('LINK_OUTSIDE_OWNED_WORKSPACE');
    return url.href;
  };
  const go = async (stage, query = '') => {
    await page.goto(`${origin}${root}${stage ? `?step=${stage}${query}` : ''}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('aidt-project-workspace')).toBeVisible();
  };
  const btn = (name, host = page) => host.getByRole('button', { name, exact: true });
  const click = async locator => { await expect(locator).toBeVisible(); await expect(locator).toBeEnabled(); await locator.click(); };
  const fill = async (label, value, host = page) => { const locator = host.getByLabel(label, { exact: true }); await expect(locator).toBeEditable(); await locator.fill(value); };
  const disclosure = async name => {
    const summary = page.locator('summary').filter({ hasText: name }).first();
    await expect(summary).toBeVisible();
    if (await summary.locator('..').getAttribute('open') === null) await summary.click();
  };
  const follow = async name => {
    const link = page.getByRole('link', { name, exact: true }); await expect(link).toBeVisible();
    const href = owned(await link.getAttribute('href')); await link.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(root);
    return href;
  };
  const output = async () => {
    const url = new URL(page.url()); url.searchParams.set('tool', 'outcome');
    await page.goto(owned(url.href), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('aidt-shared-save')).toBeVisible();
  };
  const persistConfirmed = async (stage, control, saveControl) => {
    await reviewAndSave(stage, control);
    // Explicit entity confirmation is a local UI action; persist through the normal CAS button.
    const save = saveControl ?? page.getByTestId('aidt-shared-save');
    if (await save.isVisible() && await save.isEnabled()) await click(save);
    if (!saveControl) await expect(page.getByTestId('aidt-shared-status')).toContainText('小组已保存', { timeout: 30000 });
  };
  const shot = async (name, stage) => {
    const url = new URL(page.url());
    if (url.pathname === root && (!stage || url.searchParams.get('step') === String(stage))) await capture(name, stage);
  };
  const check = async (name, stage, fn, image) => checkpoint(name, async () => {
    try { await fn(); } finally { if (image) await shot(image, stage); }
  });
  const uploaded = async (label, filename, bytes, mime) => {
    if (typeof registerFixture !== 'function') fail('UPLOAD_FIXTURE_GUARD_UNAVAILABLE');
    await registerFixture({ filename, bytes, mime });
    const region = page.getByTestId('aidt-research-material-control').filter({ has: page.getByLabel(`${label}选择文件`, { exact: true }) });
    await region.getByLabel(`${label}选择文件`, { exact: true }).setInputFiles({ name: filename, mimeType: mime, buffer: bytes });
    await click(btn('保存原始材料', region));
    await expect(region).toContainText('原件已保存并回读', { timeout: 60000 });
  };
  const completed = async stage => {
    await go();
    await expect(page.getByTestId(`aidt-stage-save-${stage}`)).toContainText('已完成');
    await expect(page.getByTestId(`aidt-stage-save-${stage}`)).toHaveAttribute('data-completed', 'true');
  };
  const state = { s1: false, s2: false, s3: false, s4: false, s5: false, s6: false, interviews: [] };
  let step2Href, step3Href, step4Href, step5Href, step6Href, problemHref, personaHref, designId;
  const problemName = `QA合成选题 ${unique}`;
  const personaName = `QA合成画像 ${unique}`;
  const question = '合成情境中，学生能否从静态队列示意中理解先看等待时间再决定的顺序？';
  const ideaNames = ['QA纸质队列提示', 'QA分时试饮服务', 'QA同伴口味对照'].map(name => `${name} ${unique}`);

  await check('overview', undefined, async () => {
    await go(); await expect(page.getByTestId('aidt-dashboard')).toBeVisible();
    for (let stage = 1; stage <= 6; stage++) await expect(page.getByTestId(`aidt-step-${stage}`)).toBeVisible();
  }, '00-overview');

  await check('s1-draft-not-complete', undefined, async () => {
    await go(1); await fill('问题名称', problemName); await click(btn('新建问题')); await saveStage(1);
    const link = page.getByRole('link', { name: problemName, exact: true });
    problemHref = owned(await link.getAttribute('href')); await link.click(); await output();
    await page.getByTestId('aidt-field-initial').fill(text('想了解校园午休时选择饮品的犹豫。'));
    await saveStage(1); problemHref = page.url();
    await go(); await expect(page.getByTestId('aidt-stage-save-1')).not.toHaveAttribute('data-completed', 'true');
    await expect(page.getByTestId('aidt-stage-save-1')).toContainText('草稿');
  }, '01-problem-draft-overview');

  state.s1 = await check('s1-confirmed-reentry', 1, async () => {
    if (!problemHref) fail('S1_ENTITY_UNAVAILABLE');
    await page.goto(owned(problemHref), { waitUntil: 'domcontentloaded' });
    await page.getByTestId('aidt-problem-reflection-why').fill(text('练习把宽泛命题缩小成可研究的范围。'));
    await page.getByTestId('aidt-problem-source-guess').check();
    await page.getByTestId('aidt-problem-reflection-details').fill(text('仅为本次QA自拟情境，没有真实受访者或课堂证据。'));
    await page.getByTestId('aidt-problem-reflection-uncertainty').fill('是否存在这种犹豫、由何引起仍未知。');
    await persistConfirmed(1, page.getByTestId('aidt-problem-reflection-confirm'));
    await page.getByTestId('aidt-field-rewrittenTheme').fill(text('探索校园午休饮品选择中的情境差异，不预设解决方案。'));
    await reviewAndSave(1, btn('确认本轮成果并保存'));
    // This one existing round control auto-saves; do not race it with a second CAS click.
    await expect(page.getByTestId('aidt-round-completion')).toContainText('本轮成果已确认并保存', { timeout: 30000 });
    step2Href = owned(await page.getByRole('link', { name: '继续第2步', exact: true }).getAttribute('href'));
    await shot('01-problem-confirmed', 1);
    await follow('返回产物列表');
    await completed(1); await page.reload();
    await expect(page.getByTestId('aidt-stage-save-1')).toHaveAttribute('data-completed', 'true');
    await page.goto(owned(problemHref)); await expect(page.getByTestId('aidt-stage-output')).toContainText('方向已确认');
    await expect(page.getByTestId('aidt-stage-output')).toContainText('探索校园午休饮品选择中的情境差异');
  }, '01-problem-reentry');

  state.s2 = await check('s2-interview-handoff', 2, async () => {
    if (!state.s1 || !step2Href) { await go(2); fail('S1_CONFIRMED_HANDOFF_REQUIRED'); }
    const directory = new URL(step2Href); directory.searchParams.delete('entity'); directory.searchParams.delete('tool');
    for (let index = 1; index <= 2; index++) {
      await page.goto(owned(directory.href)); await click(btn('新建访谈')); await saveStage(2);
      const code = `U0${index}`; await click(page.getByRole('button', { name: new RegExp(`^${code}(?:\s|$)`) }));
      await output();
      await fill('想了解什么', text(`核对${code}所代表的合成情境差异。`));
      await fill('学生提纲原稿', '请回忆最近一次做选择的经过？');
      await fill('学生采纳清单', '请描述一次具体经过，哪些信息影响了当时的选择？');
      await persistConfirmed(2, btn('确认此人的问题清单'));
      await page.getByLabel('已获授权共享文字记录', { exact: true }).check(); await click(btn('更新授权记录'));
      const quote = `QA-${code}：我在合成情境${index}中先看队列，再决定是否等待。`;
      await uploaded(`${code}研究原件`, `qa-${unique}-${code}.txt`, Buffer.from(`${SYNTHETIC}。run=${unique}\n第1段 ${quote}\n`), 'text/plain');
      const select = page.getByLabel('转写原件', { exact: true });
      await expect(select.locator('option')).toHaveCount(2); await select.selectOption({ index: 1 });
      await fill('定位（如 01:42 或第 3 段）', '第1段'); await fill('校对后的摘录', quote);
      await page.getByLabel('已对照原始材料校对', { exact: true }).check();
      await page.getByLabel('标题来源', { exact: true }).selectOption('student-summary');
      await fill('一句发现', text(`${code}的合成记录关注等待时间。`));
      await fill('学生记录的可观察情况', text('测试夹具仅包含文字情境，不代表实际观察。'));
      await fill('学生的解释', text('等待与选择可能有关，此解释未验证。'));
      await fill('可定位的受访者原话', quote);
      await persistConfirmed(2, btn('确认人物发现卡'));
      state.interviews.push({ href: page.url(), code });
    }
    await page.goto(owned(directory.href));
    await expect(page.getByRole('button', { name: /^U01/ })).toContainText('发现卡已核对');
    await expect(page.getByRole('button', { name: /^U02/ })).toContainText('发现卡已核对');
    step3Href = owned(await page.getByRole('link', { name: '带入综合与定义', exact: true }).getAttribute('href'));
    await shot('02-interview-directory', 2); await completed(2); await page.goto(owned(directory.href));
  }, '02-empathy');

  await check('s2-distinct-threads', 2, async () => {
    if (state.interviews.length !== 2) fail('TWO_INTERVIEWS_REQUIRED');
    const threadIds = [];
    for (const interview of state.interviews) {
      await page.goto(owned(interview.href)); await expect(page.getByTestId('copilotkit-v2-input')).toBeVisible();
      await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toMatch(/^thr/);
      threadIds.push(new URL(page.url()).searchParams.get('thread'));
    }
    expect(new Set(threadIds).size).toBe(2);
    await page.goto(owned(state.interviews[0].href)); await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(threadIds[0]);
    await page.reload(); await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(threadIds[0]);
    report.independentEntityThreadsVerified = true;
  }, '02-independent-chat');

  state.s3 = await check('s3-definition-hmw-handoff', 3, async () => {
    if (!state.s2 || !step3Href) { await go(3); fail('S2_CONFIRMED_HANDOFF_REQUIRED'); }
    await page.goto(owned(step3Href));
    await page.getByRole('radio', { name: '暂无意外发现', exact: true }).check();
    await persistConfirmed(3, page.getByTestId('aidt-surprise-confirm'));
    await click(btn('新建画像')); await saveStage(3); await follow('未命名画像'); await output();
    await fill('画像名称', personaName); await fill('用户情境', text('午休时的饮品选择合成情境。'));
    await fill('可观察的行为', text('夹具中的人物先看队列。')); await fill('需求', text('了解等待信息，仍需真实研究。'));
    await fill('反例、适用范围或仍未知的地方', '只有QA合成材料，年龄、兴趣与真实行为均未知。');
    await page.getByRole('group', { name: /^关联已确认的人物发现卡/ }).getByRole('checkbox', { name: /^U01/ }).check();
    await persistConfirmed(3, btn('确认画像')); personaHref = page.url();
    await follow('返回产物列表'); await click(btn('新建 HMW')); await saveStage(3); await follow('未命名 HMW'); await output();
    await fill('我们如何……（HMW）', text('我们如何帮助午休赶时间的学生理解等待信息，同时保留不同选择？'));
    await fill('选择理由或待核实处', '来自本次合成发现卡；是否适用于真实学生仍待验证。');
    await page.getByRole('group', { name: '关联已确认画像', exact: true }).getByRole('checkbox', { name: personaName, exact: true }).check();
    await page.getByRole('group', { name: /^关联已确认的人物发现卡/ }).getByRole('checkbox', { name: /^U01/ }).check();
    await persistConfirmed(3, btn('确认 HMW')); await persistConfirmed(3, btn('选为本轮 HMW'));
    await follow('返回产物列表'); step4Href = owned(await page.getByRole('link', { name: '带入创意发散', exact: true }).getAttribute('href'));
    await shot('03-definition-directory', 3); await completed(3); await page.goto(owned(step3Href));
  }, '03-definition');

  state.s4 = await check('s4-three-distinct-descriptions', 4, async () => {
    if (!state.s3 || !step4Href) { await go(4); fail('S3_CONFIRMED_HANDOFF_REQUIRED'); }
    await page.goto(owned(step4Href));
    for (const name of ideaNames) { await fill('点子名称', name); await click(btn('新建点子')); await saveStage(4); }
    await disclosure('分类与描述单');
    const adopt = btn('将此 HMW 用于本轮'); if (await adopt.isVisible()) { await click(adopt); await saveStage(4); }
    for (let index = 1; index <= 3; index++) {
      await page.getByLabel(`候选${index}核心说明`, { exact: true }).fill(`${SYNTHETIC}。用${['纸质等待提示', '分时预约体验', '同伴对照记录'][index-1]}表达不同解决方向，效果仍待真实测试。`);
      await uploaded(`候选${index}原始图片`, `qa-${unique}-idea-${index}.png`, schematicPng(unique, index), 'image/png');
    }
    const categories = ['最容易实现的', '最具突破性的', '最有趣的'];
    for (let index = 0; index < 3; index++) {
      await page.getByLabel(`${ideaNames[index]} · ${categories[index]}`, { exact: true }).check();
      await page.getByLabel(`${ideaNames[index]} · 分类理由`, { exact: true }).fill(text('这是本次QA学生选择，不是AI自动决定。'));
    }
    await persistConfirmed(4, btn('确认本组分类'));
    await page.getByRole('checkbox', { name: '本组已比较：这些是不同点子，说明讲清做什么及如何帮助用户。', exact: true }).check();
    await click(page.getByTestId('aidt-idea-sheets-open'));
    await expect(page.getByTestId('aidt-idea-sheet')).toHaveCount(3);
    for (const name of ideaNames) await expect(page.getByTestId('aidt-idea-sheets-preview')).toContainText(name);
    await persistConfirmed(4, btn('确认本轮描述单'));
    await page.getByRole('group', { name: '带入原型的点子', exact: true }).getByRole('checkbox', { name: ideaNames[0], exact: true }).check();
    await saveStage(4);
    step5Href = owned(await page.getByRole('link', { name: '带入原型制作', exact: true }).getAttribute('href'));
    await shot('04-three-idea-descriptions', 4); await completed(4); await page.goto(owned(step4Href));
    report.threeDistinctDescriptionPreviewsVerified = true;
    report.descriptionPdfBytesVerified = false; // Browser print preview is not a saved PDF receipt.
  }, '04-ideas');

  state.s5 = await check('s5-prototype-question-version', 5, async () => {
    if (!state.s4 || !step5Href) { await go(5); fail('S4_CONFIRMED_HANDOFF_REQUIRED'); }
    if (typeof armDesignGeneration !== 'function' || typeof armDesignCreate !== 'function') fail('BOUNDED_DESIGN_GENERATION_GUARD_REQUIRED');
    await page.goto(owned(step5Href));
    const createDesign = page.getByTestId('project-resources-new'); await expect(createDesign).toBeVisible(); await expect(createDesign).toBeEnabled();
    await armDesignCreate(); await createDesign.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('entity')).toBeTruthy();
    designId = new URL(page.url()).searchParams.get('entity'); const entityHref = page.url(); await output();
    await click(page.getByRole('button', { name: /^采用第 4 步 V\d+ 的 \d+ 个点子$/ }));
    await fill('通过这次制作原型，你最想知道什么？', question);
    await disclosure('补充先前看法与验证范围');
    await fill('测试前，你们怎么想？', text('目前不确定，预计静态图只能检查理解。'));
    await fill('目前看法的依据', text('仅来自QA合成发现卡，不是已验证的研究事实。'));
    await fill('这个原型能了解什么，还有什么不能验证？', '能检查示意顺序的理解，不能证明真实等待、时间投入或付费行为。');
    const fields = page.getByTestId('aidt-prototype-entity-output').getByRole('group', { name: '原型制作说明', exact: true }).getByRole('textbox');
    const descriptions = ['静态界面示意图', '合成校园午休情境', '先看提示再决定', '选择、查看队列、决定等待', '解释等待信息与操作顺序'];
    for (let index = 0; index < await fields.count(); index++) await fields.nth(index).fill(text(descriptions[index] ?? '表达当前验证范围。'));
    await persistConfirmed(5, btn('确认本轮验证问题'));
    await follow('打开原生 Design Workbench');
    await expect(page.getByTestId('design-detail-input')).toBeEditable();
    await page.getByTestId('design-detail-input').fill(`${SYNTHETIC}。QA run=${scope.runId}。请生成一页静态校园饮品队列提示界面，标题明确QA合成演示；展示预计等待时间、查看口味、决定是否排队三个区块。只用于检查理解，不宣称有真实研究或用户认可。`);
    const send = page.getByTestId('design-detail-send'); await expect(send).toBeEnabled(); await armDesignGeneration();
    const generated = page.waitForResponse(response => new URL(response.url()).pathname === `/api/pm-designs/${encodeURIComponent(designId)}/chat` && response.request().method() === 'POST', { timeout: 930000 });
    await send.click(); const generationReceipt = await generated;
    if (!generationReceipt.ok()) fail('DESIGN_GENERATION_NOT_SUCCESSFUL');
    // The actual version picker below must verify generated frames; an HTTP response alone is insufficient.
    await expect(send).toBeEnabled({ timeout: 930000 });
    await page.goto(owned(entityHref)); await output();
    const picker = page.getByTestId('aidt-prototype-version-picker'); await click(btn('选择真实原型版本', picker));
    await click(picker.locator('[aria-label="已关联的设计"]').getByRole('button', { name: '未命名设计', exact: true }));
    await click(picker.getByRole('button', { name: /^选择 v\d+：/ }).first());
    await expect(page.getByTestId('aidt-prototype-recorded-reference')).toContainText(/已生成 [1-9]\d*\//);
    await persistConfirmed(5, btn('确认所选原型'));
    step6Href = owned(await page.getByRole('link', { name: '带入测试与迭代', exact: true }).getAttribute('href'));
    await shot('05-prototype-question-version', 5); await completed(5); await page.goto(owned(entityHref)); await output();
    report.realDesignGenerationAndVersionVerified = true;
  }, '05-prototype');

  state.s6 = await check('s6-test-reflection', 6, async () => {
    if (!state.s5 || !step6Href) { await go(6); fail('S5_REAL_VERSION_HANDOFF_REQUIRED'); }
    await page.goto(owned(step6Href)); await fill('测试名称', `QA合成测试 ${unique}`); await click(btn('新建测试草稿'));
    // Directory saves are normal non-confirming UI actions, not a seeded test entity.
    await saveStage(6, btn('保存测试列表'));
    const reflection = page.getByTestId('aidt-test-reflection'); await expect(reflection).toBeVisible();
    await expect(reflection.getByTestId('aidt-bound-question')).toContainText(question);
    await reflection.getByLabel('测试之后，对这个问题的认识有什么变化？', { exact: true }).selectOption('insufficient');
    await fill('测试后的认识', text('本次只有合成软件验收，没有真实对象测试，不能判断方案效果。'), reflection);
    await fill('支持判断的测试材料', 'QA合成记录；未采集真实用户行为。', reflection);
    await fill('仍不确定的地方', '需要真实对象理解反馈及实际情境观察，当前证据不足。', reflection);
    await reflection.getByLabel('如果继续改进，优先从哪一步重新入手？', { exact: true }).selectOption('2');
    await fill('为什么从这里重新入手？', '需要真实访谈，不能用QA合成夹具支持效果判断。', reflection);
    await fill('下一步具体做什么？', '取得适当授权后补充真实访谈，再回看原问题；本次不生成新版。', reflection);
    await persistConfirmed(6, btn('确认本轮学习记录', reflection), btn('保存本轮测试与反思'));
    await page.reload(); await expect(page.getByTestId('aidt-test-reflection')).toContainText('本轮学习记录已确认');
    await shot('06-reflection-insufficient-return-empathy', 6); await completed(6); await page.goto(owned(step6Href));
    report.insufficientEvidenceAndReturnWithoutNewPrototypeVerified = true;
  }, '06-reflection');

  await check('report-confirmed-source-export', 6, async () => {
    if (!state.s6) { await go(6, '&summary=1'); fail('S6_REFLECTION_REQUIRED'); }
    if (typeof saveReport !== 'function') fail('REPORT_NORMAL_SAVE_GUARD_REQUIRED');
    await go(6, '&summary=1');
    const open = page.getByRole('link', { name: '打开小组研究报告', exact: true }); if (await open.isVisible()) await follow('打开小组研究报告');
    const reportUrl = new URL(page.url()); reportUrl.searchParams.set('tool', 'report');
    await page.goto(owned(reportUrl.href), { waitUntil: 'domcontentloaded' });
    const reportRegion = page.getByTestId('aidt-report-preview'); await expect(reportRegion).toBeVisible();
    await click(btn('编辑报告', reportRegion));
    const draft = reportRegion.getByLabel('小组报告草稿', { exact: true });
    const initial = await draft.inputValue(); expect(initial).toContain('合成');
    await draft.fill(`${initial}\n\n## QA验收边界\n${SYNTHETIC}。本次验证软件流程与来源追溯，没有进行真实课堂或真实访谈，方案效果尚待验证。\n`);
    await disclosure('选择报告引用的阶段版本');
    for (let stage = 1; stage <= 6; stage++) {
      const sourceSelect = reportRegion.locator('label').filter({ has: page.locator('span').filter({ hasText: new RegExp(`^第 ${stage} 步$`) }) }).locator('select');
      await expect(sourceSelect).toBeEnabled(); await sourceSelect.selectOption({ index: 1 });
    }
    await saveReport(); await click(btn('阅读预览', reportRegion)); await click(btn('确认审阅此版本', reportRegion));
    await reviewAndSave(6, btn('确认小组报告', reportRegion));
    await expect(page.getByTestId('aidt-report-save-state')).toContainText('已确认');
    await disclosure('已确认版本与导出');
    const readVersion = page.getByRole('button', { name: /^查看确认版 V\d+$/ }); await click(readVersion);
    await expect(page.getByRole('article', { name: '已确认报告正文', exact: true })).toContainText(SYNTHETIC);
    const sources = page.getByRole('list', { name: '确认版本来源', exact: true }); await expect(sources).toBeVisible();
    for (let stage = 1; stage <= 6; stage++) await expect(sources).toContainText(`第 ${stage} 步`);
    const downloadEvent = page.waitForEvent('download'); await click(page.getByRole('button', { name: /^下载 V\d+ Markdown$/ }));
    const download = await downloadEvent;
    if (typeof saveDownload !== 'function') fail('REPORT_SAFE_DOWNLOAD_STORAGE_REQUIRED');
    await saveDownload(download);
    if (await download.failure()) fail('REPORT_DOWNLOAD_FAILED');
    const stream = await download.createReadStream(); if (!stream) fail('REPORT_DOWNLOAD_UNREADABLE');
    let bytes = 0; const chunks = []; for await (const chunk of stream) { bytes += chunk.length; if (bytes > 1000000) fail('REPORT_DOWNLOAD_TOO_LARGE'); chunks.push(chunk); }
    const content = Buffer.concat(chunks); expect(content.toString('utf8')).toContain(SYNTHETIC);
    report.confirmedReportExport = { bytes, sha256: createHash('sha256').update(content).digest('hex'), format: 'markdown' };
    const sourceButton = sources.getByRole('button', { name: /第 1 步/ }).first(); await click(sourceButton);
    await expect(page.locator('[aria-label="来源版本详情"]')).toBeVisible();
  }, '07-confirmed-report');

  await check('six-stage-completion', undefined, async () => {
    if (![state.s1,state.s2,state.s3,state.s4,state.s5,state.s6].every(Boolean)) fail('SIX_NORMAL_UI_HANDOFFS_REQUIRED');
    await go(); await page.reload();
    for (let stage = 1; stage <= 6; stage++) await expect(page.getByTestId(`aidt-stage-save-${stage}`)).toHaveAttribute('data-completed', 'true');
    report.sixStageCompletionSurvivesReload = true;
  }, '08-completed-overview');

  await checkpoint('anonymous-access-boundary', async () => {
    if (typeof createAnonymousPage !== 'function') fail('ANONYMOUS_GUARD_UNAVAILABLE');
    const anon = await createAnonymousPage();
    try {
      await anon.page.goto(`${origin}${root}`, { waitUntil: 'domcontentloaded' });
      await expect(anon.page.getByTestId('aidt-shared-save')).toHaveCount(0);
      await expect(anon.page.getByTestId('aidt-dashboard')).toHaveCount(0);
      await expect(anon.page.getByText(scope.projectName, { exact: true })).toHaveCount(0);
      await expect.poll(async () => /\/login(?:\/|$)/.test(new URL(anon.page.url()).pathname) || await anon.page.getByText(/登录后|请先登录|登录以/).count() > 0).toBe(true);
      report.anonymousBoundaryVerified = true;
    } finally { await anon.close(); }
  });
  // No second authenticated actor was used; anonymous access is not a cross-user matrix.
  report.crossUserIsolationVerified = false;
}
