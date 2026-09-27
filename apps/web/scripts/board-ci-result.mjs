/** A passing command alone is insufficient: zero tests/skips/retries cannot pass. */
export function assertBoardCiResults(report,expected){
 const specs=[];const walk=suites=>{for(const suite of suites??[]){specs.push(...suite.specs??[]);walk(suite.suites);}};walk(report.suites);
 const tests=specs.flatMap(s=>s.tests??[]);
 if(report.errors?.length||tests.length!==expected||tests.some(t=>t.expectedStatus!=='passed'||t.status!=='expected'||t.results?.length!==1||t.results[0].status!=='passed'||t.results[0].retry!==0))throw Error('CI_TEST_EXECUTION_INCOMPLETE');
}
