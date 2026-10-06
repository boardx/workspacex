import {describe,it,expect} from 'vitest';
import {insertionPlacement,insertionBounds} from '../../lib/board-insertion-placement';
const incoming=[{x:60,y:20,width:1500,height:800,rotation:0}];
describe('Board insertion placement',()=>{
  it('normalizes source coordinates to the origin for an empty board',()=>{
    expect(insertionPlacement([],incoming).recommended).toEqual({x:-60,y:-20});
  });
  it('places beside existing content including negative and rotated geometry',()=>{
    const existing=[{x:-500,y:-400,width:300,height:900,rotation:90}];
    const occupied=insertionBounds(existing),{recommended,source,view}=insertionPlacement(existing,incoming);
    expect(source.x+recommended.x).toBeGreaterThan(occupied.x+occupied.width);
    expect(view.x).toBeLessThan(occupied.x);expect(view.y).toBeLessThan(occupied.y);
    expect(view.x+view.width).toBeGreaterThan(source.x+recommended.x+source.width);
  });
});
