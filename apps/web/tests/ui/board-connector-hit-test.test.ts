import {describe,it,expect,vi} from "vitest";
import {Canvas,Point} from "fabric";
import {connectorInteraction} from "@/components/whiteboard/fabric/connector-interaction";

describe("connector transparent bounding box regression",()=>{
 it("uses Fabric's actual target gate to pass transparent pixels through but retain rendered hits",()=>{
  const target={visible:true,evented:true,...connectorInteraction("connector")};
  const transparency=vi.fn(()=>true);
  const canvas={_pointIsInObjectSelectionArea:()=>true,viewportTransform:[1,0,0,1,0,0],isTargetTransparent:transparency};
  // Exact failing pointer in the connector rectangle, away from the visible line.
  expect(Canvas.prototype._checkTarget.call(canvas as unknown as Canvas,target as never,new Point(1227,688))).toBe(false);
  expect(transparency).toHaveBeenCalledWith(target,1227,688);
  // Rendered stroke, arrow tip and label use the same alpha hit path.
  transparency.mockReturnValue(false);
  for(const point of [new Point(1227,625),new Point(960,500),new Point(1161,594)])expect(Canvas.prototype._checkTarget.call(canvas as unknown as Canvas,target as never,point)).toBe(true);
 });
 it("endpoint-driven connectors remain transform locked; other objects keep their own policy",()=>{
  expect(connectorInteraction("connector")).toMatchObject({lockMovementX:true,lockMovementY:true,lockScalingX:true,lockScalingY:true,lockRotation:true,hasControls:false});
  expect(connectorInteraction("sticky")).toEqual({});
 });
});
