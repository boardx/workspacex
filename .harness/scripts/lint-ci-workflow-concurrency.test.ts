import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
const load=(name:string)=>parse(readFileSync(`.github/workflows/${name}.yml`,'utf8'));
const evaluate=(expression:string|boolean,github:any)=>typeof expression==='boolean'?expression:Function('github','format',`return (${expression.replace(/^\$\{\{|\}\}$/g,'').trim()})`)(github,(s:string,...xs:any[])=>s.replace(/\{(\d+)\}/g,(_,i)=>String(xs[Number(i)])));
it('coalesces obsolete same-PR lightweight runs without cancelling other PRs or cumulative candidates',()=>{
 const w=load('harness-verify');expect(w.on.pull_request.branches).toEqual(['develop']);expect(w.on.merge_group.branches).toEqual(['develop']);expect(w.on.push).toBeUndefined();
 expect(w.concurrency.group).toBe('harness-verify-${{ github.ref }}');expect(w.concurrency.queue).toBe('single');
 for(const event_name of ['pull_request','merge_group'])expect(evaluate(w.concurrency['cancel-in-progress'],{event_name})).toBe(event_name==='pull_request');
});
it('retains one unfinished hourly full run and at most one pending snapshot, while explicit manual runs are distinct',()=>{
 const w=load('harness-acceptance'),c=w.concurrency;expect(c.queue).toBe('single');expect(c['cancel-in-progress']).toBe(false);
 const context=(event_name:string,run_id:number)=>({event_name,run_id});
 expect(evaluate(c.group,context('schedule',1))).toBe(evaluate(c.group,context('schedule',2)));
 expect(evaluate(c.group,context('workflow_dispatch',1))).not.toBe(evaluate(c.group,context('workflow_dispatch',2)));
 expect(evaluate(c.group,context('schedule',1))).not.toBe(evaluate(c.group,context('workflow_dispatch',1)));
});
it.each(['backend-gates','board-acceptance','skill-files-e2e','billing-cashier-glue'])('%s full work preserves unfinished requested producers without candidate triggers',name=>{
 const w=load(name);expect(w.on.pull_request).toBeUndefined();expect(w.on.merge_group).toBeUndefined();expect(w.on.workflow_call).toBeDefined();expect(w.concurrency['cancel-in-progress']).toBe(false);expect(w.concurrency.group).toContain('${{ github.run_id }}');expect(w.concurrency.queue).toBe('single');
});
