import {changedPaths} from './ci-change-scope.mjs';
const roots=/^(apps|packages|scripts|\.harness|skills|\.agents|patches)\//;
const inputs=new Set(['.github/workflows/skill-files-e2e.yml','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','turbo.json','.nvmrc','.npmrc']);
export const skillAffected=paths=>paths===null||paths.some(path=>roots.test(path)||inputs.has(path));
if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\','/'))){
 console.log(`changed=${skillAffected(changedPaths())}`);
}
