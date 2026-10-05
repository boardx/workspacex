import { describe, expect, it } from 'vitest';
import { listTemplates, parseTemplateText, templateToModel, serializeTemplate, registerTemplate } from '../src/templates-entry';
import { normalizeTemplateSectionHeading } from '../src/diagrams/template-section-headings';

const ADLIB = `模板: adlib
我们的:
- 构建高校动画教育AI伦理实践指南（推理）
- 开发AI辅助动态叙事课程（推理）
帮助：
- 帮助学生建立人机协同创作决策力（推理）
想要实现:
- 实现动画课程转向叙事思维培养（推理）
减少或避免：
- 减少学生因AI依赖导致的手绘基础弱化（推理）
提升或赋能:
- 提升教师课程设计能力（推理）
竞争对手价值主张：
- 传统课程注重软件操作（推理）`;

describe('shared template section heading normalization', () => {
  it('renders the reported adlib output and saves canonical headings without losing notes', () => {
    const parsed = parseTemplateText(ADLIB);
    expect(parsed.sections.size).toBe(6);
    expect(parsed.sections.get('我们的')).toHaveLength(2);
    const model = templateToModel(ADLIB);
    expect(model.nodes.filter(n => n.data?.role === 'sticky')).toHaveLength(7);
    const saved = serializeTemplate(model);
    expect(saved).toContain('## 我们的');
    expect(saved).toContain('构建高校动画教育AI伦理实践指南（推理）');
    expect(serializeTemplate(templateToModel(saved))).toBe(saved);
  });

  it.each(listTemplates())('supports missing ## for every registered template: $key', spec => {
    const code = [`模板: ${spec.key}`, ...(spec.fields ?? []).map(field => `${field}: 字段内容`),
      ...spec.sections.flatMap(section => [`${section.name}：`, `- 要点：${section.name}`])].join('\n');
    const parsed = parseTemplateText(code);
    expect(parsed.sections.size).toBe(spec.sections.length);
    for (const section of spec.sections) expect(parsed.sections.get(section.name)).toEqual([`要点：${section.name}`]);
    for (const field of spec.fields ?? []) expect(parsed.fields.get(field)).toBe('字段内容');
    const model = templateToModel(code);
    expect(model.nodes.filter(n => n.data?.role === 'sticky')).toHaveLength(spec.sections.length);
  });

  it('supports bare headings, inline content and the persona fence alias', () => {
    const parsed = parseTemplateText('姓名: 林砚\n用户描述\n- 动画教授\n目标和需求：孵化原创IP', 'persona');
    expect(parsed.fields.get('姓名')).toBe('林砚');
    expect(parsed.sections.get('用户描述')).toEqual(['动画教授']);
    expect(parsed.sections.get('目标和需求')).toEqual(['孵化原创IP']);
    expect(templateToModel('用户描述:\n- 动画教授', 'persona').nodes.some(n => n.label === '动画教授')).toBe(true);
  });

  it('uses organization template sections and protects a section/field name collision', () => {
    registerTemplate({ key: 'heading-custom', title: '组织模板', fields: ['姓名'], sections: [
      { name: '姓名', x: 200, y: 200, w: 300, h: 300 },
      { name: '工作目标', x: 600, y: 200, w: 300, h: 300 },
    ] });
    const parsed = parseTemplateText('模板: heading-custom\n姓名: 林砚\n工作目标:\n- 学生原创IP');
    expect(parsed.fields.get('姓名')).toBe('林砚');
    expect(parsed.sections.has('姓名')).toBe(false);
    expect(parsed.sections.get('工作目标')).toEqual(['学生原创IP']);
  });

  it.each(['未知分区:', '我们的:', '- 我们的: 内容', '* 我们的: 内容', '模板: adlib', '姓名: 林砚'])('does not invent a section: %s', line => {
    const normalized = normalizeTemplateSectionHeading(line, undefined,
      name => name === '我们的' ? name : null, name => name === '姓名');
    expect(normalized).toBeNull();
  });

  it('does not infer a template identity from unknown content', () => {
    expect(parseTemplateText('模板: unknown\n我们的:\n- 内容').sections.size).toBe(0);
    expect(parseTemplateText('我们的:\n- 内容').sections.size).toBe(0);
  });
});
