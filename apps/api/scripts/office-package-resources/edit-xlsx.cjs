// Usage: node edit-xlsx.cjs input.xlsx output.xlsx sheet cell JSON-value
const fs = require('fs');
const JSZip = require('jszip');
function fail(code,message,unsupportedObjects=[]){console.error(JSON.stringify({code,message,unsupportedObjects}));process.exit(2)}
const escRe=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const escXml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const unescXml=value=>value.replaceAll('&quot;','"').replaceAll('&apos;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
const setAttr=(tag,name,value)=>new RegExp(`\\s${name}="[^"]*"`).test(tag)?tag.replace(new RegExp(`(\\s${name}=")[^"]*(")`),`$1${value}$2`):tag.endsWith('/>')?tag.replace(/\/>$/,` ${name}="${value}"/>`):tag.replace(/>$/,` ${name}="${value}">`);
(async () => {
 const [input, output, sheetName, cell, value] = process.argv.slice(2);
 if(input===output || !/^[A-Z]{1,3}[1-9][0-9]*$/.test(cell)) fail('OFFICE_EDIT_INVALID_TARGET','Separate output and explicit cell required');
 const bytes=fs.readFileSync(input);if(bytes.length>25*1024*1024)fail('OFFICE_EDIT_STRUCTURE_LIMIT','Workbook exceeds 25 MiB');
 const zip=await JSZip.loadAsync(bytes);const names=Object.keys(zip.files);const unsupported=[];
 for(const [label,pattern] of [['macro',/vbaProject\.bin$/i],['signature',/_xmlsignatures\//i],['externalLink',/^xl\/externalLinks\//i],['pivot',/^xl\/pivot/i],['drawing',/^xl\/drawings\//i],['comment',/^xl\/comments/i]])if(names.some(name=>pattern.test(name)))unsupported.push(label);
 if(unsupported.length)fail('OFFICE_EDIT_UNSUPPORTED_OBJECT','Unsupported workbook objects make preservation unverifiable',unsupported);
 let parsed;try{parsed=JSON.parse(value)}catch{fail('OFFICE_EDIT_INVALID_VALUE','Value must be valid JSON')}
 if(parsed!==null&&!['string','number','boolean'].includes(typeof parsed))fail('OFFICE_EDIT_UNSUPPORTED_VALUE','Only literal cell values are supported');
 const workbook=await zip.file('xl/workbook.xml')?.async('string'),rels=await zip.file('xl/_rels/workbook.xml.rels')?.async('string');if(!workbook||!rels)fail('OFFICE_EDIT_INVALID_ARCHIVE','Workbook metadata missing');
 const sheetTags=[...workbook.matchAll(/<sheet\b[^>]*\/>/g)];if(sheetTags.length>100)fail('OFFICE_EDIT_STRUCTURE_LIMIT','Workbook has more than 100 worksheets');const sheetTag=sheetTags.find(match=>unescXml(match[0].match(/\bname="([^"]*)"/)?.[1]??'')===sheetName)?.[0];if(!sheetTag)fail('OFFICE_EDIT_TARGET_NOT_FOUND','Sheet not found');
 const rid=sheetTag.match(/\br:id="([^"]+)"/)?.[1],relationship=rid&&[...rels.matchAll(/<Relationship\b[^>]*\/>/g)].find(match=>match[0].match(/\bId="([^"]+)"/)?.[1]===rid)?.[0],target=relationship?.match(/\bTarget="([^"]+)"/)?.[1];if(!target)fail('OFFICE_EDIT_INVALID_ARCHIVE','Worksheet relationship missing');
 const sheetPath=('xl/'+target.replace(/^\//,'')).replace('xl/xl/','xl/'),sheetXml=await zip.file(sheetPath)?.async('string');if(!sheetXml)fail('OFFICE_EDIT_INVALID_ARCHIVE','Worksheet part missing');if((sheetXml.match(/<c\b/g)??[]).length>1000000)fail('OFFICE_EDIT_STRUCTURE_LIMIT','Workbook has more than 1,000,000 populated cells');
 const cellPattern=new RegExp(`<c\\b([^>]*\\br="${escRe(cell)}"[^>]*)>([\\s\\S]*?)<\\/c>`),match=sheetXml.match(cellPattern);if(!match)fail('OFFICE_EDIT_TARGET_NOT_FOUND','Cell not found');const attrs=(match[1]??'').replace(/\s+t="[^"]*"/g,''),body=parsed===null?'':typeof parsed==='string'?`<is><t xml:space="preserve">${escXml(parsed)}</t></is>`:`<v>${typeof parsed==='boolean'?(parsed?'1':'0'):String(parsed)}</v>`,type=typeof parsed==='string'?' t="inlineStr"':typeof parsed==='boolean'?' t="b"':'';zip.file(sheetPath,sheetXml.replace(cellPattern,`<c${attrs}${type}>${body}</c>`));
 let nextWorkbook=workbook;if(/<calcPr\b[^>]*\/?\s*>/.test(workbook))nextWorkbook=workbook.replace(/<calcPr\b[^>]*\/?\s*>/,tag=>setAttr(tag,'fullCalcOnLoad','1'));else nextWorkbook=workbook.replace('</workbook>','<calcPr fullCalcOnLoad="1"/></workbook>');zip.file('xl/workbook.xml',nextWorkbook);fs.writeFileSync(output,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}}));
 console.log(JSON.stringify({code:'OFFICE_EDIT_OK',sheet:sheetName,cell,recalculation:'requested_on_open_not_performed',visualInspection:'required'}));
})().catch(error=>fail('OFFICE_EDIT_FAILED',error.message));
