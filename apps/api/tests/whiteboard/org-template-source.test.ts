import { expect, it } from 'vitest';
import { templateToModel, getTemplate, serializeTemplate } from '@repo/fabric-markdown/templates';
import { orgTemplateSpec } from '../../../../shared/canvas/org-template-spec';
import { artifactSourceMatchesLayout } from '../../src/domain/whiteboard/artifact-layout-source-verifier';
import type { CanvasTemplateListing } from '../../src/application/canvas/template-ports';

const row={key:'private-six-cell',displayName:'六格工作坊',version:1,title:'六格组织模板',layoutSource:'user-edited',gridCols:6,gridRows:8,sections:Array.from({length:6},(_,i)=>({sectionId:`s${i}`,name:`分区${i}`,type:'便利贴列表',order:i,required:false,capacity:3,layout:{col:(i%3)*2+1,row:Math.floor(i/3)*4+1,w:2,h:4,cols:1,max:3,tone:1,overflow:'缩小字号'}}))} as unknown as CanvasTemplateListing;
const code=serializeTemplate(templateToModel(`模板: ${row.key}\n\n## 分区0\n- 真实内容`,undefined,orgTemplateSpec(row)),orgTemplateSpec(row));
function layout(){
 const model=templateToModel(code,undefined,orgTemplateSpec(row));
 return {diagramKind:'template',objects:model.nodes.map(n=>({kind:'node',sourceId:n.id,text:n.label,geometry:{x:n.x-n.width/2,y:n.y-n.height/2,width:n.width,height:n.height},style:{shape:n.shape,direction:model.direction,modelMetaJson:JSON.stringify(model.meta),dataJson:JSON.stringify(n.data)}}))} as any;
}
it('expands a custom six-cell org template without polluting the process registry',()=>{
 const rendered=layout();
 expect(rendered.objects.filter((o:any)=>JSON.parse(o.style.dataJson).role==='section')).toHaveLength(6);
 const source=Buffer.from('```canvas\n'+code+'\n```');
 expect(code).not.toContain('#pink');
 expect(getTemplate(row.key)).toBeUndefined();
 expect(()=>templateToModel(code)).toThrow('未知画布模板');
 expect(artifactSourceMatchesLayout(source,rendered,[row])).toBe(true);
 expect(artifactSourceMatchesLayout(source,rendered,[])).toBe(false);
 expect(artifactSourceMatchesLayout(source,rendered,[{...row,title:'Other tenant title'}])).toBe(false);
 const changed=structuredClone(rendered);changed.objects[0].text='forged visible content';
 expect(artifactSourceMatchesLayout(source,changed,[row])).toBe(false);
 expect(getTemplate(row.key)).toBeUndefined();
});
