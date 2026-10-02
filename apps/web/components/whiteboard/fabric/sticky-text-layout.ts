import {Textbox} from "fabric";
import {validateTextAttributes} from "@repo/whiteboard-core";

export interface StickyTextLayoutInput {
  text: string;
  width: number;
  height: number;
  variant: "square" | "rectangle" | "circle";
  padding: number;
  fontSize: number;
  minimumFontSize: number;
  verticalAlignment?: "top" | "middle" | "bottom";
}
export interface StickyTextLayout {width: number; height: number; measuredHeight: number; fontSize: number; top: number; overflow: boolean}
export type StickyTextMeasure = (text: string, width: number, fontSize: number) => {width: number; height: number};
export const stickyMinimumFontSize = () => validateTextAttributes({preset:"caption"}).fontSize;
export function watchStickyFontLayouts(fonts: {ready: Promise<unknown>; addEventListener(type: "loadingdone", listener: () => void): void; removeEventListener(type: "loadingdone", listener: () => void): void},
  pointer: {on(type: "mouse:down" | "mouse:up", listener: () => void): unknown; off(type: "mouse:down" | "mouse:up", listener: () => void): unknown},
  refresh: () => void, schedule: (callback: () => void) => unknown = callback => requestAnimationFrame(callback)) {
  let disposed=false,pointerHeld=false,pending=false;
  const ready=() => {if(disposed)return;if(pointerHeld){pending=true;return;}refresh();};
  const down=() => {pointerHeld=true;};
  const up=() => {pointerHeld=false;if(pending){pending=false;schedule(ready);}};
  pointer.on("mouse:down",down);pointer.on("mouse:up",up);
  fonts.addEventListener("loadingdone",ready);void fonts.ready.then(ready);
  return () => {disposed=true;fonts.removeEventListener("loadingdone",ready);pointer.off("mouse:down",down);pointer.off("mouse:up",up);};
}
export function fabricStickyTextMeasure(options: {fontFamily?: string; fontWeight?: string | number; fontStyle?: "normal" | "italic" | "oblique"; lineHeight?: number}): StickyTextMeasure {
  const box = new Textbox("", {...options, splitByGrapheme:true});
  return (text, width, fontSize) => {box.set({text, width, fontSize}); return {width:box.width,height:box.height};};
}
export function layoutStickyText(input: StickyTextLayoutInput, measure: StickyTextMeasure): StickyTextLayout {
  const diameter=Math.min(input.width,input.height);
  const width=Math.max(1,(input.variant === "circle" ? diameter : input.width)-input.padding*2);
  const height=Math.max(1,(input.variant === "circle" ? diameter : input.height)-input.padding*2);
  const upper=Math.max(1,input.fontSize),minimum=Math.min(upper,Math.max(1,input.minimumFontSize));
  const atSize = (fontSize: number): StickyTextLayout | null => {
    const ratios=input.variant === "circle" ? Array.from({length:19},(_,index)=>(19-index)/20) : [1];
    for(const ratio of ratios) {
      const candidateWidth=width*ratio;
      const availableHeight=input.variant === "circle" ? height*Math.sqrt(1-ratio*ratio) : height;
      const metric=measure(input.text,candidateWidth,fontSize);
      if(metric.height>availableHeight+.001 || metric.width>candidateWidth+.001) continue;
      const top=input.verticalAlignment === "top" ? (metric.height-availableHeight)/2
        : input.verticalAlignment === "bottom" ? (availableHeight-metric.height)/2 : 0;
      return {width:candidateWidth,height:availableHeight,measuredHeight:metric.height,fontSize,top,overflow:false};
    }
    return null;
  };
  const full=atSize(upper); if(full) return full;
  let best=atSize(minimum);
  if(best) {
    let low=minimum,high=upper;
    // Search render-only font size; each candidate uses Fabric's actual wrapped metrics.
    for(let iteration=0;iteration<7;iteration++) {
      const middle=(low+high)/2,candidate=atSize(middle);
      if(candidate) {best=candidate;low=middle;} else high=middle;
    }
    return best;
  }
  const ratio=input.variant === "circle" ? Math.SQRT1_2 : 1;
  const overflowWidth=width*ratio,overflowHeight=height*ratio;
  const metric=measure(input.text,overflowWidth,minimum);
  return {width:overflowWidth,height:overflowHeight,measuredHeight:metric.height,fontSize:minimum,
    top:(metric.height-overflowHeight)/2,overflow:true};
}
