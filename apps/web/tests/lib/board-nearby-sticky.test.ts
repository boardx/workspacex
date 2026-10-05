import { describe, it, expect } from "vitest";
import { nearbyStickyPlacement } from "../../components/whiteboard/board-nearby-sticky";
import type { WhiteboardObject } from "@repo/whiteboard-core";
const sticky = { id:"source",kind:"sticky",geometry:{x:100,y:100,width:180,height:180,rotation:0},style:{fill:"#C6DDFF"},locked:false,hidden:false } as WhiteboardObject;
describe("nearby sticky placement",()=>{
 it("aligns above the source and preserves its size",()=>{expect(nearbyStickyPlacement({x:190,y:60},[sticky],1)?.geometry).toEqual({...sticky.geometry,y:-104});});
 it("measures neighborhood in screen pixels",()=>{expect(nearbyStickyPlacement({x:190,y:-60},[sticky],1)).toBeNull();expect(nearbyStickyPlacement({x:190,y:-60},[sticky],.5)).not.toBeNull();});
 it("avoids hidden sources and occupied destination",()=>{expect(nearbyStickyPlacement({x:190,y:60},[{...sticky,hidden:true}],1)).toBeNull();expect(nearbyStickyPlacement({x:190,y:60},[sticky,{...sticky,id:"occupied",geometry:{...sticky.geometry,y:-104}}],1)).toBeNull();});
});
