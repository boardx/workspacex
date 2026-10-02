import {describe, expect, it} from "vitest";
import {Textbox, getEnv} from "fabric/node";
import {setEnv, Group, Textbox as BrowserTextbox} from "fabric";
import {createFabricObject, applyCanonicalObject, geometryFromFabric} from "@/components/whiteboard/fabric/board-fabric-surface";
import type {BoardFabricObject} from "@/components/whiteboard/fabric/board-fabric-object";
import {layoutStickyText, watchStickyFontLayouts, type StickyTextLayoutInput} from "@/components/whiteboard/fabric/sticky-text-layout";

const measure = (text: string, width: number, fontSize: number) => {
  const box = new Textbox(text, {width, fontSize, fontFamily: "sans-serif", splitByGrapheme: true, lineHeight: 1.3});
  return {width: box.width, height: box.height};
};
const input = (text: string, variant: "square" | "rectangle" | "circle" = "square"): StickyTextLayoutInput => ({text, width:180, height:180, variant, padding:24, fontSize:20, minimumFontSize:14, verticalAlignment:"middle"});
describe("fixed-frame sticky text fit using real Fabric metrics", () => {
  for (const text of ["中文内容换行".repeat(8), "longwordwithoutanyspaces".repeat(5), "first\nsecond\nthird\nfourth\nfifth", "mixed 中文 emoji 👩‍💻 content".repeat(5)]) {
    it(`fits or explicitly overflows without altering source ${text.slice(0,12)}`, () => {
      const value=input(text), before=structuredClone(value), result=layoutStickyText(value, measure);
      expect(value).toEqual(before);
      expect(result.fontSize).toBeGreaterThanOrEqual(14); expect(result.fontSize).toBeLessThanOrEqual(20);
      if (!result.overflow) expect(result.measuredHeight).toBeLessThanOrEqual(result.height + .01);
      else expect(result.fontSize).toBe(14);
    });
  }
  it("contains the measured circle text rectangle, not just its width", () => {
    const result=layoutStickyText(input("A fairly long circle note wraps over several lines", "circle"),measure);
    const r=66;
    expect(result.overflow).toBe(false);
    expect((result.width/2)**2+(Math.abs(result.top)+result.measuredHeight/2)**2).toBeLessThanOrEqual(r*r+.01);
  });
  it("uses the real smaller circle diameter for a non-square canonical frame", () => {
    const result=layoutStickyText({...input("A circle with multiline content", "circle"),width:240,height:180},measure);
    expect(result.overflow).toBe(false);
    expect((result.width/2)**2+(Math.abs(result.top)+result.measuredHeight/2)**2).toBeLessThanOrEqual(66**2+.01);
    expect(result.width).toBeLessThanOrEqual(132);
  });
  it("keeps minimum readable size and exposes overflow for unlimited content", () => {
    const result=layoutStickyText(input("不可丢失文本".repeat(100)),measure);
    expect(result.overflow).toBe(true); expect(result.fontSize).toBe(14);
    expect(result.measuredHeight).toBeGreaterThan(result.height);
  });
  it("fits short text within resized shape variants without shrinking the selected font", () => {
    for(const variant of ["square","rectangle","circle"] as const) {
      const value={...input("Short note",variant),width:240,height:180};
      const result=layoutStickyText(value,measure);
      expect(result.overflow).toBe(false);expect(result.fontSize).toBe(20);
      expect(result.width).toBeLessThanOrEqual(192);expect(result.measuredHeight).toBeLessThanOrEqual(result.height);
    }
  });
  it.each(["square","rectangle","circle"] as const)("retains canonical text/frame/font during real %s projection and resize", variant => {
    setEnv(getEnv());
    const record: BoardFabricObject={id:"fit",kind:"sticky",revision:1,orderKey:"a",geometry:{x:40,y:50,width:180,height:180,rotation:37},sticky:{variant,sizingMode:"fixed"},style:{fill:"#FFE89A",textColor:"#000000",fontSize:20},content:{text:"Long 中文 note with explicit\nline breaks and verylongunbrokenword".repeat(4)}};
    const before=structuredClone(record),group=createFabricObject(record) as Group;
    applyCanonicalObject(group,record,false);
    const label=group.getObjects()[1] as BrowserTextbox;
    expect(label.text).toBe(record.content.text);expect(label.fontSize).toBeGreaterThanOrEqual(14);
    expect(label.clipPath).toBeDefined();expect(geometryFromFabric(group,record)).toEqual(record.geometry);
    expect(record).toEqual(before);
    const resized={...record,geometry:{...record.geometry,width:240,height:240}};
    applyCanonicalObject(group,resized,false);
    expect(geometryFromFabric(group,resized)).toEqual(resized.geometry);
    expect(label.text).toBe(before.content.text);expect(resized.style.fontSize).toBe(20);
  });
});

describe("font readiness render-only lifecycle", () => {
  it("defers font-ready and loadingdone while pointer held, refreshes latest projection once, and cleans up", async () => {
    setEnv(getEnv());
    let resolveReady!: () => void;
    const ready=new Promise<void>(resolve=>{resolveReady=resolve;});
    const fontListeners=new Set<()=>void>(),pointerListeners=new Map<string,()=>void>(),frames:Array<()=>void>=[];
    const fonts={ready,addEventListener:(_type:string,listener:()=>void)=>{fontListeners.add(listener);},removeEventListener:(_type:string,listener:()=>void)=>{fontListeners.delete(listener);}};
    const pointer={on:(type:string,listener:()=>void)=>{pointerListeners.set(type,listener);},off:(type:string,listener:()=>void)=>{if(pointerListeners.get(type)===listener)pointerListeners.delete(type);}};
    const record:BoardFabricObject={id:"font-ready",kind:"sticky",revision:1,orderKey:"a",geometry:{x:10,y:20,width:180,height:180,rotation:0},sticky:{variant:"circle",sizingMode:"fixed"},style:{fill:"#FFE89A",textColor:"#000000",fontSize:20},content:{text:"Font layout ready without document writes"}};
    const before=structuredClone(record),projected=createFabricObject(record);
    let refreshes=0;
    const cleanup=watchStickyFontLayouts(fonts,pointer,()=>{refreshes++;applyCanonicalObject(projected,record,false);},callback=>frames.push(callback));
    pointerListeners.get("mouse:down")!();resolveReady();await ready;await Promise.resolve();
    fontListeners.forEach(listener=>listener());expect(refreshes).toBe(0);
    pointerListeners.get("mouse:up")!();expect(frames).toHaveLength(1);frames.shift()!();
    expect(refreshes).toBe(1);expect(record).toEqual(before);expect(geometryFromFabric(projected,record)).toEqual(record.geometry);
    pointerListeners.get("mouse:down")!();fontListeners.forEach(listener=>listener());pointerListeners.get("mouse:up")!();
    cleanup();frames.shift()!();expect(refreshes).toBe(1);expect(fontListeners.size).toBe(0);expect(pointerListeners.size).toBe(0);
    expect(record).toEqual(before);
  });
  it("does not refresh from a late font-ready promise after disposal", async () => {
    let resolveReady!:()=>void;const ready=new Promise<void>(resolve=>{resolveReady=resolve;});let refreshes=0;
    const fonts={ready,addEventListener:()=>{},removeEventListener:()=>{}};
    const pointer={on:()=>{},off:()=>{}};
    const cleanup=watchStickyFontLayouts(fonts,pointer,()=>{refreshes++;});cleanup();resolveReady();await ready;await Promise.resolve();
    expect(refreshes).toBe(0);
  });
});
