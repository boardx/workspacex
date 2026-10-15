import base from '../../../apps/web/playwright.chat-read.config';
import {productionCommand} from './next-production-command';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const servers=Array.isArray(base.webServer)?base.webServer:[];
const selected=servers.filter(s=>s.command.includes('NEXT_DIST_DIR=.next-chat-read-e2e next dev -p '));
if(selected.length!==1)throw Error('EXACT_NEXT_STARTUP_SHAPE_REQUIRED');
const build=productionCommand(selected[0]!,'build');
// No provider, API, browser or Playwright global setup is started in this phase.
const child=spawn(build.command,{shell:true,cwd:resolve(process.cwd(),'apps/web'),env:{...process.env,...build.env},stdio:'inherit'});
child.on('error',()=>{process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal==='SIGKILL'?137:1);});
