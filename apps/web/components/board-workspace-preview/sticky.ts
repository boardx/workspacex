import { Textbox, classRegistry } from 'fabric';
/** A sticky is one editable Fabric object, so move/delete can never split its paper and text. */
export class PreviewSticky extends Textbox {
  static type = 'PreviewSticky';
  override initDimensions() { super.initDimensions(); this.height = Math.max(160, this.height); }
}
classRegistry.setClass(PreviewSticky);
export function makeSticky(x: number, y: number, color: string, text = '写下一个想法') {
  return new PreviewSticky(text, { originX: 'left', originY: 'top', left: x, top: y, width: 180, fontSize: 22, fill: '#292929', backgroundColor: color, textAlign: 'center', splitByGrapheme: true });
}
