import {describe,it,expect} from 'vitest';
import {WhiteboardConnector,WhiteboardConnectorRoute} from '../src/whiteboard-document';
describe('free arrow canonical route',()=>{
 it('accepts old connectors and bounded free nodes including two-point empty route',()=>{expect(WhiteboardConnector.safeParse({type:'straight',fromPoint:{x:0,y:0},toPoint:{x:10,y:10}}).success).toBe(true);for(const count of [0,64])expect(WhiteboardConnector.safeParse({type:'free',fromPoint:{x:0,y:0},toPoint:{x:10,y:10},route:{kind:'free',waypoints:Array.from({length:count},(_,x)=>({x,y:0}))}}).success).toBe(true);});
 it('rejects oversized, nonfinite, out-of-world, and mismatching routes',()=>{for(const waypoints of [Array.from({length:65},(_,x)=>({x,y:0})),[{x:Infinity,y:0}],[{x:1000001,y:0}]])expect(WhiteboardConnectorRoute.safeParse({kind:'free',waypoints}).success).toBe(false);expect(WhiteboardConnector.safeParse({type:'straight',route:{kind:'free',waypoints:[]},fromPoint:{x:0,y:0},toPoint:{x:10,y:0}}).success).toBe(false);});
});
