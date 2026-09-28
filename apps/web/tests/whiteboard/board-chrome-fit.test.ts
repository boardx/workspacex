import {expect,it} from 'vitest';
import {fitBoardContent} from '@/components/whiteboard/board-chrome-fit';
it.each([1024,1280,1440])('fits the 30-note content inside visible chrome at %i',width=>{
 const bounds={left:-300,right:950,top:-50,bottom:746},height=900;
 const fitted=fitBoardContent(width,height,bounds,{left:32,right:32,top:96,bottom:224});
 expect(bounds.left*fitted.zoom+fitted.panX).toBeGreaterThanOrEqual(31.999);
 expect(bounds.right*fitted.zoom+fitted.panX).toBeLessThanOrEqual(width-31.999);
 expect(bounds.top*fitted.zoom+fitted.panY).toBeGreaterThanOrEqual(95.999);
 expect(bounds.bottom*fitted.zoom+fitted.panY).toBeLessThanOrEqual(height-223.999);
});
