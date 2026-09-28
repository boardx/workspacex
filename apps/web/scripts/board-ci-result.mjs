/** A passing command alone is insufficient: zero tests/skips/retries cannot pass. */
export function assertBoardCiResults(report,expected){
 const specs=[];const walk=suites=>{for(const suite of suites??[]){specs.push(...suite.specs??[]);walk(suite.suites);}};walk(report.suites);
 const tests=specs.flatMap(s=>s.tests??[]);
 if(report.errors?.length||tests.length!==expected||tests.some(t=>t.expectedStatus!=='passed'||t.status!=='expected'||t.results?.length!==1||t.results[0].status!=='passed'||t.results[0].retry!==0))throw Error('CI_TEST_EXECUTION_INCOMPLETE');
}

/**
 * Preserve a useful, credential-free reason when Playwright exits non-zero.
 * The reporter intentionally strips titles, stdout and error text, so only
 * structural execution state is classified here.
 */
export function boardCiProducerFailureCode(report, expected) {
 const specs=[];const walk=suites=>{for(const suite of suites??[]){specs.push(...suite.specs??[]);walk(suite.suites);}};walk(report?.suites);
 const tests=specs.flatMap(spec=>spec.tests??[]),results=tests.flatMap(test=>test.results??[]);
 if(!tests.length)return report?.errors?.some(error=>error?.code==='PLAYWRIGHT_ERROR')?'REAL_PRODUCER_STARTUP_FAILED':'REAL_PRODUCER_NO_TESTS';
 if(tests.length!==expected||results.some(result=>result.status==='skipped')||tests.some(test=>!test.results?.length))return 'REAL_PRODUCER_INCOMPLETE';
 if(results.some(result=>result.status==='failed'||result.status==='timedOut'||result.status==='interrupted'))return 'REAL_PRODUCER_TEST_FAILED';
 return 'REAL_PRODUCER_FAILED';
}
