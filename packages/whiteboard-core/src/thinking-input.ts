import {
  WhiteboardObject,
  type WhiteboardCommand,
} from '@repo/contracts/whiteboard-document';
import type { BoardCommandEnvelope } from './command-port';

export const STICKY_COLOR_PRESETS = {
  yellow: '#F8D76E',
  pink: '#F7B7CD',
  blue: '#BBDDF8',
  green: '#BDE5C8',
  purple: '#D9CDF7',
  orange: '#F8C38D',
  gray: '#D8D8D4',
  white: '#FFFFFF',
} as const;

export type StickyColorPreset = keyof typeof STICKY_COLOR_PRESETS;
export type StickyColor = { preset: StickyColorPreset } | { custom: string };
export type StickyVariant = 'square' | 'rectangle' | 'circle';
export type StickySizingMode = 'auto-height' | 'fixed' | 'auto-size';
export type TextStylePreset = 'title' | 'heading' | 'subheading' | 'body' | 'caption';
export type TextAlignment = 'left' | 'center' | 'right';
export type TextListStyle = 'none' | 'bullet' | 'number';
export type ThinkingInputGeometry = WhiteboardObject['geometry'];

export interface TextAttributes {
  preset: TextStylePreset;
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  alignment?: TextAlignment;
  lineHeight?: number;
  list?: TextListStyle;
  link?: string | null;
}

export interface CanonicalTextAttributes {
  preset: TextStylePreset;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  alignment: TextAlignment;
  lineHeight: number;
  list: TextListStyle;
  link: string | null;
}

export interface ThinkingInputMetadata {
  sticky?: { variant: StickyVariant; sizing: StickySizingMode; color: string };
  text?: CanonicalTextAttributes;
}

const TEXT_PRESETS: Record<TextStylePreset, Pick<CanonicalTextAttributes, 'fontSize' | 'bold' | 'lineHeight'>> = {
  title: { fontSize: 48, bold: true, lineHeight: 1.15 },
  heading: { fontSize: 32, bold: true, lineHeight: 1.2 },
  subheading: { fontSize: 24, bold: true, lineHeight: 1.25 },
  body: { fontSize: 18, bold: false, lineHeight: 1.4 },
  caption: { fontSize: 14, bold: false, lineHeight: 1.35 },
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const IDENTITY = /^[\s\S]{1,256}$/;
const OBJECT_ID = /^[a-zA-Z0-9_-]{1,128}$/;

function finiteInRange(value: number, min: number, max: number, error: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(error);
  return value;
}

function canonicalHex(value: string, error: string): string {
  if (!HEX_COLOR.test(value)) throw new Error(error);
  return value.toUpperCase();
}

export function resolveStickyColor(color: StickyColor): string {
  if ('preset' in color) {
    const resolved = STICKY_COLOR_PRESETS[color.preset];
    if (!resolved) throw new Error('STICKY_COLOR_INVALID');
    return resolved;
  }
  return canonicalHex(color.custom, 'STICKY_COLOR_INVALID');
}

export function validateTextAttributes(input: TextAttributes): CanonicalTextAttributes {
  const defaults = TEXT_PRESETS[input.preset];
  if (!defaults) throw new Error('TEXT_PRESET_INVALID');
  const fontFamily = input.fontFamily ?? 'Noto Sans SC';
  if (!fontFamily.trim() || fontFamily.length > 128) throw new Error('TEXT_FONT_INVALID');
  const link = input.link ?? null;
  if (link !== null) {
    if (link.length > 2048) throw new Error('TEXT_LINK_INVALID');
    let parsed: URL;
    try { parsed = new URL(link); } catch { throw new Error('TEXT_LINK_INVALID'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('TEXT_LINK_INVALID');
  }
  const alignment = input.alignment ?? 'left';
  if (!(['left', 'center', 'right'] as const).includes(alignment)) throw new Error('TEXT_ALIGNMENT_INVALID');
  const list = input.list ?? 'none';
  if (!(['none', 'bullet', 'number'] as const).includes(list)) throw new Error('TEXT_LIST_INVALID');
  return {
    preset: input.preset,
    fontFamily,
    fontSize: finiteInRange(input.fontSize ?? defaults.fontSize, 8, 200, 'TEXT_FONT_SIZE_INVALID'),
    bold: input.bold ?? defaults.bold,
    italic: input.italic ?? false,
    underline: input.underline ?? false,
    color: canonicalHex(input.color ?? '#242424', 'TEXT_COLOR_INVALID'),
    alignment,
    lineHeight: finiteInRange(input.lineHeight ?? defaults.lineHeight, 0.8, 3, 'TEXT_LINE_HEIGHT_INVALID'),
    list,
    link,
  };
}

export interface TextInputIntent {
  committed: string;
  draft: string;
  composition: null | { before: string; value: string };
}

export function beginTextInput(value = ''): TextInputIntent {
  return { committed: value, draft: value, composition: null };
}

export function updateTextInput(state: TextInputIntent, value: string): TextInputIntent {
  return state.composition
    ? { ...state, draft: value, composition: { ...state.composition, value } }
    : { ...state, draft: value };
}

export function beginComposition(state: TextInputIntent): TextInputIntent {
  if (state.composition) return state;
  return { ...state, composition: { before: state.draft, value: state.draft } };
}

/** Composition updates remain drafts and therefore never create a canonical text command. */
export function commitComposition(state: TextInputIntent, finalValue = state.draft): TextInputIntent {
  if (!state.composition) return { ...state, draft: finalValue };
  return { committed: state.committed, draft: finalValue, composition: null };
}

export function cancelComposition(state: TextInputIntent): TextInputIntent {
  if (!state.composition) return state;
  return { committed: state.committed, draft: state.composition.before, composition: null };
}

export function commitTextInput(state: TextInputIntent): TextInputIntent {
  if (state.composition) throw new Error('TEXT_COMPOSITION_ACTIVE');
  return { committed: state.draft, draft: state.draft, composition: null };
}

export function cancelTextInput(state: TextInputIntent): TextInputIntent {
  return { committed: state.committed, draft: state.committed, composition: null };
}

export interface ContinuationPlacement {
  direction: 'row' | 'column';
  geometry: ThinkingInputGeometry;
}

const overlaps = (a0: number, a1: number, b0: number, b1: number): boolean => Math.min(a1, b1) > Math.max(a0, b0);

export function nextStickyPlacement(
  current: ThinkingInputGeometry,
  nearby: readonly ThinkingInputGeometry[],
  gap = 24,
): ContinuationPlacement {
  finiteInRange(gap, 0, 10000, 'STICKY_GAP_INVALID');
  const others = nearby.filter(item => item !== current && !(
    item.x === current.x && item.y === current.y && item.width === current.width && item.height === current.height
  ));
  const row = others.filter(item => overlaps(current.y, current.y + current.height, item.y, item.y + item.height));
  const column = others.filter(item => overlaps(current.x, current.x + current.width, item.x, item.x + item.width));
  const direction: 'row' | 'column' = column.length > row.length ? 'column' : 'row';
  const result = { ...current };
  const occupied = (candidate: ThinkingInputGeometry): boolean => others.some(item =>
    overlaps(candidate.x, candidate.x + candidate.width, item.x, item.x + item.width)
    && overlaps(candidate.y, candidate.y + candidate.height, item.y, item.y + item.height));
  do {
    if (direction === 'row') result.x += current.width + gap;
    else result.y += current.height + gap;
  } while (occupied(result));
  return { direction, geometry: result };
}

export interface ThinkingPaste {
  text: string;
  list: string[];
  stickies: string[];
}

export function parseBulkStickyLines(value: string, limit = 100): string[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('BULK_STICKY_LIMIT_INVALID');
  const lines = value.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('BULK_STICKY_EMPTY');
  if (lines.length > limit) throw new Error('BULK_STICKY_LIMIT_EXCEEDED');
  return lines;
}

export function parseThinkingPaste(value: string): ThinkingPaste {
  const text = value.replace(/\r\n?/g, '\n');
  const lines = parseBulkStickyLines(text);
  return { text, list: [...lines], stickies: [...lines] };
}

export interface StickyBatchItem {
  id: string;
  text: string;
  geometry: ThinkingInputGeometry;
  orderKey?: string;
  parentId?: string | null;
  extensionData?: Record<string, unknown>;
}

export interface StickyBatchInput {
  boardId: string;
  clientId: string;
  gestureId: string;
  items: readonly StickyBatchItem[];
  variant?: StickyVariant;
  color?: StickyColor;
  sizing?: StickySizingMode;
  text?: TextAttributes;
}

function requiredIdentity(value: string): string {
  if (!IDENTITY.test(value)) throw new Error('THINKING_INPUT_IDENTITY_INVALID');
  return value;
}

/** Builds one caller-keyed operation envelope. It never allocates IDs or dispatches side effects. */
export function createStickyBatchEnvelope(input: StickyBatchInput): BoardCommandEnvelope {
  const boardId = requiredIdentity(input.boardId);
  const clientId = requiredIdentity(input.clientId);
  const gestureId = requiredIdentity(input.gestureId);
  if (input.items.length === 0) throw new Error('BULK_STICKY_EMPTY');
  if (input.items.length > 100) throw new Error('BULK_STICKY_LIMIT_EXCEEDED');
  const ids = input.items.map(item => item.id);
  if (ids.some(id => !OBJECT_ID.test(id)) || new Set(ids).size !== ids.length) throw new Error('STICKY_ID_INVALID');
  const variant = input.variant ?? 'square';
  const sizing = input.sizing ?? 'auto-height';
  if (!(['square', 'rectangle', 'circle'] as const).includes(variant)) throw new Error('STICKY_VARIANT_INVALID');
  if (!(['auto-height', 'fixed', 'auto-size'] as const).includes(sizing)) throw new Error('STICKY_SIZING_INVALID');
  const color = resolveStickyColor(input.color ?? { preset: 'yellow' });
  const text = validateTextAttributes(input.text ?? { preset: 'body' });

  const commands: WhiteboardCommand[] = input.items.map((item, index) => {
    const previousThinking = item.extensionData?.thinkingInput;
    const preservedThinking = previousThinking && typeof previousThinking === 'object' && !Array.isArray(previousThinking)
      ? previousThinking as Record<string, unknown>
      : {};
    const metadata: ThinkingInputMetadata = {
      sticky: { variant, sizing, color },
      text,
    };
    const object = WhiteboardObject.parse({
      id: item.id,
      schemaVersion: 1,
      kind: 'sticky',
      geometry: item.geometry,
      text: item.text,
      style: { fill: color, color: text.color, fontSize: text.fontSize },
      parentId: item.parentId ?? null,
      orderKey: item.orderKey ?? `${String(index).padStart(3, '0')}-${item.id}`,
      extensionData: {
        ...structuredClone(item.extensionData ?? {}),
        thinkingInput: { ...structuredClone(preservedThinking), ...metadata },
      },
    });
    return { type: 'create' as const, object };
  });
  return { boardId, clientId, gestureId, commands };
}
