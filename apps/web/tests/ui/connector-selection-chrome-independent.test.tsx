import {describe,expect,it} from "vitest";
import {Group,ActiveSelection} from "fabric";
import {createFabricObject,applyCanonicalObject} from "@/components/whiteboard/fabric/board-fabric-surface";
import type {BoardFabricObject} from "@/components/whiteboard/fabric/board-fabric-object";

const base={id:"object",revision:1,orderKey:"a",geometry:{x:100,y:100,width:200,height:120,rotation:0},content:{text:""},style:{fill:"#F8D76E",textColor:"#222"}};
const edge:BoardFabricObject={...base,kind:"connector",connector:{start:{x:100,y:100},end:{x:300,y:220},fromAnchor:"right",toAnchor:"left",type:"straight",
  startStyle:"none",endStyle:"arrow",lineStyle:"solid",label:"",semanticRelation:""}};

describe("independent connector selection chrome",()=>{
  it("keeps connector selection targetable without generic blue border, resize or rotation controls",()=>{
    const projected=createFabricObject(edge);
    applyCanonicalObject(projected,edge,false);
    expect(projected.hasBorders).toBe(false);
    expect(projected.hasControls).toBe(false);
    expect(projected.selectable).toBe(true);
    expect(projected.evented).toBe(true);
    expect(projected.lockScalingX).toBe(true);expect(projected.lockScalingY).toBe(true);expect(projected.lockRotation).toBe(true);
  });
  it.each(["sticky","shape"] as const)("preserves %s single-object border and transformation controls",kind=>{
    const record:BoardFabricObject={...base,kind};
    const projected=createFabricObject(record);
    applyCanonicalObject(projected,record,false);
    expect(projected.hasBorders).toBe(true);expect(projected.hasControls).toBe(true);
    expect(projected.lockRotation).toBe(false);expect(projected.lockScalingX).toBe(false);
  });
  it("does not change Fabric multi-selection's generic selection chrome",()=>{
    const sticky=createFabricObject({...base,kind:"sticky"}),shape=createFabricObject({...base,id:"shape",kind:"shape",geometry:{...base.geometry,x:500}});
    const multi=new ActiveSelection([sticky,shape]);
    expect(multi.hasBorders).toBe(true);expect(multi.hasControls).toBe(true);
    expect(multi.getObjects()).toEqual([sticky,shape]);
    expect(sticky).toBeInstanceOf(Group);
  });
});
