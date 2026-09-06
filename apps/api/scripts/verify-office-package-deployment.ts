/** Exercise the source-deployment layout used by the API systemd service. */
import { mkdtempSync, cpSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../../..');
const pkg=JSON.parse(readFileSync(join(root,'apps/api/package.json'),'utf8'));
assert.equal(pkg.scripts.start,'tsx src/main.ts');
assert.match(readFileSync(join(root,'.harness/scripts/vm/provision.sh'),'utf8'),/ExecStart=\/usr\/bin\/env pnpm --filter api run start/);
assert.match(readFileSync(join(root,'.harness/scripts/vm/deploy.sh'),'utf8'),/git reset --hard FETCH_HEAD/);
const dir=mkdtempSync(join(tmpdir(),'wx-office-source-release-'));
try {
 const scripts=join(dir,'scripts');
 cpSync(join(root,'apps/api/scripts/office-package-resources'),join(scripts,'office-package-resources'),{recursive:true});
 for(const file of ['office-skill-packages.ts','office-docs-skill-content.ts'])cpSync(join(root,'apps/api/scripts',file),join(scripts,file));
 symlinkSync(join(root,'apps/api/node_modules'),join(dir,'node_modules'),'dir');
 writeFileSync(join(dir,'package.json'),JSON.stringify({type:'module'}));
 writeFileSync(join(dir,'check.ts'),`import assert from 'node:assert/strict';
import {officeSkillPackage} from './scripts/office-skill-packages.ts';
import * as recipes from './scripts/office-docs-skill-content.ts';
for (const kind of ['docx','pptx','xlsx','pdf']) {
 const content=recipes[kind.toUpperCase()+'_CREATE_SKILL_MD'];
 const result=officeSkillPackage({skillId:kind,stableName:kind+'-create',content});
 assert.equal(result.package.files.length,3);
 assert(result.package.files.every(f=>Buffer.from(f.contentBase64,'base64').length>0));
 assert(!Buffer.from(result.package.files[0].contentBase64,'base64').toString().includes('risk_level:'));
}
console.log('FOUR_OFFICE_PACKAGES_SOURCE_RELEASE_RESOURCES_OK');`);
 process.stdout.write(execFileSync(join(root,'apps/api/node_modules/.bin/tsx'),[join(dir,'check.ts')],{cwd:dir,encoding:'utf8'}));
} finally {rmSync(dir,{recursive:true,force:true});}
