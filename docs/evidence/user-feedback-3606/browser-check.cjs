const { chromium } = require('../../../apps/web/node_modules/@playwright/test');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('wsx.sessionToken', 'ui-fixture');
      localStorage.setItem('wsx.session', JSON.stringify({ version: 1, userId: 'fixture-user', orgs: ['fixture-org'], currentOrgId: 'fixture-org', expiresAt: new Date(Date.now() + 3600000).toISOString() }));
    });
    await page.route('**/identity/me*', r => r.fulfill({ json: { org: { id: 'fixture-org', name: 'Workspace', kind: 'organization' }, orgRole: 'member', teamId: null, projectRole: null, groupId: null, displayName: 'UI Review', avatarUrl: null } }));
    await page.route('**/projects?orgId=*', r => r.fulfill({ json: [] }));
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('http://localhost:3606/studio/agents');
      await page.getByTestId('agents-home-page').waitFor({ timeout: 120000 });
      for (const index of [1, 2]) {
        const card = page.getByTestId(`agent-preview-${index}`);
        const link = card.getByRole('link', { name: '查看项目', exact: true });
        assert.equal(await link.getAttribute('href'), '/projects');
        await link.scrollIntoViewIfNeeded();
        const bounds = await link.boundingBox();
        assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
        assert.equal(await card.evaluate(e => e.scrollWidth <= e.clientWidth), true);
        // Start before all focusable elements, then reach the link using only Tab.
        await page.evaluate(() => { document.activeElement?.blur(); document.body.tabIndex = -1; document.body.focus(); });
        let reached = false;
        for (let step = 0; step < 60; step++) {
          await page.keyboard.press('Tab');
          if (await link.evaluate(e => e === document.activeElement)) { reached = true; break; }
        }
        assert(reached, `card ${index} reachable with Tab`);
        await page.keyboard.press('Enter');
        await page.waitForURL('**/projects', { timeout: 120000 });
        await page.getByTestId('projects-screen').waitFor({ timeout: 120000 });
        await page.goBack();
        await page.waitForURL('**/studio/agents');
        await page.getByTestId('agents-home-page').waitFor();
      }
      assert.equal(await page.getByTestId('agents-home-page').evaluate(e => e.scrollWidth <= e.clientWidth), true);
      await page.screenshot({ path: `docs/evidence/user-feedback-3606/agents-${width}.png`, fullPage: true });
      console.log(`${width}px: both card links, Tab+Enter, project page, browser back, no overflow PASS`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
