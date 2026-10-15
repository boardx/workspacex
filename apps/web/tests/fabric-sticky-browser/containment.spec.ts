import { test, expect } from '@playwright/test';

test('real Fabric contains dense CJK and mixed labels after editing and JSON restore', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const results = JSON.parse(await page.locator('#results').innerText()) as Array<{
    id: string; labelIntact: boolean; contained: boolean; fontSize: number; scale: number;
    cardBounds: { left: number; top: number; width: number; height: number };
    textBounds: { left: number; top: number; width: number; height: number };
  }>;
  expect(results).toHaveLength(2);
  expect(errors).toEqual([]);
  for (const result of results) {
    expect(result.labelIntact).toBe(true);
    expect(result.contained).toBe(true);
    expect(result.fontSize).toBe(7);
    expect(result.scale).toBeGreaterThan(0);
    expect(result.scale).toBeLessThan(1);
    expect(result.textBounds.left).toBeGreaterThanOrEqual(result.cardBounds.left - 0.1);
    expect(result.textBounds.top).toBeGreaterThanOrEqual(result.cardBounds.top - 0.1);
    expect(result.textBounds.left + result.textBounds.width).toBeLessThanOrEqual(result.cardBounds.left + result.cardBounds.width + 0.1);
    expect(result.textBounds.top + result.textBounds.height).toBeLessThanOrEqual(result.cardBounds.top + result.cardBounds.height + 0.1);
  }
  await expect(page.locator('body')).toHaveAttribute('data-passed', 'true');
  await testInfo.attach('real-fabric-bounds', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  const screenshot = testInfo.outputPath('long-sticky-contained.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('long-sticky-contained', { path: screenshot, contentType: 'image/png' });
});
