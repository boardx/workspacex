from pathlib import Path
import json,hashlib
out=Path(__file__).resolve().parent
root=out.parents[1]
summary=json.loads((out/'audit-summary.json').read_text())
cases=json.loads((out/'latest-audited-cases.json').read_text())
assert len(cases)==534 and len({item['key'] for item in cases})==534
counts={key:sum(item['outcome']==key for item in cases) for key in ['passed','failed','skipped','flaky','interrupted']}
assert counts==summary['latestSecondRound']=={'passed':526,'failed':0,'skipped':8,'flaky':0,'interrupted':0}
for name,digest in json.loads((out/'source-sha256.json').read_text()).items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
assert json.loads((out/'cleanup.json').read_text())['allReleased']
print('Evidence consistent: 534 unique; 526 passed; 8 existing skipped; source hashes match.')
