/**
 * Footer / attribution line of the template engine (workspacex issue #2527).
 *
 * The template editor lets a human type a "页脚署名"; the editor preview
 * painted it but `TemplateSpec` had no slot for it, so the real canvas never
 * showed it. The spec now carries `footer` and the engine draws it under the
 * lowest section box.
 */
import { describe, expect, it } from 'vitest';
import { registerTemplate, templateToModel } from '../src/templates-entry';

const SECTIONS = [
  { name: '上', x: 820, y: 300, w: 1520, h: 200 },
  { name: '下', x: 820, y: 700, w: 1520, h: 200 },
];

describe('template engine — footer line', () => {
  it('draws a locked footer text node under the lowest section when spec.footer is set', () => {
    registerTemplate({ key: 'ft-on', title: '有页脚', footer: '本工具基于 XXX', sections: SECTIONS });
    const model = templateToModel('模板: ft-on\n## 上\n- a\n## 下\n- b');
    const footer = model.nodes.find((n) => n.data?.role === 'footer');
    expect(footer).toBeDefined();
    expect(footer!.label).toBe('本工具基于 XXX');
    expect(footer!.data?.locked).toBe(true);
    // Below every box: top edge of the footer is past the lowest box bottom (700 + 100).
    expect(footer!.y - footer!.height / 2).toBeGreaterThanOrEqual(800);
    // Left edge lines up with the title (x = 60).
    expect(footer!.x - footer!.width / 2).toBe(60);
  });

  it('no footer node when spec.footer is empty / whitespace / unset (pre-#2527 output unchanged)', () => {
    registerTemplate({ key: 'ft-off', title: '无页脚', sections: SECTIONS });
    registerTemplate({ key: 'ft-blank', title: '空白页脚', footer: '   ', sections: SECTIONS });
    for (const key of ['ft-off', 'ft-blank']) {
      const model = templateToModel(`模板: ${key}\n## 上\n- a`);
      expect(model.nodes.find((n) => n.data?.role === 'footer')).toBeUndefined();
    }
  });
});
