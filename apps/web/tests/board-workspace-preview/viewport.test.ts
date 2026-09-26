import { expect, it } from 'vitest';
import { previewViewport } from '@/components/board-workspace-preview/viewport';
it.each([[375, 667], [515, 760], [768, 1024], [1280, 800]])('fits the sample between header and dock at %sx%s', (width, height) => {
 const [z, , , , x, y] = previewViewport(width, height);
 expect(100 * z + x).toBeGreaterThanOrEqual(24 - 0.01);
 expect(595 * z + x).toBeLessThanOrEqual(width - 24 + 0.01);
 expect(130 * z + y).toBeGreaterThanOrEqual(104 - 0.01);
 expect(400 * z + y).toBeLessThanOrEqual(height - Math.min(220, height * 0.35) + 0.01);
});

import { Rect, Textbox } from 'fabric';
import { documentBounds } from '@/components/board-workspace-preview/viewport';
it('fits actual Fabric 7 bounds, including center-origin objects', () => {
 const objects = [new Rect({ left: 100, top: 130, width: 210, height: 190 }), new Rect({ left: 385, top: 210, width: 210, height: 190 })];
 const bounds = documentBounds(objects.map(object => object.getBoundingRect()));
 const [z, , , , x, y] = previewViewport(515, 931, bounds);
 for (const object of objects) { const b = object.getBoundingRect(); expect(b.left * z + x).toBeGreaterThanOrEqual(23.99); expect((b.left + b.width) * z + x).toBeLessThanOrEqual(491.01); expect(b.top * z + y).toBeGreaterThanOrEqual(103.99); }
});
