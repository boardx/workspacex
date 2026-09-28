/** Selection is not connection intent: multi-select must not paint four anchors
 * on every object. Touch users can select one object or enter connector mode. */
export function showConnectionHandles(input:{id:string;kind:string;locked?:boolean;selected:readonly string[];hovered:string|null;connecting:boolean;sourceId:string|null;readOnly:boolean;selectTool:boolean}):boolean{
 if(input.readOnly||!input.selectTool||input.locked||['connector','group','panel','placeholder'].includes(input.kind))return false;
 return input.connecting||input.sourceId===input.id||input.hovered===input.id||(input.selected.length===1&&input.selected[0]===input.id);
}
