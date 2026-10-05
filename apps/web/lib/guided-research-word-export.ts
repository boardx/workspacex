/** Export only the current confirmed demo outline, summary and retained citations. */
export interface GuidedResearchWordInput {
 readonly title:string;
 readonly sections:readonly {readonly title:string}[];
 readonly summary:string;
 readonly citations:readonly {readonly label:string;readonly url:string}[];
}
export async function buildGuidedResearchWord(input:GuidedResearchWordInput):Promise<Blob>{
 const snapshot=structuredClone(input);
 const {Document,Packer,Paragraph,TextRun,HeadingLevel,Table,TableRow,TableCell,WidthType,TableLayoutType}=await import('docx');
 const paragraph=(text:string)=>new Paragraph({children:[new TextRun(text)],spacing:{after:160,line:360}});
 const heading=(text:string)=>new Paragraph({text,heading:HeadingLevel.HEADING_1,keepNext:true});
 const bodyWidth=11906-1440*2,columnWidths=[1800,7226];
 const children:(InstanceType<typeof Paragraph>|InstanceType<typeof Table>)[]=[new Paragraph({text:snapshot.title,heading:HeadingLevel.TITLE}),
  paragraph('演示报告：仅包含当前已确认的大纲、摘要和已保留的演示来源，不代表真实检索或研究结论。'),
  heading('目录'),...snapshot.sections.map((section,index)=>paragraph(`${index+1}. ${section.title}`)),
  heading('摘要'),paragraph(snapshot.summary||'尚未提供摘要。'),
  heading('已确认章节大纲'),...snapshot.sections.map(section=>paragraph(section.title)),
  heading('来源与引用')];
 const rows=snapshot.citations.map((citation,index)=>[String(index+1),`${citation.label}\n${citation.url}`]);
 if(rows.length)children.push(new Table({width:{size:bodyWidth,type:WidthType.DXA},layout:TableLayoutType.FIXED,columnWidths,
  rows:[['序号','当前已保留的演示来源'],...rows].map(row=>new TableRow({children:row.map((text,index)=>new TableCell({width:{size:columnWidths[index]!,type:WidthType.DXA},children:text.split('\n').map(paragraph)}))}))}));
 else children.push(paragraph('没有已保留的演示来源。'));
 return Packer.toBlob(new Document({styles:{default:{document:{run:{font:'Arial Unicode MS',size:22}}}},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1440,bottom:1440,left:1440,right:1440}}},children}]}));
}
