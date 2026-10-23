import {execFileSync} from 'node:child_process';
import {readFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function docSmokeScope({event,baseBranch,paths}) {
  if(event!=='pull_request'||baseBranch!=='develop'||!Array.isArray(paths)||!paths.length)return true;
  return !paths.every(path=>typeof path==='string'&&!path.split('/').some(part=>part==='..'||part==='.'||part==='')&&/^docs\/(?:design|superpowers\/plans)\/.+\.md$/.test(path));
}
export function inspectDocScope({event,baseBranch,base,git=args=>execFileSync('git',args,{encoding:'utf8'})}) {
  if(event!=='pull_request'||baseBranch!=='develop')return true;
  try {
    if(!/^[a-f0-9]{40}$/.test(base??'')||/^0+$/.test(base))return true;
    git(['merge-base','--is-ancestor',base,'HEAD']);
    const paths=git(['diff','--no-renames','--name-only','-z',base,'HEAD']).split('\0').filter(Boolean);
    if(docSmokeScope({event,baseBranch,paths}))return true;
    // Symlinks/submodules cannot masquerade as inert markdown. Include deleted paths at base.
    for(const ref of [base,'HEAD']) {
      const entries=git(['ls-tree','-r','-z',ref,'--',...paths]).split('\0').filter(Boolean);
      if(entries.some(entry=>!entry.startsWith('100644 blob ')))return true;
    }
    return false;
  } catch {return true;}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 let full=true;
 try {
  const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  full=inspectDocScope({event:process.env.GITHUB_EVENT_NAME,baseBranch:event.pull_request?.base?.ref,base:event.pull_request?.base?.sha});
 } catch {}
 const result=`full=${full}\n`;
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,result);
 console.log(result.trim());
}
