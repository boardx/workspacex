import { createRequire } from 'node:module';

const WORD_NAMESPACE='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// jsdom is an existing API runtime dependency. XML scripts/resources are never enabled.
const {JSDOM}=createRequire(import.meta.url)('jsdom') as {
  JSDOM:new(xml:string,options:{contentType:string})=>{window:{document:Document;close():void}};
};

/** Preserve paragraph/line boundaries but concatenate text runs within a word unchanged. */
export function docxParagraphText(xml:string):string {
  const dom=new JSDOM(xml,{contentType:'application/xml'});
  try {
    const paragraphs=Array.from(dom.window.document.getElementsByTagNameNS(WORD_NAMESPACE,'p'));
    return paragraphs.map(paragraph=>{
      const text:string[]=[];
      const visit=(node:Node):void=>{
        if(node.nodeType===1){
          const element=node as Element;
          if(element.namespaceURI===WORD_NAMESPACE){
            if(element.localName==='p' && element!==paragraph)return;
            if(element.localName==='t'){text.push(element.textContent??'');return;}
            if(element.localName==='br'||element.localName==='cr'){text.push('\n');return;}
            if(element.localName==='tab'){text.push('\t');return;}
          }
        }
        for(const child of Array.from(node.childNodes))visit(child);
      };
      visit(paragraph);return text.join('');
    }).join('\n');
  } finally {dom.window.close();}
}
