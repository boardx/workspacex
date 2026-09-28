import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';

export type PanelMode = 'freeform' | 'grid' | 'flow';
export type FlowDirection = 'horizontal' | 'vertical';
export type PanelShape = 'rectangle' | 'rounded' | 'circle';
export type PanelTemplate = 'blank' | 'section' | 'grid' | 'timeline';

export interface PanelMetadata {
  version: 1;
  mode: PanelMode;
  autoExpand: boolean;
  clipContent: boolean;
  padding: number;
  gap: number;
  columns: number;
  flowDirection: FlowDirection;
  shape?: PanelShape;
  template?: PanelTemplate;
}

type JsonRecord = Record<string, unknown>;

function plain(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('PANEL_METADATA_INVALID');
  }
  return value as JsonRecord;
}

function bounded(value: unknown, minimum: number, maximum: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new Error('PANEL_METADATA_INVALID');
  }
  return value;
}

export function parsePanelMetadata(value: unknown): PanelMetadata {
  const raw = plain(value);
  if (raw.version !== 1 || !['freeform', 'grid', 'flow'].includes(String(raw.mode))) throw new Error('PANEL_METADATA_INVALID');
  if (typeof raw.autoExpand !== 'boolean' || typeof raw.clipContent !== 'boolean' || (raw.autoExpand && raw.clipContent)) {
    throw new Error('PANEL_METADATA_INVALID');
  }
  if (!['horizontal', 'vertical'].includes(String(raw.flowDirection))) throw new Error('PANEL_METADATA_INVALID');
  if (raw.shape !== undefined && !['rectangle', 'rounded', 'circle'].includes(String(raw.shape))) throw new Error('PANEL_METADATA_INVALID');
  if (raw.template !== undefined && !['blank', 'section', 'grid', 'timeline'].includes(String(raw.template))) throw new Error('PANEL_METADATA_INVALID');
  return {
    ...structuredClone(raw),
    version: 1,
    mode: raw.mode as PanelMode,
    autoExpand: raw.autoExpand,
    clipContent: raw.clipContent,
    padding: bounded(raw.padding, 0, 500),
    gap: bounded(raw.gap, 0, 500),
    columns: bounded(raw.columns, 1, 100, true),
    flowDirection: raw.flowDirection as FlowDirection,
    ...(raw.shape === undefined ? {} : { shape: raw.shape as PanelShape }),
    ...(raw.template === undefined ? {} : { template: raw.template as PanelTemplate }),
  } as PanelMetadata;
}

export function readPanelMetadata(object: WhiteboardObject): PanelMetadata | null {
  const value = object.extensionData?.spatial;
  if (value === undefined) return null;
  if (object.kind !== 'frame') throw new Error('PANEL_KIND_INVALID');
  return parsePanelMetadata(value);
}

export function panelExtension(previous: WhiteboardObject['extensionData'], panel: PanelMetadata): Record<string, unknown> {
  return { ...(previous ?? {}), spatial: parsePanelMetadata(panel) };
}

export function validateSpatialExtension(object: WhiteboardObject): void {
  if (object.kind === 'frame' && object.extensionData?.spatial !== undefined) readPanelMetadata(object);
  else if (object.extensionData?.spatial !== undefined) throw new Error('PANEL_KIND_INVALID');
}
