import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,openSync,closeSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pinnedPythonBootstrap} from './fixed_transport';
test('isolated Python loads recursive source modules from retained descriptors and excludes ambient sibling code',()=>{
 const root=mkdtempSync(join(tmpdir(),'cn-pinned-python-'));const descriptors:number[]=[];
 try{
  const contents=["import cn_backup_package\nprint(cn_backup_package.VALUE)\ntry:\n import ambient_untrusted\nexcept ModuleNotFoundError:\n print('ambient-rejected')\nelse:\n raise RuntimeError('ambient-imported')\n",'import writer_fence\nVALUE=writer_fence.VALUE+1\n','VALUE=41\n'];
  for(const [i,source] of contents.entries()){const p=join(root,`${i}.py`);writeFileSync(p,source);descriptors.push(openSync(p,'r'));}
  writeFileSync(join(root,'ambient_untrusted.py'),"raise RuntimeError('ambient executed')\n");
  const result=spawnSync('/usr/bin/python3',['-I','-c',pinnedPythonBootstrap({cn_backup_package:'/proc/self/fd/12',writer_fence:'/proc/self/fd/13'})],{cwd:root,encoding:'utf8',env:{PATH:'/usr/bin:/bin',PYTHONPATH:root},stdio:['pipe','pipe','pipe','ignore','ignore','ignore','ignore','ignore','ignore','ignore',descriptors[0]!,'ignore',descriptors[1]!,descriptors[2]!]});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'42\nambient-rejected\n');
 }finally{for(const fd of descriptors)closeSync(fd);rmSync(root,{recursive:true,force:true});}
});
test('a closed dependency descriptor cannot silently fall back to an adjacent source module',()=>{
 const root=mkdtempSync(join(tmpdir(),'cn-pinned-python-'));let fd:number|undefined;
 try{const p=join(root,'entry.py');writeFileSync(p,'import cn_backup_package\n');writeFileSync(join(root,'cn_backup_package.py'),'VALUE=99\n');fd=openSync(p,'r');const result=spawnSync('/usr/bin/python3',['-I','-c',pinnedPythonBootstrap({cn_backup_package:'/proc/self/fd/12'})],{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe','ignore','ignore','ignore','ignore','ignore','ignore','ignore',fd]});assert.notEqual(result.status,0);assert.match(result.stderr,/FileNotFoundError/);}finally{if(fd!==undefined)closeSync(fd);rmSync(root,{recursive:true,force:true});}
});

import {persistentSourceModules} from './sealed_runtime';
import {pinnedPythonModuleFinder} from './fixed_transport';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
test('the complete real retained source-operation bundle imports through closed FDs without host actions',()=>{
 const vm=resolve(fileURLToPath(new URL('../../../../.harness/scripts/vm/',import.meta.url)));
 const modules:Record<string,string>={writer_fence:'writer_fence.py',control_connection:'control_connection.py',fixed_probes:'fixed_probes.py',host_transport:'host_transport.py',candidate_writer:'candidate_writer.py',candidate_backend_collector:'candidate_backend_collector.py',candidate_host_transport:'candidate_host_transport.py',...persistentSourceModules};
 const fds:number[]=[],map:Record<string,string>={};
 try{
  for(const [name,file] of Object.entries(modules)){map[name]=`/proc/self/fd/${fds.length+3}`;fds.push(openSync(join(vm,file),'r'));}
  const code='import sys,importlib.util,importlib.machinery\n'+pinnedPythonModuleFinder(map)+'\nimport importlib,json\nfor name in '+JSON.stringify(Object.keys(modules))+':\n importlib.import_module(name)\nprint(json.dumps(sorted('+JSON.stringify(Object.keys(modules))+')))\n';
  const result=spawnSync('/usr/bin/python3',['-I','-c',code],{cwd:'/tmp',encoding:'utf8',env:{PATH:'/usr/bin:/bin',PYTHONPATH:'/nonexistent'},stdio:['pipe','pipe','pipe',...fds]});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),Object.keys(modules).sort());
 }finally{fds.forEach(closeSync);}
});
