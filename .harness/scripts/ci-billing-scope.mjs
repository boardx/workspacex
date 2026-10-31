import {appendFileSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {changedPaths} from './ci-change-scope.mjs';
const patterns=JSON.parse(readFileSync(new URL('../config/ci-billing-paths.json',import.meta.url),'utf8'));
const regexes=patterns.map(pattern=>new RegExp('^'+pattern.split('**').map(part=>part.split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[^/]*')).join('.*')+'$'));
export const billingAffected=paths=>paths===null||paths.some(path=>regexes.some(re=>re.test(path)));
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const output=`changed=${billingAffected(changedPaths())}\n`;
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,output);
 process.stdout.write(output);
}
