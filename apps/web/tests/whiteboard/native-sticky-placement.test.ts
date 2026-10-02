import {describe,it,expect} from 'vitest';
import {nativeBlankCandidates} from '../../e2e/support/board-native-sticky-create';

describe('native Sticky click placement',()=>{
  const canvas={x:0,y:64,width:320,height:656},viewport={width:320,height:720};
  it('finds a real narrow-screen click without requiring a future tile footprint',()=>{
    const points=nativeBlankCandidates({canvas,viewport,occupied:[],chrome:[]});
    expect(points.length).toBeGreaterThan(0);expect(points.every(p=>p.x>0&&p.x<320&&p.y>64&&p.y<720)).toBe(true);
  });
  it('rejects chrome and projected rotated-object bounding boxes',()=>{
    const chrome=[{x:0,y:64,width:160,height:656}],occupied=[{x:160,y:64,width:160,height:300}];
    const points=nativeBlankCandidates({canvas,viewport,occupied,chrome});
    expect(points.length).toBeGreaterThan(0);expect(points.every(p=>p.x>160&&p.y>376)).toBe(true);
  });
  it('cannot invent a blank point when chrome covers the entire real canvas',()=>{
    expect(nativeBlankCandidates({canvas,viewport,occupied:[],chrome:[canvas]})).toEqual([]);
  });
  it('clips offscreen canvas bounds to the actual viewport',()=>{
    const points=nativeBlankCandidates({canvas:{x:-200,y:-100,width:600,height:1000},viewport,occupied:[],chrome:[]});
    expect(points.every(p=>p.x>=8&&p.x<312&&p.y>=8&&p.y<712)).toBe(true);
  });
});
