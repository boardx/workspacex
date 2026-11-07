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

/** Wait for the page's committed role, not only a successful out-of-band API write. */
export async function assertRoomPresentation(page:Page,state:{boardId:string;roomId:string;revision:number;presenterId:string|null;followers:string[]},actorId:string) {
  const region=page.getByTestId('board-editor-region');
  await expect(region).toHaveAttribute('data-presentation-board',state.boardId);
  await expect(region).toHaveAttribute('data-presentation-room',state.roomId);
  await expect(region).toHaveAttribute('data-presentation-actor',actorId);
  await expect.poll(async()=>Number(await region.getAttribute('data-presentation-revision'))).toBeGreaterThanOrEqual(state.revision);
  await expect(region).toHaveAttribute('data-presentation-presenter',state.presenterId??'');
  await expect(region).toHaveAttribute('data-presentation-following',String(state.followers.includes(actorId)));
}
