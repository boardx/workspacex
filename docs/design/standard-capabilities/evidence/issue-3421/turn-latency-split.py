"""#3421 的关键一算：同一个 run 内，读回预览图**之前/之后**的模型轮次耗时。

同 run 比较 = 同负载、同模型、同上下文以外的一切都相同，避免跨 run 比较被负载差异污染
（#3309 就是在 load≈50 下归因、load≈10 复测后结论反转）。
剔除写脚本/改脚本那几轮（它们是内容生成，长短由任务决定，不是上下文代价）。
"""
import json,statistics as st,sys,pathlib
labs=sys.argv[1:] or [p.name[:-14] for p in sorted(pathlib.Path('.').glob('*base*-timeline.json'))]
pre_all=[];post_all=[]
print(f"{'run':<12}{'preN':>6}{'preMean':>9}{'postN':>7}{'postMean':>10}{'ratio':>7}")
for lab in labs:
    d=json.load(open(f'{lab}-timeline.json'))
    gr=next(e['t'] for e in d['timeline'] if e['kind']=='graph_ready');prev=gr
    pre=[];post=[];seen=False
    for e in d['timeline']:
        if e['kind']!='node':continue
        if e['node']=='model':
            if not any(c['name'] in('write_file','edit_file') for c in e['toolCalls']):
                (post if seen else pre).append(e['t']-prev)
            prev=e['t']
        elif e['node']=='tools':
            if any(r['name']=='read_file' and r['contentChars']>30000 for r in e['toolResults']):seen=True
            prev=e['t']
    if pre and post:
        pre_all+=pre;post_all+=post
        print(f"{lab:<12}{len(pre):>6}{st.mean(pre):>9.1f}{len(post):>7}{st.mean(post):>10.1f}{st.mean(post)/st.mean(pre):>6.1f}x")
print(f"\nPOOLED pre  {st.mean(pre_all):.2f}s (n={len(pre_all)})")
print(f"POOLED post {st.mean(post_all):.2f}s (n={len(post_all)})")
print(f"RATIO {st.mean(post_all)/st.mean(pre_all):.1f}x")
