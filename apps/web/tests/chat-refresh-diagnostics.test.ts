import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
const {routeKind,safeChildLine,boundedWriter}=createRequire(import.meta.url)('../e2e/support/chat-refresh-diagnostic-core.cjs') as {
 routeKind:(url:string)=>string;safeChildLine:(line:string)=>object|null;boundedWriter:(path:string,limit?:number)=>(value:object)=>void;
};
it('retains fixed route categories without URI/query/thread identity',()=>{
 for(const [input,expected] of [['/identity/me?token=secret','identity'],['/chat/threads/private-thread/messages?body=secret','messages'],['/_next/static/chunks/app/chat/(v2)/layout.js?secret','chat-layout-chunk'],['/unknown/private/secret?token=secret','other']])expect(routeKind(input!)).toBe(expected);
});
it('drops arbitrary child output and retains only compile duration or failure category',()=>{
 expect(safeChildLine('Compiled /private?token=secret in 1.5s (123 modules)')).toEqual({event:'compiled',durationMs:1500});
 expect(safeChildLine('Error: SQL SELECT secret Authorization: secret')).toEqual({event:'child-error-line'});
 expect(safeChildLine('{"level":"info","token":"secret","query":"SELECT secret"}')).toBeNull();
 expect(safeChildLine('ready server https://secret.invalid')).toBeNull();
});
it('bounds log bytes including its truncation marker',()=>{
 const dir=mkdtempSync(join(tmpdir(),'chat-diag-unit-'));try{
  const path=join(dir,'bounded.jsonl'),write=boundedWriter(path,512);
  for(let i=0;i<100;i++)write({event:'request',route:'identity',id:i});
  expect(statSync(path).size).toBeLessThanOrEqual(512);
  const rows=readFileSync(path,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  expect(rows.at(-1)).toMatchObject({event:'truncated'});
  const existing=statSync(path).size,rebuilt=boundedWriter(path,512);
  for(let i=0;i<100;i++)rebuilt({event:'request',route:'identity',id:i});
  expect(statSync(path).size).toBeLessThanOrEqual(512);expect(statSync(path).size).toBe(existing);
  const alreadyFull=boundedWriter(path,existing);alreadyFull({event:'must-not-append'});expect(statSync(path).size).toBe(existing);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
