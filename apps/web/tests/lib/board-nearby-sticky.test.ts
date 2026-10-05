import { describe, it, expect } from "vitest";
import { nearbyStickyPlacement } from "../../components/whiteboard/board-nearby-sticky";
import type { WhiteboardObject } from "@repo/whiteboard-core";
const sticky = { id:"source",kind:"sticky",geometry:{x:100,y:100,width:180,height:180,rotation:0},style:{fill:"#C6DDFF"},locked:false,hidden:false } as WhiteboardObject;
describe("nearby sticky placement",()=>{
 const frame = {...sticky,id:"frame",kind:"frame",parentId:null,geometry:{x:0,y:0,width:700,height:500,rotation:0}} as WhiteboardObject;
 const child = {...sticky,parentId:"frame"};
 it("places inside the source frame and retains inheritance source",()=>{
   const result=nearbyStickyPlacement({x:320,y:190},[frame,child],1);
   expect(result?.geometry).toEqual({...sticky.geometry,x:304});
   expect(result?.source.parentId).toBe("frame");expect(result?.source.style).toEqual(sticky.style);
   expect(result!.geometry.x).toBeGreaterThan(child.geometry.x+child.geometry.width);
 });
 it("ignores nested ancestor frames but keeps sibling obstacles",()=>{
   const outer={...frame,id:"outer",geometry:{...frame.geometry,width:1000}};
   const inner={...frame,parentId:"outer"};
   expect(nearbyStickyPlacement({x:320,y:190},[outer,inner,child],1)).not.toBeNull();
   const sibling={...sticky,id:"sibling",parentId:"frame",geometry:{...sticky.geometry,x:304}};
   expect(nearbyStickyPlacement({x:320,y:190},[outer,inner,child,sibling],1)).toBeNull();
 });
 it("does not ignore unrelated frames or frame-shaped noncontainers",()=>{
   expect(nearbyStickyPlacement({x:320,y:190},[child,frame,{...frame,id:"unrelated"}],1)).toBeNull();
   expect(nearbyStickyPlacement({x:320,y:190},[child,{...frame,kind:"rectangle"}],1)).toBeNull();
 });
 it("aligns above the source and preserves its size",()=>{expect(nearbyStickyPlacement({x:190,y:60},[sticky],1)?.geometry).toEqual({...sticky.geometry,y:-104});});
 it("measures neighborhood in screen pixels",()=>{expect(nearbyStickyPlacement({x:190,y:-60},[sticky],1)).toBeNull();expect(nearbyStickyPlacement({x:190,y:-60},[sticky],.5)).not.toBeNull();});
 it("avoids hidden sources and occupied destination",()=>{expect(nearbyStickyPlacement({x:190,y:60},[{...sticky,hidden:true}],1)).toBeNull();expect(nearbyStickyPlacement({x:190,y:60},[sticky,{...sticky,id:"occupied",geometry:{...sticky.geometry,y:-104}}],1)).toBeNull();});
});
