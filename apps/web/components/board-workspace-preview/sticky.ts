import { Textbox, classRegistry } from 'fabric';
/** A sticky is one editable Fabric object, so move/delete can never split its paper and text. */
export class PreviewSticky extends Textbox {
  static type = 'PreviewSticky';
  /** Transient controller callback; never persisted as document data. */
  onNextSticky?: () => void;
  get composing() { return this.inCompositionMode; }
  override initDimensions() { super.initDimensions(); this.height = Math.max(160, this.height + 32); }
  override _wrapLine(...args: Parameters<Textbox['_wrapLine']>) {
    args[3] = (args[3] ?? 0) + 32;
    return super._wrapLine(...args);
  }
  override _getTopOffset() { return super._getTopOffset() + 16; }
  override _getLineLeftOffset(line: number) {
    return super._getLineLeftOffset(line) + (this.textAlign === 'left' ? 16 : this.textAlign === 'right' ? -16 : 0);
  }
  override onKeyDown(event: KeyboardEvent) {
    if (event.isComposing || this.inCompositionMode || event.keyCode === 229) return;
    if (event.key === 'Tab') {
      // Shift+Tab remains native focus navigation instead of creating a note.
      if (!event.shiftKey && this.onNextSticky) { event.preventDefault(); event.stopPropagation(); this.onNextSticky(); }
      else this.exitEditing();
      return;
    }
    super.onKeyDown(event);
  }
}
classRegistry.setClass(PreviewSticky);
export function stickyTextColor(color: string) {
  const hex = color.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#292929';
  const channels = [0, 2, 4].map(offset => { const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722 < 0.3 ? '#ffffff' : '#292929';
}
export function makeSticky(x: number, y: number, color: string, text = '写下一个想法') {
  return new PreviewSticky(text, { originX: 'left', originY: 'top', left: x, top: y, width: 180, fontSize: 22, fill: stickyTextColor(color), backgroundColor: color, textAlign: 'center', splitByGrapheme: true });
}

export function adjacentSticky(source: PreviewSticky, duplicate = false) {
  const next = makeSticky(source.left + source.getScaledWidth() + 24, source.top, String(source.backgroundColor), duplicate ? source.text : '写下一个想法');
  next.set({ fontSize: source.fontSize, textAlign: source.textAlign, width: source.width, scaleX: source.scaleX, scaleY: source.scaleY });
  next.initDimensions();
  return next;
}
