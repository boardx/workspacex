// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rect, Textbox, cache } from 'fabric';
import { FlowNode } from '@repo/fabric-markdown';

// node-canvas cannot measure the browser system-ui font stack. Keep the real
// Fabric layout, with explicit CJK/Latin measurements; Chromium is a separate check.
type Context = CanvasRenderingContext2D & { fontDeclaration?: string };
const proto = Object.getPrototypeOf(document.createElement('canvas').getContext('2d')!) as Context;
const font = Object.getOwnPropertyDescriptor(proto, 'font')!;
const measure = proto.measureText;
beforeAll(() => {
  Object.defineProperty(proto, 'font', {
    configurable: true,
    get(this: Context) { return this.fontDeclaration ?? font.get!.call(this); },
    set(this: Context, value: string) { this.fontDeclaration = value; },
  });
  proto.measureText = function (this: Context, value: string) {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.fontDeclaration ?? '')?.[1] ?? 10);
    return { width: [...value].reduce((n, c) => n + size * (/[\u2e80-\u9fff]/.test(c) ? 1 : 0.55), 0) } as TextMetrics;
  };
  cache.clearFontCache();
});
afterAll(() => {
  Object.defineProperty(proto, 'font', font);
  proto.measureText = measure;
  cache.clearFontCache();
});
const chinese = '学校AI俱乐部定期聚会与线上协作工具，基于研究报告描述用户画像中的行为与痛点。'.repeat(12);
const mixed = 'Youth AI Challenge / AI for Good 挑战赛报名与提交平台（来源：研究报告第六章，用户画像行为分区）\n'.repeat(16);
function node(label: string) {
  return new FlowNode({ nodeId: 'long-sticky', shape: 'sticky', label, x: 200, y: 180, width: 130, height: 85 });
}
function contained(sticky: FlowNode, label: string) {
  const card = sticky.getObjects().find(o => o instanceof Rect) as Rect;
  const text = sticky.getObjects().find(o => o instanceof Textbox) as Textbox;
  expect(text.text).toBe(label);
  expect(sticky.label).toBe(label);
  expect(text.getScaledHeight()).toBeLessThanOrEqual(card.height - 12 + 0.001);
  expect(text.getScaledWidth()).toBeLessThanOrEqual(card.width - 12 + 0.001);
  expect(sticky.height).toBeCloseTo(card.getScaledHeight(), 6);
  expect(sticky.width).toBeCloseTo(card.getScaledWidth(), 6);
  expect(text.scaleX).toBe(text.scaleY);
  return text;
}
describe('Chat fixed sticky text containment (#5688)', () => {
  it.each([chinese, mixed])('contains the complete dense label at creation', label => {
    const text = contained(node(label), label);
    expect(text.fontSize).toBe(7);
    expect(text.scaleY).toBeLessThan(1);
  });
  it('refits long edits, then restores normal size for a short edit', () => {
    const sticky = node('短文字');
    sticky.setLabel(mixed);
    contained(sticky, mixed);
    sticky.setLabel('恢复');
    const text = contained(sticky, '恢复');
    expect(text.fontSize).toBe(13);
    expect(text.scaleX).toBe(1);
  });
  it('restores exact text and fixed card geometry through JSON', async () => {
    const sticky = node(chinese);
    let restored = sticky;
    for (let round = 0; round < 3; round += 1) {
      restored = await FlowNode.fromObject(restored.toObject());
      contained(restored, chinese);
      const card = restored.getObjects().find(o => o instanceof Rect) as Rect;
      expect(card.width).toBe(130);
      expect(card.height).toBe(85);
      expect(restored.width).toBe(sticky.width);
      expect(restored.height).toBe(sticky.height);
      expect(restored.left).toBe(sticky.left);
      expect(restored.top).toBe(sticky.top);
    }
  });
});
