// Usage: node edit-xlsx.cjs input.xlsx output.xlsx sheet cell JSON-value
const ExcelJS = require('exceljs');
(async () => {
 const [input, output, sheetName, cell, value] = process.argv.slice(2);
 if(input===output || !/^[A-Z]{1,3}[1-9][0-9]*$/.test(cell)) throw Error('Separate output and explicit cell required');
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(input);
 const sheet=workbook.getWorksheet(sheetName);if(!sheet)throw Error('Sheet not found');
 const parsed=JSON.parse(value);if(parsed!==null&&!['string','number','boolean'].includes(typeof parsed))throw Error('Only literal cell values supported');
 sheet.getCell(cell).value=parsed;workbook.calcProperties.fullCalcOnLoad=true;
 await workbook.xlsx.writeFile(output);
 console.log('Changed one literal cell. Formula recalculation requested on open, not performed. Complex Excel features may not roundtrip; inspect output.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
