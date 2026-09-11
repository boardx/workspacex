import json,sys
print(f"{'label':<8}{'graph':>8}{'fixed':>8}{'scriptTurn':>12}{'execTot':>9}{'pngChars':>10}{'postPNG':>9}{'errs':>6}{'nTurns':>8}")
for lab in sys.argv[1:]:
    try: d=json.load(open(f'.perf-evidence/{lab}-timeline.json'))
    except: continue
    tl=d['timeline']; gr=next((e['t'] for e in tl if e['kind']=='graph_ready'),0)
    nodes=[e for e in tl if e['kind']=='node']
    prev=gr; script=0; execT=0; png=0; postPNG=0; errs=0; seen_png=False; turns=0
    for e in nodes:
        dur=e['t']-prev
        if e['node']=='model':
            turns+=1
            if any(c['name']=='write_file' for c in e['toolCalls']) and dur>script: script=dur
            if seen_png: postPNG+=dur
        if e['node']=='tools':
            for r in e['toolResults']:
                if r['name']=='execute': execT+=dur
                if r['name']=='read_file' and r['contentChars']>30000: png+=r['contentChars']; seen_png=True
                if r['status']=='error': errs+=1
        if e['node'].endswith('after_agent') and seen_png: postPNG+=dur
        prev=e['t']
    print(f"{lab:<8}{d['totalSeconds']:>8.1f}{gr:>8.1f}{script:>12.1f}{execT:>9.1f}{png:>10}{postPNG:>9.1f}{errs:>6}{turns:>8}")
