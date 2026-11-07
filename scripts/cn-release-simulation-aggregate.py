#!/usr/bin/env python3
"""Join exactly release + remaining from one acceptance run, never arbitrary shards."""
import argparse
import copy
import datetime as dt
import importlib.util
import json
import math
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cn_split_simulation', ROOT/'scripts/cn-release-simulation.py')
sim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sim)


def need(condition, code):
    if not condition: raise ValueError(code)


def read_pinned(path):
    # Paths are fixed below; refuse symlinked directories as well as files.
    need(not any(p.is_symlink() for p in (path, *path.parents)), 'ARTIFACT_SYMLINK')
    return sim.bounded_evidence(path, 16*1024*1024)


def read(path):
    return read_pinned(path)[0]


def stamp(text):
    value=dt.datetime.fromisoformat(text.replace('Z','+00:00'))
    need(value.tzinfo is not None,'TIMESTAMP_ZONE')
    return value


def clean(value, kind):
    return (isinstance(value,dict) and value.get('kind')==kind and value.get('verified') is True
            and type(value.get('populated')) is int and value['populated']==0 and value.get('removed') is True)


def validate(folder, sha, run_id, attempt, seed):
    need(bool(re.fullmatch('[a-f0-9]{40}',sha)) and bool(re.fullmatch('[1-9][0-9]*',run_id))
         and bool(re.fullmatch('[1-9][0-9]*',attempt)) and type(seed) is int and 0<=seed<=2**32-1,'IDENTITY_ARGUMENTS')
    need({p.name for p in folder.iterdir()}=={'release','remaining'},'EXACT_TWO_PARTS')
    used=0
    def load(path,pinned=False):
        nonlocal used
        used+=path.lstat().st_size
        need(used<=64*1024*1024,'REPORT_TOTAL_LIMIT')
        value=read_pinned(path)
        return value if pinned else value[0]
    rows=[]; case_ids=set(); files={}; starts=[]; finishes=[]; durations={}; parts=[]
    for part in ('release','remaining'):
        packet=folder/part; root=packet/'cn-simulation-artifacts'
        names={p.name for p in packet.iterdir()}
        allowed={'cn-simulation-artifacts'} | ({'cn-terminal-diagnostic.log'} if part=='release' else set())
        need('cn-simulation-artifacts' in names and names<=allowed,'PART_ARCHIVE_LAYOUT')
        summary,summary_digest=load(root/'summary.json',pinned=True); round_=load(root/'round-01/round.json')
        need(summary.get('kind')=='cn-release-isolated-simulation-v1' and summary.get('suiteSelection')==part,'PART_KIND')
        need((summary.get('commit'),summary.get('githubRunId'),summary.get('githubRunAttempt'),summary.get('baseSeed'))
             ==(sha,run_id,attempt,seed),'PART_IDENTITY')
        need(type(summary.get('requestedRounds')) is int and type(summary.get('completedRounds')) is int
             and type(summary.get('baseSeed')) is int and summary.get('requestedRounds')==summary.get('completedRounds')==1 and summary.get('mode')=='acceptance'
             and summary.get('status')==summary.get('testsStatus')==summary.get('exitStatus')=='passed'
             and summary.get('trackedChanges') is False and summary.get('productionAccepted') is False
             and summary.get('externalServiceMode')=='fixtures','PART_NOT_PASSED')
        need(summary.get('rounds')==[round_],'ROUND_REPORT_MISMATCH')
        need(type(round_.get('seed')) is int and round_.get('roundId')=='01' and round_.get('commit')==sha and round_.get('seed')==seed
             and round_.get('status')=='passed' and round_.get('sourceUnchanged') is True
             and round_.get('sourceStateBefore',{}).get('dirty') is False
             and round_.get('sourceStateAfter',{}).get('dirty') is False,'ROUND_IDENTITY_OR_SOURCE')
        outer=load(root/'simulation-outer-cleanup.json')
        need(clean(outer,'linux-systemd-owned-resource-cleanup'),'OUTER_CLEANUP_UNPROVEN')
        expected={'release'} if part=='release' else set(sim.SUITES)-{'release'}
        suites=round_['suites']; names=[r['suite'] for r in suites]
        need(len(names)==len(set(names)) and set(names)==expected,'SUITE_PARTITION')
        for row in suites:
            name=row['suite']; stats=row.get('statistics'); cleanup=row.get('cleanup')
            need(row.get('status')=='passed' and type(row.get('exitCode')) is int and row.get('exitCode')==0 and row.get('reason') is None
                 and clean(cleanup,'linux-cgroup-v2-owned-cleanup'),'SUITE_OR_CLEANUP_FAILED')
            if name in sim.DOCKER_SUITE_REGISTRIES:
                need(isinstance(row.get('dockerCleanup'),dict) and row['dockerCleanup'].get('verified') is True,'DOCKER_CLEANUP_UNPROVEN')
            need(row.get('casesEvidence')==name+'.tests.cases.json'
                 and row.get('inventoryEvidence')==name+'.tests.inventory.json','EVIDENCE_PATH')
            inv=load(root/'round-01'/row['inventoryEvidence']); cases=load(root/'round-01'/row['casesEvidence'])
            actual_stats=load(root/'round-01'/(name+'.tests.json'))
            keys={'tests','failures','errors','skipped','expectedFailures','unexpectedSuccesses'}
            need(isinstance(stats,dict) and stats==actual_stats and set(stats)==keys and all(type(v) is int and v>=0 for v in stats.values())
                 and stats['tests']>0 and all(stats[k]==0 for k in keys-{'tests'}),'STATISTICS')
            need(isinstance(inv,list) and isinstance(cases,list),'INVENTORY_TYPE')
            inventory_ids=[x['caseId'] for x in inv]; ids=[x['caseId'] for x in cases]
            need(len(ids)==len(set(ids))==len(inventory_ids)==len(set(inventory_ids))==stats['tests']
                 and set(ids)==set(inventory_ids) and not case_ids.intersection(ids),'CASE_INVENTORY_OR_DUPLICATE')
            need(all(isinstance(x,str) and x for x in ids) and all(x.get('status')=='pass' for x in cases),'CASE_NOT_PASSED')
            case_ids.update(ids); copied=copy.deepcopy(row)
            for key in ('casesEvidence','inventoryEvidence'):
                target='parts/'+part+'/'+row[key]; files[target]=copy.deepcopy(cases if key=='casesEvidence' else inv);copied[key]=target
            rows.append(copied)
        start,end=stamp(round_['startedAt']),stamp(round_['finishedAt'])
        duration=round_['durationSeconds']
        need(start<end and type(duration) in (int,float) and math.isfinite(duration) and duration>0,'DURATION')
        starts.append(start);finishes.append(end);durations[part]=duration
        parts.append(dict(part=part,summarySha256=summary_digest,suiteCount=len(suites)))
    need(len(rows)==len(sim.SUITES) and {r['suite'] for r in rows}==set(sim.SUITES),'COMPLETE_SUITE_INVENTORY')
    return dict(suites=rows,caseIds=sorted(case_ids),files=files,startedAt=min(starts).isoformat(),finishedAt=max(finishes).isoformat(),
                durationSeconds=round((max(finishes)-min(starts)).total_seconds(),3),partDurations=durations,parts=parts)


def aggregate(folder, output, sha, run_id, attempt, seed):
    value=validate(folder,sha,run_id,attempt,seed)
    output.mkdir(mode=0o700); rd=output/'round-01';rd.mkdir(mode=0o700)
    for name,contents in value['files'].items():
        target=rd/name;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        sim.write_json(target,contents)
    round_=dict(roundId='01',commit=sha,seed=seed,status='passed',sourceUnchanged=True,sourceStateBefore=dict(dirty=False),
                sourceStateAfter=dict(dirty=False),suites=value['suites'],startedAt=value['startedAt'],finishedAt=value['finishedAt'],
                durationSeconds=value['durationSeconds'],externalServiceMode='fixtures',integrationGaps=list(sim.GAPS))
    summary=dict(kind='cn-release-isolated-simulation-v1',suiteSelection='all',mode='acceptance',commit=sha,githubRunId=run_id,
                 githubRunAttempt=attempt,requestedRounds=1,completedRounds=1,baseSeed=seed,status='passed',testsStatus='passed',
                 exitStatus='passed',blockedReason=None,trackedChanges=False,rounds=[round_],startedAt=value['startedAt'],
                 finishedAt=value['finishedAt'],productionAccepted=False,externalServiceMode='fixtures',integrationGaps=list(sim.GAPS),
                 splitEvidence=dict(kind='cn-release-fixed-two-job-v1',parts=value['parts'],partDurations=value['partDurations'],
                                    caseCount=len(value['caseIds']),runnerSuiteSeconds=sum(value['partDurations'].values())))
    sim.write_json(rd/'round.json',round_);sim.quantify(summary,output);sim.write_json(output/'summary.json',summary);sim.render_reports(output)
    return summary


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--parts',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--sha',required=True);p.add_argument('--run-id',required=True);p.add_argument('--attempt',required=True);p.add_argument('--seed',type=int,required=True);a=p.parse_args()
    need(subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==a.sha,'AGGREGATOR_SOURCE')
    result=aggregate(a.parts,a.output,a.sha,a.run_id,a.attempt,a.seed)
    print(json.dumps(dict(status=result['exitStatus'],caseCounts=result['caseCounts'],productionAccepted=False)))
    return 0


if __name__=='__main__':raise SystemExit(main())
