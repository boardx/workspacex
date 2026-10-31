import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {changedPaths} from './ci-change-scope.mjs';
const roots=/^(apps|packages|scripts|\.harness|skills|\.agents|patches)\//;
const inputs=new Set(['.github/workflows/skill-files-e2e.yml','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','turbo.json','.nvmrc','.npmrc']);
export const skillAffected=paths=>paths===null||paths.some(path=>roots.test(path)||inputs.has(path));
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const output=`changed=${skillAffected(changedPaths())}\n`;
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,output);
 process.stdout.write(output);
}
