import { expect, type Page } from '@playwright/test';
import { BOARD_SYNCED_STATUS } from './board-sync-status';

export function historyAckPattern(kind: '撤销' | '重做') {
  return new RegExp(`^${kind}已由服务器确认 · 序列 [1-9]\\d*$`);
}

/** Require the gesture-specific server receipt, never the optimistic local notice. */
export async function applyAcknowledgedHistory(page: Page, kind: '撤销' | '重做') {
  await page.getByRole('button', { name: kind, exact: true }).click();
  await expect(page.getByText(historyAckPattern(kind))).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(BOARD_SYNCED_STATUS)).toBeVisible({ timeout: 30_000 });
}

/** Canonical model projection: identity, geometry, text, hierarchy and relationships. */
export async function readBoardProjection(page: Page) {
  return page.getByTestId('board-a11y-mirror').locator('[data-object-id]').evaluateAll(elements => elements.map(element => ({
    id: element.getAttribute('data-object-id'),
    kind: element.getAttribute('data-object-kind'),
    geometry: JSON.parse(element.getAttribute('data-geometry')!),
    parentId: element.getAttribute('data-parent-id'),
    zIndex: element.getAttribute('data-z-index'),
    text: element.querySelector('button')?.getAttribute('aria-label'),
    from: element.getAttribute('data-connector-from'), to: element.getAttribute('data-connector-to'),
    start: element.getAttribute('data-connector-start'), end: element.getAttribute('data-connector-end'),
  })).sort((a, b) => (a.id ?? '').localeCompare(b.id ?? '')));
}
