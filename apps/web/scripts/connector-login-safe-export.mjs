import assert from 'node:assert/strict';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {basename,relative,isAbsolute} from 'node:path';
const title='C06 valid Connector permissions and held gesture authority lifecycle';
const keys=['stage','sourceHead','version','httpStatus','jsonParsed','objectSchema','actorString','tokenString','actorMatches','tokenMatches'].sort();
export function exportConnectorLoginDiagnostics(report,artifacts,head){
 assert.match(head,/^[a-f0-9]{40}$/);assert(Buffer.byteLength(JSON.stringify(report),'utf8')<=8*1024*1024,'C06_REPORT_TOO_LARGE');
 const directory=realpathSync(artifacts),rows=[],seen=new Set();let cases=0,nodes=0;
 function visit(suite){assert(++nodes<=1000,'C06_REPORT_TOO_LARGE');for(const spec of suite.specs??[]){
  const matches=basename(spec.file??'')==='board-connector-authority.spec.ts'&&spec.title===title;
  for(const test of spec.tests??[])for(const result of test.results??[]){
   const attachments=(result.attachments??[]).filter(item=>item.name==='c06-login-fixed-diagnostic');
   if(!matches){assert.equal(attachments.length,0,'C06_FOREIGN_CASE');continue;}
   cases++;if(attachments.length===0)throw Object.assign(new Error('C06_NOT_AVAILABLE'),{code:'C06_NOT_AVAILABLE'});assert(attachments.length<=5,'C06_EXCESS_RECEIPT');
   for(const item of attachments){assert.equal(item.contentType,'application/json');assert.equal(typeof item.path,'string');
    const path=realpathSync(item.path),inside=relative(directory,path);assert(inside&&!inside.startsWith('..')&&!isAbsolute(inside),'C06_FOREIGN_PATH');
    assert.match(basename(path),/^c06-login-[0-4]\.json$/);assert(!seen.has(path),'C06_DUPLICATE_RECEIPT');seen.add(path);
    const stat=statSync(path);assert(stat.isFile()&&stat.size>0&&stat.size<=4096,'C06_RECEIPT_SIZE');
    const row=JSON.parse(readFileSync(path,'utf8'));assert(JSON.stringify(Object.keys(row).sort())===JSON.stringify(keys),'C06_RECEIPT_FIELDS');assert.equal(row.stage,'C06_LOGIN');assert.equal(row.sourceHead,head,'C06_FOREIGN_SOURCE');assert.equal(row.version,1);
    assert(row.httpStatus===null||Number.isInteger(row.httpStatus)&&row.httpStatus>=100&&row.httpStatus<=599);
    for(const key of ['jsonParsed','objectSchema','actorString','tokenString','actorMatches','tokenMatches'])assert.equal(typeof row[key],'boolean');
    assert(!row.objectSchema||row.jsonParsed);assert(!row.actorString||row.objectSchema);assert(!row.tokenString||row.objectSchema);assert(!row.actorMatches||row.actorString);assert(!row.tokenMatches||row.tokenString);
    const code=row.httpStatus===null||row.httpStatus<200||row.httpStatus>=300?'C06_LOGIN_HTTP_NOT_OK':!row.jsonParsed?'C06_LOGIN_JSON_PARSE':!row.objectSchema||!row.actorString||!row.tokenString?'C06_LOGIN_JSON_SCHEMA':!row.actorMatches?'C06_LOGIN_FIXTURE_ACTOR':!row.tokenMatches?'C06_LOGIN_SESSION_TOKEN':'C06_LOGIN_MATCHED';
    rows.push({code,...row});
   }
  }
 }for(const nested of suite.suites??[])visit(nested);}
 visit(report);if(cases===0)throw Object.assign(new Error('C06_NOT_AVAILABLE'),{code:'C06_NOT_AVAILABLE'});assert.equal(cases,1,'C06_CASE_CARDINALITY');return {version:1,stage:'C06_LOGIN',sourceHead:head,diagnostics:rows};
}

export function safeConnectorLoginExport(report,artifacts,head){
 try{return {status:'EXPORTED',...exportConnectorLoginDiagnostics(report,artifacts,head)};}
 catch(error){return {version:1,stage:'C06_LOGIN',sourceHead:/^[a-f0-9]{40}$/.test(head)?head:null,status:error?.code==='C06_NOT_AVAILABLE'?'NOT_AVAILABLE':'EXPORT_INVALID',diagnostics:[]};}
}
