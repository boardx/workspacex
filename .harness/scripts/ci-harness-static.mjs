/** Preserve canonical static gates while reusing only the authoritative self-test verdict. */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const terminal='pnpm exec vitest run --config .harness/vitest.config.ts --dir .harness';
export function staticScripts(raw){
 if(typeof raw!=='string')throw Error('INVALID_CANONICAL_HARNESS');
 const commands=raw.split(' && ');
 if(commands.length<2||commands.pop()!==terminal)throw Error('UNKNOWN_HARNESS_TEST_PRODUCER');
 return commands.map(command=>{const match=/^pnpm run (lint:[a-z0-9-]+)$/.exec(command);if(!match)throw Error('UNKNOWN_STATIC_GATE');return match[1]});
}
export function runStatic(raw,run=execFileSync){
 for(const script of staticScripts(raw))run('pnpm',['run',script],{stdio:'inherit'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const pkg=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
 runStatic(pkg.scripts['verify:harness:raw']);
}
