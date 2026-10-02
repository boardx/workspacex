import {expect,type Page} from '@playwright/test';
/** Exact acknowledged state, optionally including the server's last ACK sequence. */
export const BOARD_SYNCED_STATUS = /^已同步(?: · 序列 \d+)?$/;

/** Icon presentation is separate from the real acknowledged provider state. */
export async function expectBoardSynced(page:Page,timeout?:number,allowReadOnly=false){
 const status=page.getByTestId('board-sync-status');
 await expect(status).toBeVisible({timeout});
 await expect(status.locator('svg')).toBeVisible({timeout});
 await expect(status).toHaveAttribute('data-sync-phase','synced',{timeout});
 await expect(status).toHaveAttribute('aria-label',allowReadOnly?/^已同步(?: · 序列 \d+)?(?: · 只读)?$/:BOARD_SYNCED_STATUS,{timeout});
}
