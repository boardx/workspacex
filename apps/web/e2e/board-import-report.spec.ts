import { expect, test } from '@playwright/test';

test('Miro Mural import report', async ({ page }) => {
  await page.goto('/studio/board');
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
  await expect(page.getByText(/Miro|Mural|导入/).first()).toBeVisible();
});
