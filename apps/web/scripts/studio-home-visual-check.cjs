// Real browser layout/interaction check with explicit API fixtures; DB behavior is
// independently covered by the API integration suites in issue #3345.
const { chromium, expect: baseExpect } = require('@playwright/test');
const expect = baseExpect.configure({ timeout: 60000 });
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const output = path.resolve(process.env.STUDIO_SCREENSHOTS || '../../docs/evidence/studio-home-3345');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem('wsx.sessionToken', 'studio-browser-fixture');
      localStorage.setItem('wsx.session', JSON.stringify({ version: 1, userId: 'studio-owner', orgs: ['studio-org'], currentOrgId: 'studio-org', expiresAt: '2099-01-01T00:00:00.000Z' }));
    });
    const date = '2026-09-10T09:00:00.000Z';
    const brief = { topic: '欧洲储能市场', goal: '比较市场需求、政策与客户决策，形成可执行的市场进入建议。', timeRange: '未来三年', region: '欧洲', focus: '储能' };
    let research = [0, 1, 2].map(i => ({ sessionId: `research-${i}`, title: ['欧洲储能市场进入策略', '客户需求研究', '行业趋势分析'][i], tags: [i ? '市场' : '储能'], brief, stage: 'brief', resumeStage: 'brief', status: i === 2 ? 'completed' : 'active', progress: i === 2 ? 100 : 20, sourceCount: i * 3, reportId: null, createdAt: date, updatedAt: date }));
    let interviews = [0, 1, 2].map(i => ({ interviewId: `interview-${i}`, kind: 'batch', name: ['欧洲采购决策访谈', '客户需求访谈', '行业专家访谈'][i], tags: [i ? '市场' : '储能'], topic: brief.goal, status: 'completed', expertCount: 3, completedExpertCount: 3, primaryAction: 'view_report', updatedAt: date, canManage: true }));
    let recordings = [0, 1, 2].map(i => ({ sessionId: `recording-${i}`, name: ['欧洲采购会议', '客户需求讨论', '行业专家录音'][i], tags: [i ? '市场' : '储能'], status: 'idle', durationMs: 120000, createdAt: date, updatedAt: date }));
    await context.route('http://localhost:3200/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      const body = () => request.postDataJSON();
      const respond = value => route.fulfill({ status: 200, json: value });
      if (url.pathname === '/identity/me') return respond({ org: { id: 'studio-org', name: 'Studio 验证组织', kind: 'enterprise', team: null, avatarUrl: null }, orgRole: 'lead', projectRole: null, teamId: null, groupId: null, displayName: '研究员', avatarUrl: null });
      if (url.pathname === '/research/guided-sessions') return respond({ items: research });
      if (url.pathname.startsWith('/research/guided-sessions/')) {
        const id = url.pathname.split('/')[3];
        if (method === 'DELETE') { research = research.filter(item => item.sessionId !== id); return respond({ archived: true }); }
        research = research.map(item => item.sessionId === id ? { ...item, title: body().title, tags: body().tags } : item);
        return respond(research.find(item => item.sessionId === id));
      }
      if (url.pathname === '/interviews/digital') return respond({ items: interviews });
      if (url.pathname.startsWith('/interviews/digital/')) {
        const id = url.pathname.split('/')[3];
        if (method === 'DELETE') { interviews = interviews.filter(item => item.interviewId !== id); return respond({ interviewId: id, archived: true }); }
        interviews = interviews.map(item => item.interviewId === id ? { ...item, name: body().name, tags: body().tags } : item);
        const item = interviews.find(item => item.interviewId === id);
        return respond({ interviewId: id, name: item.name, tags: item.tags });
      }
      if (url.pathname === '/recording/realtime-asr/tags') return respond({ tags: [...new Set(recordings.flatMap(item => item.tags))] });
      if (url.pathname === '/recording/realtime-asr/sessions') return respond({ items: recordings.filter(item => (!url.searchParams.get('tag') || item.tags.includes(url.searchParams.get('tag'))) && (!url.searchParams.get('query') || item.name.includes(url.searchParams.get('query')))), nextCursor: null });
      if (url.pathname.startsWith('/recording/realtime-asr/sessions/')) {
        const id = url.pathname.split('/')[4];
        if (method === 'DELETE') { recordings = recordings.filter(item => item.sessionId !== id); return respond({ deleted: true }); }
        recordings = recordings.map(item => item.sessionId === id ? { ...item, ...body() } : item);
        return respond(recordings.find(item => item.sessionId === id));
      }
      return respond({ items: [], organizations: [] });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on("pageerror", error => console.log("browser error:", error.message));
    page.on("requestfailed", request => console.log("request failed:", request.url(), request.failure()?.errorText));
    const screens = [
      { route: 'rec', prefix: 'rec', home: 'rec-history-page', card: 'rec-history-card-recording-0', more: 'rec-history-more-recording-0', edit: 'rec-history-edit-recording-0', remove: 'rec-history-delete-recording-0' },
      { route: 'research', prefix: 'research', home: 'research-home-page', card: 'research-history-research-0', more: 'research-history-actions-research-0', edit: 'research-history-edit-research-0', remove: 'research-history-delete-research-0' },
      { route: 'itv', prefix: 'itv', home: 'itv-home-page', card: 'itv-history-card-interview-0', more: 'itv-history-actions-interview-0', edit: 'itv-history-edit-interview-0', remove: 'itv-history-delete-interview-0' },
    ];
    const selectedRoutes = process.env.STUDIO_ROUTES?.split(",");
    const selectedScreens = screens.filter(screen => !selectedRoutes || selectedRoutes.includes(screen.route));
    if (!selectedScreens.length || selectedRoutes?.some(route => !screens.some(screen => screen.route === route))) throw new Error("STUDIO_ROUTES must contain rec, research, or itv");
    for (const screen of selectedScreens) {
      console.log(`checking ${screen.route}`);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${process.env.STUDIO_BASE_URL || 'http://localhost:3187'}/${screen.route}`, { timeout: 240000, waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId(screen.card)).toBeVisible();
      for (const width of [1440, 768, 375]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: path.join(output, `${screen.route}-${width}.png`), fullPage: true });
      }
      await page.getByTestId(`${screen.prefix}-history-tag-储能`).click();
      await page.getByTestId(screen.more).click();
      await page.getByTestId(screen.edit).click();
      await page.getByTestId(`${screen.prefix}-edit-name`).fill('整理后的记录');
      await page.getByTestId(`${screen.prefix}-edit-tags`).fill('已整理');
      await page.screenshot({ path: path.join(output, `${screen.route}-edit-mobile.png`), fullPage: true });
      await page.getByTestId(`${screen.prefix}-edit-submit`).click();
      await expect(page.getByTestId(`${screen.prefix}-edit-dialog`)).toHaveCount(0);
      await expect(page.getByTestId(`${screen.prefix}-history-tag-储能`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId(screen.card)).toContainText('已整理');
      await page.reload();
      await expect(page.getByTestId(screen.card)).toContainText('整理后的记录');
      await page.getByTestId(screen.more).click();
      await page.getByTestId(screen.remove).click();
      await page.getByTestId(`${screen.prefix}-delete-dialog`).getByRole('button', { name: '取消', exact: true }).click();
      await expect(page.getByTestId(screen.card)).toBeVisible();
      await page.getByTestId(screen.more).click();
      await page.getByTestId(screen.remove).click();
      await page.getByTestId(`${screen.prefix}-delete-confirm`).click();
      await expect(page.getByTestId(screen.card)).toHaveCount(0);
      console.log(`${screen.route}: three viewport checks, edit, refresh, filter retention, cancel and delete passed`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
