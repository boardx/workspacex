import { describe, expect, it } from 'vitest';
import { WhiteboardObject } from '../src/whiteboard-document';

const base = { id: 'edge', schemaVersion: 1 as const, kind: 'connector' as const, geometry: { x: 0, y: 0, width: 10, height: 10, rotation: 0 }, text: '', style: {}, parentId: null, orderKey: '' };
const style = { fromAnchor: 'right' as const, toAnchor: 'left' as const, type: 'straight' as const, startStyle: 'none' as const, endStyle: 'arrow' as const, lineStyle: 'solid' as const, label: '', semanticRelation: '' };

describe('whiteboard connector endpoints', () => {
  it('accepts attached and preserved-free endpoints', () => {
    expect(WhiteboardObject.safeParse({ ...base, connector: { ...style, from: 'a', to: 'b' } }).success).toBe(true);
    expect(WhiteboardObject.safeParse({ ...base, connector: { ...style, fromPoint: { x: 12, y: 34 }, to: 'b' } }).success).toBe(true);
  });
  it('bounds local offsets and requires an attached identity for each offset',()=>{
    const connector={...style,from:'participant',to:'other',fromOffset:{x:0,y:180},toOffset:{x:0,y:260}};
    expect(WhiteboardObject.safeParse({...base,connector}).success).toBe(true);
    expect(WhiteboardObject.safeParse({...base,connector:{...connector,from:undefined,fromPoint:{x:1,y:2}}}).success).toBe(false);
    expect(WhiteboardObject.safeParse({...base,connector:{...connector,toOffset:{x:Infinity,y:0}}}).success).toBe(false);
    expect(WhiteboardObject.safeParse({...base,connector:{...connector,toOffset:{x:0,y:1000001}}}).success).toBe(false);
  });
  it('rejects missing, ambiguous, and non-finite endpoint representations', () => {
    expect(WhiteboardObject.safeParse({ ...base, connector: { ...style, to: 'b' } }).success).toBe(false);
    expect(WhiteboardObject.safeParse({ ...base, connector: { ...style, from: 'a', fromPoint: { x: 1, y: 2 }, to: 'b' } }).success).toBe(false);
    expect(WhiteboardObject.safeParse({ ...base, connector: { ...style, fromPoint: { x: Number.NaN, y: 2 }, to: 'b' } }).success).toBe(false);
  });
});
