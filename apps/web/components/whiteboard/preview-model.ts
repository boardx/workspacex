/** Transient UI model; intentionally not a server/API contract. */
export type Kind = 'sticky' | 'rectangle' | 'ellipse' | 'text' | 'frame';
export type Tone = 'idea' | 'question' | 'decision';
export interface PreviewObject { id: string; kind: Kind; text: string; x: number; y: number; width: number; height: number; tone: Tone }
export interface PreviewDocument { objects: PreviewObject[]; edges: { id: string; from: string; to: string }[] }
export const tones: Record<Tone, string> = { idea: 'bg-warning-tint text-warning-tint-foreground', question: 'bg-ai-tint text-ai-tint-foreground', decision: 'bg-primary text-primary-foreground' };
export const toneLabels: Record<Tone, string> = { idea: '想法', question: '问题', decision: '决定' };
export function makeObject(kind: Kind, x: number, y: number): PreviewObject {
  return { id: crypto.randomUUID(), kind, x, y, width: kind === 'frame' ? 760 : 192, height: kind === 'frame' ? 480 : kind === 'text' ? 72 : 152, text: kind === 'frame' ? '新的讨论区' : '写下一个想法', tone: 'idea' };
}
export function initialDocument(empty: boolean): PreviewDocument {
  if (empty) return { objects: [], edges: [] };
  return { objects: [
    { id: 'frame-1', kind: 'frame', text: '怎样让每个人的想法被看见？', x: 80, y: 70, width: 760, height: 480, tone: 'idea' },
    { id: 'note-1', kind: 'sticky', text: '先独立思考\n再一起讨论', x: 120, y: 150, width: 192, height: 152, tone: 'idea' },
    { id: 'note-2', kind: 'sticky', text: '把相似的想法\n放在一起', x: 352, y: 150, width: 192, height: 152, tone: 'question' },
    { id: 'note-3', kind: 'sticky', text: '确定一个\n可以行动的下一步', x: 584, y: 345, width: 192, height: 152, tone: 'decision' },
  ], edges: [{ id: 'edge-1', from: 'note-1', to: 'note-2' }, { id: 'edge-2', from: 'note-2', to: 'note-3' }] };
}
