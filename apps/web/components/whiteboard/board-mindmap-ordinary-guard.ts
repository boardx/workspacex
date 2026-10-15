import { readMindmapMetadata, type SpatialCommand, type WhiteboardCommand, type WhiteboardObject } from '@repo/whiteboard-core';
const deletionReason='操作未应用：选择或区域包含思维导图，请选中单个主题并使用删除分支；白板内容保持不变。';
const duplicateReason='操作未应用：暂不支持复制思维导图或包含它的区域，请使用导出与导入 Mermaid；白板内容保持不变。';
/** Container closure is independent of the tree relation. Both must be guarded. */
function containsMindmap(objects:readonly WhiteboardObject[],ids:readonly string[]):boolean{
  const closure=new Set(ids);let changed=true;
  while(changed){changed=false;for(const object of objects)if(object.parentId&&closure.has(object.parentId)&&!closure.has(object.id)){closure.add(object.id);changed=true;}}
  return objects.some(object=>closure.has(object.id)&&readMindmapMetadata(object)!==null);
}
export function ordinaryMindmapSpatialRejection(objects:readonly WhiteboardObject[],command:SpatialCommand):string|null{
  if(command.type==='duplicate-subgraph')return containsMindmap(objects,command.rootIds)?duplicateReason:null;
  if(command.type==='delete-object')return containsMindmap(objects,[command.id])?deletionReason:null;
  if(command.type==='delete-objects')return containsMindmap(objects,command.ids)?deletionReason:null;
  if(command.type==='delete-panel'&&command.children==='cascade')return containsMindmap(objects,[command.id])?deletionReason:null;
  if(command.type==='update-connector'){
    const object=objects.find(object=>object.id===command.id);
    if(object&&readMindmapMetadata(object)?.role==='edge'&&(object.connector?.from!==command.relationship.from||object.connector?.to!==command.relationship.to))return '请通过思维导图移动分支操作修改父子关系；白板内容保持不变。';
  }
  return null;
}
export function ordinaryMindmapCommandRejection(objects:readonly WhiteboardObject[],commands:readonly WhiteboardCommand[]):string|null{
  for(const command of commands){
    if(command.type==='create'){if(readMindmapMetadata(command.object))return '思维导图创建必须通过服务器结构命令。';continue;}
    const object=objects.find(object=>object.id===command.id);
    if(command.type==='delete'&&containsMindmap(objects,[command.id]))return deletionReason;
    if(!object||!readMindmapMetadata(object))continue;
    if(command.type==='restore')return '思维导图恢复必须通过服务器撤销操作。';
    if(command.type==='connector'&&(object.connector?.from!==command.connector.from||object.connector?.to!==command.connector.to))return '请通过思维导图移动分支操作修改父子关系；白板内容保持不变。';
    if(command.type==='extension'){
      const before=object.extensionData?.mindmap;
      const after=command.key==='mindmap'?command.value:command.extensionData!==undefined?command.extensionData?.mindmap:before;
      if(JSON.stringify(before)!==JSON.stringify(after))return '思维导图结构必须通过服务器结构命令。';
    }
  }
  return null;
}
