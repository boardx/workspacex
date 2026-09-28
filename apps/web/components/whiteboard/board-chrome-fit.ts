import {clampBoardZoom} from './fabric/board-fabric-object';
export type BoardFitInsets={left:number;right:number;top:number;bottom:number};
export function fitBoardContent(width:number,height:number,bounds:{left:number;right:number;top:number;bottom:number},insets:BoardFitInsets){
 const availableWidth=Math.max(1,width-insets.left-insets.right),availableHeight=Math.max(1,height-insets.top-insets.bottom);
 const zoom=clampBoardZoom(Math.min(availableWidth/Math.max(1,bounds.right-bounds.left),availableHeight/Math.max(1,bounds.bottom-bounds.top)));
 return {zoom,panX:insets.left+availableWidth/2-(bounds.left+bounds.right)/2*zoom,panY:insets.top+availableHeight/2-(bounds.top+bounds.bottom)/2*zoom};
}
