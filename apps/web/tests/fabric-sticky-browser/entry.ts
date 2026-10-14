/** Root-run real Chromium fixture: bundle with esbuild, serve index.html locally. */
import { StaticCanvas, Rect, Textbox } from 'fabric';
import { FlowNode } from '@repo/fabric-markdown';
const canvas = new StaticCanvas('sticky-canvas', { width: 900, height: 380, backgroundColor: '#ffffff' });
const labels = [
  '学校AI俱乐部定期聚会与线上协作工具，基于研究报告描述用户画像中的行为与痛点。'.repeat(12),
  'Youth AI Challenge / AI for Good 挑战赛报名与提交平台（来源：研究报告第六章，用户画像行为分区）\n'.repeat(16),
] as const;
async function run() {
  await document.fonts.ready;
  const nodes = labels.map((label, index) => new FlowNode({ nodeId: `sticky-${index}`, shape: 'sticky', label, x: 180 + index * 400, y: 160, width: 130, height: 85 }));
  const first = nodes[0]!;
  const second = nodes[1]!;
  canvas.add(...nodes);
  first.setLabel(labels[1]);
  first.setLabel(labels[0]);
  const restored = await FlowNode.fromObject(second.toObject());
  canvas.remove(second);
  canvas.add(restored);
  canvas.renderAll();
  const results = [first, restored].map((node, index) => {
    const card = node.getObjects().find(o => o instanceof Rect) as Rect;
    const text = node.getObjects().find(o => o instanceof Textbox) as Textbox;
    const cardBounds = card.getBoundingRect(), textBounds = text.getBoundingRect();
    const epsilon = 0.1;
    return {
      id: node.nodeId, labelIntact: node.label === labels[index] && text.text === labels[index],
      contained: textBounds.left >= cardBounds.left - epsilon && textBounds.top >= cardBounds.top - epsilon && textBounds.left + textBounds.width <= cardBounds.left + cardBounds.width + epsilon && textBounds.top + textBounds.height <= cardBounds.top + cardBounds.height + epsilon,
      fontSize: text.fontSize, scale: text.scaleY, cardBounds, textBounds,
    };
  });
  document.getElementById('results')!.textContent = JSON.stringify(results);
  document.body.dataset.ready = 'true';
  document.body.dataset.passed = String(results.every(result => result.contained && result.labelIntact));
}
void run();
