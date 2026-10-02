import {describe,expect,it} from "vitest";
import {Group,Textbox} from "fabric";
import {connectorLabelPlacement,resolveConnectorPath} from "@repo/whiteboard-core";
import {createFabricObject,applyCanonicalObject} from "@/components/whiteboard/fabric/board-fabric-surface";
import type {BoardFabricObject} from "@/components/whiteboard/fabric/board-fabric-object";

describe("independent multiline connector label bounds",()=>{
  it.each([undefined,{t:.6,normalOffset:20}])("sizes its background from actual text, not path bounds (%j)",labelPosition=>{
    const label="Connector label\n第二行";
    const connector={start:{x:100,y:100},end:{x:1200,y:300},fromAnchor:"right" as const,toAnchor:"left" as const,
      type:"curve" as const,startStyle:"none" as const,endStyle:"arrow" as const,lineStyle:"solid" as const,label,semanticRelation:"",labelPosition};
    const resolved=resolveConnectorPath(connector),record:BoardFabricObject={id:"label-edge",kind:"connector",revision:1,orderKey:"a",
      geometry:{...resolved.bounds,rotation:0},content:{text:label},style:{fill:"",textColor:"#222"},connector};
    const before=structuredClone(record),group=createFabricObject(record) as Group;
    applyCanonicalObject(group,record,false);
    const actual=group.getObjects().find(child=>child instanceof Textbox) as Textbox;
    const measurement=new Textbox(label,{fontSize:13,fontFamily:actual.fontFamily,fontWeight:actual.fontWeight,width:2000});
    const natural=Math.max(...measurement.textLines.map((_,index)=>measurement.getLineWidth(index)));
    expect(actual.width).toBeGreaterThanOrEqual(natural-.01);
    expect(actual.width).toBeLessThanOrEqual(natural+8);
    expect(actual.textLines).toHaveLength(2);
    const expected=connectorLabelPlacement(resolved,labelPosition).point,center=actual.getCenterPoint();
    expect(center.x).toBeCloseTo(expected.x,5);
    expect(center.y).toBeCloseTo(expected.y,5);
    expect(record).toEqual(before);
  });
  it("wraps long unbroken and multilingual labels within the label width limit without dropping text",()=>{
    const label="UnbrokenConnectorLabel".repeat(16)+"\n中文连接线标签".repeat(12);
    const connector={start:{x:100,y:100},end:{x:1200,y:300},fromAnchor:"right" as const,toAnchor:"left" as const,
      type:"straight" as const,startStyle:"none" as const,endStyle:"arrow" as const,lineStyle:"solid" as const,label,semanticRelation:""};
    const resolved=resolveConnectorPath(connector),record:BoardFabricObject={id:"long-label",kind:"connector",revision:1,orderKey:"a",
      geometry:{...resolved.bounds,rotation:0},content:{text:label},style:{fill:"",textColor:"#222"},connector};
    const group=createFabricObject(record) as Group;
    applyCanonicalObject(group,record,false);
    const actual=group.getObjects().find(child=>child instanceof Textbox) as Textbox;
    expect(actual.text).toBe(label);
    expect(actual.width).toBeLessThanOrEqual(240);
    expect(actual.textLines.length).toBeGreaterThan(label.split("\n").length);
    expect(Math.max(...actual.textLines.map((_,index)=>actual.getLineWidth(index)))).toBeLessThanOrEqual(actual.width+.01);
  });
});
