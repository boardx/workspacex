// One source for PR/main change scope used by Board lanes and strict doctor.
// A missing base or unreadable diff is an error, never an empty change set.
import {execFileSync, spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const shaPattern=/^[a-f0-9]{40}$/;
const boardSegment=/^(?:board|whiteboard)(?:[-.].*)?$/i;

export function isBoardPath(path){
  if(path==='.github/workflows/board-acceptance.yml' || path==='.harness/scripts/ci-change-scope.mjs')return true;
  if(path.startsWith('phases/phase-19-') || path.startsWith('packages/fabric-markdown/'))return true;
  if(path.startsWith('apps/web/lib/live-board'))return true;
  if(!/^(?:apps|packages|\.harness)\//.test(path))return false;
  return path.split('/').some(segment=>boardSegment.test(segment));
}

export function phaseIdsForPaths(paths){
  const phases=new Set();
  for(const path of paths){
    const phase=/^phases\/phase-(\d{2})-/.exec(path)?.[1];
    if(phase)phases.add(phase);
    if(isBoardPath(path))phases.add('19');
  }
  return [...phases].sort();
}

function changedPaths(){
  const event=process.env.GITHUB_EVENT_NAME;
  const ref=process.env.GITHUB_REF;
  if(event==='workflow_dispatch' || (event==='push' && ref!=='refs/heads/main'))return null;
  if(!['pull_request','merge_group','push'].includes(event))throw new Error(`Unsupported CI event: ${event}`);
  const base=process.env.CI_SCOPE_BASE_SHA??'';
  if(!shaPattern.test(base) || /^0+$/.test(base))throw new Error('Missing valid CI change-scope base SHA');
  execFileSync('git',['cat-file','-e',`${base}^{commit}`]);
  execFileSync('git',['merge-base','--is-ancestor',base,'HEAD']);
  return execFileSync('git',['diff','--name-only','-z',base,'HEAD'],{encoding:'utf8'}).split('\0').filter(Boolean);
}

if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url){
  try{
    const mode=process.argv[2],paths=changedPaths();
    if(mode==='board'){
      const board=paths===null || paths.some(isBoardPath);
      console.error(`Board CI scope: ${board?'affected':'unaffected'} (${paths?.length??'manual/release'} changed paths)`);
      console.log(`board=${board}`);
    }else if(mode==='doctor' || mode==='doctor-soft'){
      const phases=paths===null?null:phaseIdsForPaths(paths);
      console.log(`${mode==='doctor'?'Strict':'Standard'} doctor scope: ${phases===null?'all phases':phases.length?phases.join(', '):'no affected phase'}`);
      for(const phase of phases??[null]){
        const args=['harness','doctor',...(mode==='doctor'?['--strict']:[]),...(phase?['--phase',phase]:[])];
        const result=spawnSync('pnpm',args,{stdio:'inherit'});
        if(result.error)throw result.error;
        if(result.status!==0)process.exitCode=result.status??1;
      }
    }else throw new Error(`Unknown CI change-scope mode: ${mode}`);
  }catch(error){console.error(error);process.exitCode=1;}
}
