import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("drawing isolated ink cache", () => {
  it("renders round caps beyond the canonical frame without erasing other objects", () => {
    const result = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { StaticCanvas, Group, Path, Rect, FixedLayout, Point, util } from "fabric/node";
      import { drawingStrokePath } from "./components/whiteboard/fabric/drawing-stroke-path.ts";
      import { preserveDrawingInkCache } from "./components/whiteboard/fabric/drawing-cache-bounds.ts";
      const points = [{x:0,y:0,pressure:1},{x:300,y:0,pressure:1}];
      const ink = new Path(drawingStrokePath(points,20),{fill:"blue",strokeWidth:0});
      const group = new Group([ink],{objectCaching:true});
      group.set({width:300,height:1});
      group.layoutManager.strategy = new FixedLayout();
      group.layoutManager.performLayout({type:"imperative",target:group,overrides:{size:new Point(300,1),center:group.getRelativeCenterPoint()}});
      ink.set({left:ink.pathOffset.x-150,top:ink.pathOffset.y-.5,originX:"center",originY:"center"});
      group.set({left:100,top:100,originX:"left",originY:"top"});
      const canvas = new StaticCanvas(null,{width:1000,height:700});
      canvas.add(group);canvas.renderAll();
      const pixel=(x,y)=>Array.from(canvas.getContext().getImageData(x,y,1,1).data);
      const cropped=[pixel(95,100)[3],pixel(405,100)[3]];
      preserveDrawingInkCache(group);group.dirty=true;canvas.renderAll();
      const caps=[pixel(95,100)[3],pixel(405,100)[3]];
      const outside=[pixel(88,100)[3],pixel(412,100)[3]];
      const thickness=[pixel(250,95)[3],pixel(250,105)[3],pixel(250,112)[3]];
      const erase=new Path(drawingStrokePath([{x:140,y:-15,pressure:1},{x:140,y:15,pressure:1}],20),{fill:"black",strokeWidth:0,globalCompositeOperation:"destination-out"});
      group.add(erase);
      erase.set({left:erase.pathOffset.x-150,top:erase.pathOffset.y-.5,originX:"center",originY:"center"});
      canvas.insertAt(0,new Rect({left:0,top:0,width:1000,height:700,fill:"red",strokeWidth:0,originX:"left",originY:"top"}));
      group.dirty=true;canvas.renderAll();
      const erased= pixel(240,100);
      group.set({left:200,top:50,scaleX:1.5,scaleY:1.5,angle:37});
      canvas.setViewportTransform([1.2,0,0,1.2,0,0]);
      canvas.renderAll();
      const rotatedPixel=(x,y)=>{
        const world=util.transformPoint(new Point(x,y),group.calcTransformMatrix());
        const screen=util.transformPoint(world,canvas.viewportTransform);
        return pixel(Math.round(screen.x),Math.round(screen.y));
      };
      const rotatedCaps=[rotatedPixel(-155,-.5),rotatedPixel(155,-.5)];
      const rotatedOutside=[rotatedPixel(-162,-.5),rotatedPixel(162,-.5)];
      console.log(JSON.stringify({cropped,caps,outside,thickness,erased,rotatedCaps,rotatedOutside,geometry:[group.width,group.height],cache:group.objectCaching}));
      canvas.dispose();
    `], { encoding: "utf8" }));
    expect(result.cropped).toEqual([0, 0]);
    expect(result.caps).toEqual([255, 255]);
    expect(result.outside).toEqual([0, 0]);
    expect(result.thickness).toEqual([255, 255, 0]);
    expect(result.erased).toEqual([255, 0, 0, 255]);
    expect(result.rotatedCaps).toEqual([[0, 0, 255, 255], [0, 0, 255, 255]]);
    expect(result.rotatedOutside).toEqual([[255, 0, 0, 255], [255, 0, 0, 255]]);
    expect(result.geometry).toEqual([300, 1]);
    expect(result.cache).toBe(true);
  });
});
