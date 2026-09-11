import json,sys
for lab in sys.argv[1:]:
    d=json.load(open(f'.perf-evidence/{lab}-timeline.json'))
    tl=d['timeline']
    print(f"=== {lab}  wall={d['wallClockSeconds']:.1f}s graphTotal={d['totalSeconds']:.1f}s")
    gr=next((e['t'] for e in tl if e['kind']=='graph_ready'),0)
    print(f"  fixed overhead (to graph_ready): {gr:.1f}s")
    prev=gr; exec_total=0; errs=[]; calls=[]
    nodes=[e for e in tl if e['kind']=='node']
    for e in nodes:
        dur=e['t']-prev
        names=[c['name'] for c in e['toolCalls']]
        for r in e['toolResults']:
            if r['name']=='execute':
                exec_total+=0
            if r['status']=='error' or (r['name']=='execute' and 'Error' in str(r['content'])[:400]):
                errs.append((round(e['t'],1),r['name'],str(r['content'])[:500]))
        for c in e['toolCalls']:
            calls.append((c['name'],c['argChars']))
        print(f"  t={e['t']:7.1f} +{dur:6.1f}s node={e['node']:<12} calls={names} results={[(r['name'],r['status'],r['contentChars']) for r in e['toolResults']]}")
        prev=e['t']
    print("  --- tool call arg sizes ---")
    agg={}
    for n,c in calls: agg.setdefault(n,[]).append(c)
    for n,v in agg.items(): print(f"    {n}: n={len(v)} totalArgChars={sum(v)} max={max(v)}")
    print(f"  --- errors: {len(errs)}")
    for t,n,c in errs: print(f"    t={t} {n}: {c[:300]!r}")
