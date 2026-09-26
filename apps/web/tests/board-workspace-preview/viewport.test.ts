import { expect, it } from 'vitest';
import { previewViewport } from '@/components/board-workspace-preview/viewport';
it.each([[375, 667], [515, 760], [768, 1024], [1280, 800]])('fits the sample between header and dock at %sx%s', (width, height) => {
 const [z, , , , x, y] = previewViewport(width, height);
 expect(100 * z + x).toBeGreaterThanOrEqual(24 - 0.01);
 expect(595 * z + x).toBeLessThanOrEqual(width - 24 + 0.01);
 expect(130 * z + y).toBeGreaterThanOrEqual(104 - 0.01);
 expect(400 * z + y).toBeLessThanOrEqual(height - Math.min(220, height * 0.35) + 0.01);
});
