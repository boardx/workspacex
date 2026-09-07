// Usage: node edit-xlsx.cjs input.xlsx output.xlsx sheet cell JSON-value
const ExcelJS = require('exceljs');
const fs = require('fs');
const JSZip = require('jszip');
function fail(code,message,unsupportedObjects=[]){console.error(JSON.stringify({code,message,unsupportedObjects}));process.exit(2)}
(async () => {
 const [input, output, sheetName, cell, value] = process.argv.slice(2);
 if(input===output || !/^[A-Z]{1,3}[1-9][0-9]*$/.test(cell)) fail('OFFICE_EDIT_INVALID_TARGET','Separate output and explicit cell required');
 const bytes=fs.readFileSync(input);if(bytes.length>25*1024*1024)fail('OFFICE_EDIT_STRUCTURE_LIMIT','Workbook exceeds 25 MiB');
 const zip=await JSZip.loadAsync(bytes);const names=Object.keys(zip.files);const unsupported=[];
 for(const [label,pattern] of [['macro',/vbaProject\.bin$/i],['signature',/_xmlsignatures\//i],['externalLink',/^xl\/externalLinks\//i],['pivot',/^xl\/pivot/i],['drawing',/^xl\/drawings\//i],['comment',/^xl\/comments/i]])if(names.some(name=>pattern.test(name)))unsupported.push(label);
 if(unsupported.length)fail('OFFICE_EDIT_UNSUPPORTED_OBJECT','Unsupported workbook objects make preservation unverifiable',unsupported);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(input);
 if(workbook.worksheets.length>100)fail('OFFICE_EDIT_STRUCTURE_LIMIT','Workbook has more than 100 worksheets');
 let populated=0;for(const worksheet of workbook.worksheets)worksheet.eachRow(row=>row.eachCell(()=>{populated+=1}));
 if(populated>1000000)fail('OFFICE_EDIT_STRUCTURE_LIMIT','Workbook has more than 1,000,000 populated cells');
 const sheet=workbook.getWorksheet(sheetName);if(!sheet)fail('OFFICE_EDIT_TARGET_NOT_FOUND','Sheet not found');
 let parsed;try{parsed=JSON.parse(value)}catch{fail('OFFICE_EDIT_INVALID_VALUE','Value must be valid JSON')}
 if(parsed!==null&&!['string','number','boolean'].includes(typeof parsed))fail('OFFICE_EDIT_UNSUPPORTED_VALUE','Only literal cell values are supported');
 sheet.getCell(cell).value=parsed;workbook.calcProperties.fullCalcOnLoad=true;
 await workbook.xlsx.writeFile(output);
 console.log(JSON.stringify({code:'OFFICE_EDIT_OK',sheet:sheetName,cell,recalculation:'requested_on_open_not_performed',visualInspection:'required'}));
})().catch(error=>fail('OFFICE_EDIT_FAILED',error.message));
