import {writeFileSync} from 'node:fs';
/** Deliberately omit config/env, test titles, stdout and error text from artifacts. */
export default class BoardCiReporter{
 tests=new Map();errors=[];
 onTestEnd(test,result){
  const row=this.tests.get(test.id)??{expectedStatus:test.expectedStatus,status:'unexpected',results:[]};
  row.results.push({status:result.status,retry:result.retry});row.status=result.status==='passed'?'expected':'unexpected';this.tests.set(test.id,row);
 }
 onError(){this.errors.push({code:'PLAYWRIGHT_ERROR'});}
 onEnd(result){
  if(result.status!=='passed')this.errors.push({code:'PLAYWRIGHT_NOT_PASSED'});
  if(!process.env.PLAYWRIGHT_JSON_OUTPUT_FILE)throw Error('CI_RESULT_PATH_REQUIRED');
  writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE,JSON.stringify({errors:this.errors,suites:[{specs:[{tests:[...this.tests.values()]}]}]})+'\n',{mode:0o600});
 }
}
