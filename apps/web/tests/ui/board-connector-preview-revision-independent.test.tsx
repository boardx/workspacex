import {render} from "@testing-library/react";
import {describe,expect,it,vi} from "vitest";
import {Group,Path,type Canvas} from "fabric";
import {connectorPathToSvg,resolveConnectorPath} from "@repo/whiteboard-core";
import type {BoardFabricObject} from "@/components/whiteboard/fabric/board-fabric-object";

const probe=vi.hoisted(()=>({canvas:null as Canvas|null,failNextPathGroup:false}));
vi.mock("fabric",async()=>{
  const actual=await vi.importActual<typeof import("fabric")>("fabric");
  return {...actual,Group:class extends actual.Group {
    constructor(...args:ConstructorParameters<typeof actual.Group>){
      if(probe.failNextPathGroup&&args[0]?.some(child=>child instanceof actual.Path)){
        probe.failNextPathGroup=false;throw new Error("one projection failure");
      }
      super(...args);
    }
  },Canvas:class extends actual.Canvas {
    constructor(...args:ConstructorParameters<typeof actual.Canvas>){super(...args);probe.canvas=this;}
  }};
});
vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});
import {BoardFabricSurface} from "@/components/whiteboard/fabric/board-fabric-surface";

describe("independent connector preview revision collision",()=>{
  it("restores remote canonical path when cancellation shares the last preview revision",()=>{
    const edge=(revision:number,y:number):BoardFabricObject=>{
      const connector={start:{x:100,y:100},end:{x:300,y:200},fromAnchor:"right" as const,toAnchor:"left" as const,
        type:"curve" as const,startStyle:"none" as const,endStyle:"arrow" as const,lineStyle:"solid" as const,label:"",semanticRelation:"",
        route:{kind:"curve" as const,startOffset:{x:70,y},endOffset:{x:-20,y:90}}};
      const path=resolveConnectorPath(connector);
      return{id:"edge",kind:"connector",revision,orderKey:"a",geometry:{...path.bounds,rotation:0},content:{text:""},style:{fill:"",textColor:"#222"},connector};
    };
    const baseline=edge(1,-60),preview=edge(3,20),remote=edge(3,-130);
    const props={selectedObjectIds:[],readOnly:false,tool:"select" as const,viewport:{zoom:1,panX:0,panY:0,fitRequest:0},
      onSelectionChange:vi.fn(),onObjectTransform:vi.fn(),onViewportChange:vi.fn()};
    const view=render(<BoardFabricSurface {...props} objects={[baseline]}/>);
    const renderedPath=()=> (probe.canvas!.getObjects()[0] as Group).getObjects().find(child=>child instanceof Path) as Path;
    const expected=(record:BoardFabricObject)=>new Path(connectorPathToSvg(resolveConnectorPath(record.connector!))).path;
    expect(renderedPath().path).toEqual(expected(baseline));
    view.rerender(<BoardFabricSurface {...props} objects={[preview]}/>);
    expect(renderedPath().path).toEqual(expected(preview));
    view.rerender(<BoardFabricSurface {...props} objects={[remote]}/>);
    expect(renderedPath().path).toEqual(expected(remote));
    const failedRecord=edge(4,50);
    probe.failNextPathGroup=true;
    view.rerender(<BoardFabricSurface {...props} objects={[failedRecord]}/>);
    expect((probe.canvas!.getObjects()[0] as Group).getObjects().some(child=>child instanceof Path)).toBe(false);
    const correctedRecord=edge(4,-90),canonicalBefore=structuredClone(correctedRecord);
    view.rerender(<BoardFabricSurface {...props} objects={[correctedRecord]}/>);
    expect(renderedPath().path).toEqual(expected(correctedRecord));
    expect(correctedRecord).toEqual(canonicalBefore);
    view.unmount();
  });
});
