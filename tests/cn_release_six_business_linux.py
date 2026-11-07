"""Actual six full-application fixture journeys; parent CI must own recovery."""
import importlib.util
import json
import os
import re
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
def development_failure(result):
 diagnostic=result.get('diagnostic')or{};report=diagnostic.get('report')or{}
 if not(result.get('verified')is False and diagnostic.get('stage')=='application' and diagnostic.get('reason')=='SIX_APPLICATION_FAILED' and type(diagnostic.get('exitCode'))is int and diagnostic['exitCode']==1):return False
 if set(report)!={'reportAvailable','statistics','globalErrorCount','globalErrors'} or report['reportAvailable']is not True:return False
 stats=report['statistics'];errors=report['globalErrors']
 if not isinstance(stats,dict)or set(stats)!={'expected','unexpected','flaky','skipped','duration'}:return False
 if any(type(stats[k])is not int or stats[k]!=0 for k in ('expected','unexpected','flaky','skipped')):return False
 if type(stats['duration'])not in (int,float)or not 0<=stats['duration']<float('inf'):return False
 if type(report['globalErrorCount'])is not int or not 0<report['globalErrorCount']<=8 or not isinstance(errors,list)or len(errors)!=report['globalErrorCount']:return False
 return all(isinstance(e,dict)and set(e)=={'messageBytes','messageSha256','chatWarmup','budget300s'}and type(e['messageBytes'])is int and e['messageBytes']>0 and isinstance(e['messageSha256'],str)and re.fullmatch('[a-f0-9]{64}',e['messageSha256'])and e['chatWarmup']is True and e['budget300s']is True for e in errors)
def main():
 if sys.platform!='linux'or os.geteuid()!=0 or os.environ.get('GITHUB_ACTIONS')!='true':raise RuntimeError('GITHUB_LINUX_ROOT_REQUIRED')
 spec=importlib.util.spec_from_file_location('six_session_actual',ROOT/'scripts/cn-release-six-session.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 titles=json.loads((ROOT/'tests/fixtures/cn-six-business/required-titles.json').read_bytes())
 images={'postgres':os.environ['CN_API_STARTUP_PG_IMAGE'],'redis':os.environ['CN_SIX_REDIS_IMAGE']}
 result=m.run_round(Path(os.environ['CN_SIX_OWNER_ROOT']),os.environ['GITHUB_RUN_ID'],os.environ['CN_SIX_ROUND_ID'],os.environ['CN_SIX_SOURCE_COMMIT'],dict(os.environ),images,titles)
 # run_round has completed both application and session finally blocks.
 spec=importlib.util.spec_from_file_location('six_development_outcome',ROOT/'scripts/cn-release-development-outcome.py');outcome=importlib.util.module_from_spec(spec);spec.loader.exec_module(outcome)
 app=result.get('applicationCleanup')or{};session=result.get('sessionCleanup')or{};daemon=session.get('daemonCleanup')or{};lease=session.get('leaseCleanup')or{};diagnostic=result.get('diagnostic')or{}
 clean=app.get('verified')is True and app.get('populated')==0 and session.get('verified')is True and daemon.get('verified')is True and lease.get('verified')is True
 known=development_failure(result)
 outcome.write('linux-six-business',business_failure=known,inner_cleanup=clean,reason='known-business-failure' if known else 'not-continuable')
 print(json.dumps(result,sort_keys=True));return 0 if result['verified']is True else 1
if __name__=='__main__':sys.exit(main())
