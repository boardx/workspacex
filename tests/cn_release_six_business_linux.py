"""Actual six full-application fixture journeys; parent CI must own recovery."""
import importlib.util
import json
import os
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
def main():
 if sys.platform!='linux'or os.geteuid()!=0 or os.environ.get('GITHUB_ACTIONS')!='true':raise RuntimeError('GITHUB_LINUX_ROOT_REQUIRED')
 spec=importlib.util.spec_from_file_location('six_session_actual',ROOT/'scripts/cn-release-six-session.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 titles=json.loads((ROOT/'tests/fixtures/cn-six-business/required-titles.json').read_bytes())
 images={'postgres':os.environ['CN_API_STARTUP_PG_IMAGE'],'redis':os.environ['CN_SIX_REDIS_IMAGE']}
 result=m.run_round(Path(os.environ['CN_SIX_OWNER_ROOT']),os.environ['GITHUB_RUN_ID'],os.environ['CN_SIX_ROUND_ID'],os.environ['CN_SIX_SOURCE_COMMIT'],dict(os.environ),images,titles)
 print(json.dumps(result,sort_keys=True));return 0 if result['verified']is True else 1
if __name__=='__main__':sys.exit(main())
