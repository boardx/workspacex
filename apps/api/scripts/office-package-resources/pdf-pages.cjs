// Usage: node pdf-pages.cjs input.pdf output.pdf 1,3,2
const fs=require('node:fs');const {PDFDocument}=require('pdf-lib');
(async()=>{
 const [input,output,selection]=process.argv.slice(2);if(input===output)throw Error('Separate output required');
 const source=await PDFDocument.load(fs.readFileSync(input));const pages=selection.split(',').map(Number);
 if(!pages.length||pages.some(n=>!Number.isInteger(n)||n<1||n>source.getPageCount()))throw Error('Invalid one-based page selection');
 const result=await PDFDocument.create();for(const page of await result.copyPages(source,pages.map(n=>n-1)))result.addPage(page);
 fs.writeFileSync(output,await result.save());console.log('Page content copied in requested order. Form/document metadata preservation is not promised; no redaction performed.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
