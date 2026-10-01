import {expect,type Page} from '@playwright/test';
/** Follow the real responsive header; never force a click on hidden controls. */
export async function roomControls(page:Page) {
  const controls=page.getByTestId('board-presentation-controls');
  if (!await controls.isVisible()) {
    await page.getByRole('button',{name:'更多白板操作',exact:true}).click();
  }
  await expect(controls).toBeVisible();return controls;
}
export async function roomAction(page:Page,name:string) {
  await (await roomControls(page)).getByRole('button',{name,exact:true}).click();
  const close=page.getByRole('button',{name:'关闭白板操作',exact:true});
  if(await close.isVisible()) await close.click();
}
export async function roomZoom(page:Page,direction:'in'|'out') {
  await page.getByTestId('board-zoom-menu').click();
  await page.getByTestId(`board-zoom-${direction}`).click();
}
