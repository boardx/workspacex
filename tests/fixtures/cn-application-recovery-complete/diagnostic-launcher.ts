import {diagnostic} from './diagnostic';
import {writeFileSync,lstatSync} from 'node:fs';
import {dirname,basename,resolve} from 'node:path';
try{await import('./lifecycle');}catch(error){
 const value=diagnostic(error);
 try{
  const root=dirname(resolve(process.argv[2]));const st=lstatSync(root);
  if(/^wsx-pg-fixture-/.test(basename(root))&&st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid!()&&(st.mode&0o777)===0o700)
   writeFileSync(root+'/failure-diagnostic.json',JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});
 }catch{/* Failure evidence must never overwrite an earlier original error. */}
 console.error('CN_APPLICATION_COMPLETE_DIAGNOSTIC '+JSON.stringify(value));process.exitCode=1;
}
