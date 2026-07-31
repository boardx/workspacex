/**
 * User-persona workshop template, expressed as a TemplateSpec on the shared
 * canvas-template engine (see template-engine.ts for syntax & semantics).
 * The ```persona fence is an alias for `模板: persona` in a ```canvas fence.
 */
import {
  registerTemplate,
  templateToModel,
  serializeTemplate,
  parseTemplateText,
} from './template-engine';
import type { DiagramModel } from '../model';

export const PERSONA_FIELDS = [
  '姓名',
  '性别',
  '年龄',
  '区域',
  '教育水平',
  '职位',
  '行业',
  '家庭情况',
  '收入水平',
] as const;

export const PERSONA_SECTIONS = [
  '用户描述',
  '目标和需求',
  '行为与偏好',
  '痛点和挑战',
  '动机',
  '影响因素',
] as const;

registerTemplate({
  key: 'persona',
  pdfPage: 3,
  title: '用户画像 User Persona',
  fields: [...PERSONA_FIELDS],
  headerRect: { x: 780, y: 105, w: 1440, h: 110 },
  fieldsPerRow: 5,
  titleNameFields: ['标题', '职位'],
  sections: [
    { name: '用户描述', x: 290, y: 360, w: 460, h: 320 },
    { name: '目标和需求', x: 780, y: 360, w: 460, h: 320 },
    { name: '行为与偏好', x: 1270, y: 360, w: 460, h: 320 },
    { name: '痛点和挑战', x: 290, y: 720, w: 460, h: 320 },
    { name: '动机', x: 780, y: 720, w: 460, h: 320 },
    { name: '影响因素', x: 1270, y: 720, w: 460, h: 320 },
  ],
});

/** Back-compat wrappers (the engine is the real implementation now). */
export function personaToModel(code: string): DiagramModel {
  return templateToModel(code, 'persona');
}
export const serializePersona = serializeTemplate;
export const parsePersonaText = (code: string) => {
  const parsed = parseTemplateText(code);
  return { fields: parsed.fields, sections: parsed.sections };
};
