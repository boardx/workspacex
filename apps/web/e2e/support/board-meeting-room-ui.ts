import {expect,type Page} from '@playwright/test';
/** Playback entry is intentionally hidden (#5684); protocol setup must not restore it. */
export async function assertRoomChrome(page:Page) {
  await expect(page.getByTestId('board-presentation-controls')).toHaveCount(0);
  for (const name of ['开始演示','结束演示','交给会议室','跟随演示者','自由浏览']) {
    await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
  }
  await expect(page.getByTestId('board-fabric-surface').locator('canvas.upper-canvas')).toBeVisible();
}
export async function roomZoom(page:Page,direction:'in'|'out') {
  await page.getByTestId('board-zoom-menu').click();
  await page.getByTestId(`board-zoom-${direction}`).click();
}
