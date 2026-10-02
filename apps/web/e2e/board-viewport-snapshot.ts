import type { Page } from '@playwright/test';

/** Read the transient ACK banner and all viewport bounds in one browser turn. */
export async function readBoardViewportSnapshot(page: Page) {
  return page.evaluate(() => {
    const rect = (element: Element | null) => element ? element.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number } : null;
    const region = document.querySelector('[data-testid="board-editor-region"]');
    const banner = document.querySelector('[data-testid="board-sync-banner"]');
    const bannerVisible = banner && banner.getClientRects().length > 0 && getComputedStyle(banner).visibility !== 'hidden';
    return {
      bounds: rect(document.querySelector('[data-testid="board-fabric-surface"]')),
      shellBounds: rect(region?.parentElement ?? null),
      regionBounds: rect(region),
      bannerBounds: bannerVisible ? rect(banner) : null,
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
}
