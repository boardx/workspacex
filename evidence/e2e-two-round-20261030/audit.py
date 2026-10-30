from pathlib import Path
import json,re,hashlib,datetime
out=Path('/Users/shenyangjun/.codex/worktrees/548a/workspacex/evidence/e2e-two-round-20261030')
lanes=['main','core','design','chat','profile'];attempts=[];rows=[]
required=[out/f'round-{r}'/f'{lane}-results.json' for r in (1,2) for lane in lanes]
required += [out/'round-2/main-resource-interrupted-results.json',out/'round-2/main-final-results.json',out/'round-2/edge-retest-results.json',out/'board-fix-results.json',out/'chat-retest-results.json',out/'steering-final-results.json']
missing=[str(path.relative_to(out)) for path in required if not path.exists()]
if missing:raise SystemExit('Private raw inputs absent; do not overwrite published audit. Read audit-summary.json / latest-audited-cases.json instead. Missing: '+', '.join(missing))

def read(path,round,lane,name,sha):
 if not path.exists():return []
 try:data=json.loads(path.read_text())
 except:return []
 cases=[]
 def walk(suites,parents=[]):
  for suite in suites:
   titles=parents+[suite.get('title','')]
   for spec in suite.get('specs',[]):
    for test in spec.get('tests',[]):
     results=test.get('results',[]);status=test.get('status','unexpected')
     outcome='interrupted' if any(x.get('status')=='interrupted' for x in results) else {'expected':'passed','unexpected':'failed','skipped':'skipped','flaky':'flaky'}.get(status,status)
     item={'round':round,'lane':lane,'attempt':name,'sha':sha,'file':Path(spec.get('file','')).name,'title':' > '.join(titles+[spec['title']]),'project':test.get('projectName'),'outcome':outcome,'durationMs':sum(x.get('duration',0) for x in results)}
     item['key']=' | '.join([item['file'],item['project'] or '',item['title']]);cases.append(item)
   walk(suite.get('suites',[]),titles)
 walk(data.get('suites',[]))
 counts={k:sum(c['outcome']==k for c in cases) for k in ['passed','failed','skipped','flaky','interrupted']}
 attempts.append({'round':round,'lane':lane,'name':name,'sha':sha,'results':str(path.relative_to(out)),'counts':counts,'globalErrors':len(data.get('errors',[])),'stats':data.get('stats',{}),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
 rows.extend(cases);return cases
baseline='d149a333b82604a2b2bcc68b5dd19bba81e7810e';final='fd242ec0922a3464ac808eaedff2efbb57ab78ef'
full={1:[],2:[]}
for r in (1,2):
 for lane in lanes:
  path=out/f'round-{r}'/f'{lane}-results.json'
  got=read(path,r,lane,f'round-{r}-{lane}',baseline)
  if not(r==2 and lane=='main'):full[r]+=got
read(out/'round-2/main-resource-interrupted-results.json',2,'main','resource-interrupted','605387c2e14f47f93890c4f5cf068ceebd266977')
full[2]+=read(out/'round-2/main-final-results.json',2,'main','main-complete','0f4189df7842b4ec6b19cf1646a15c6696ea7cba')
edge=read(out/'round-2/edge-retest-results.json',2,'main','edge-initial-retest','0f4189df7842b4ec6b19cf1646a15c6696ea7cba')
board=read(out/'board-fix-results.json',2,'main','board-fixed-retest',final)
chat=read(out/'chat-retest-results.json',2,'chat','chat-fixed-retest',final)
steering=read(out/'steering-final-results.json',2,'chat','steering-corrected-retest','623a350f7c9600287008090e9fe0afb43330afb2')
latest={x['key']:x for x in full[2]}
for x in edge+board+chat+steering:latest[x['key']]=x
counts=lambda cases:{k:sum(x['outcome']==k for x in cases) for k in ['passed','failed','skipped','flaky','interrupted']}
summary={'updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'firstRound':counts(full[1]),'secondRoundBeforeFocusedRetests':counts(full[2]),'latestSecondRound':counts(list(latest.values())),'attempts':attempts,'remaining':[x for x in latest.values() if x['outcome'] not in ['passed','skipped']]}
(out/'audit-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));(out/'audited-cases.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2));(out/'latest-audited-cases.json').write_text(json.dumps(list(latest.values()),ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in summary.items() if k not in ['attempts','remaining']},ensure_ascii=False));print('remaining',[(v['file'],v['title'],v['outcome']) for v in summary['remaining']])
