/** Bounded diagnostic projection. Never emits error messages, SQL, URLs or env. */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';
const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const CODES=new Set(['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_PACKAGE_PATH_NOT_EXPORTED','ERR_UNKNOWN_FILE_EXTENSION','ERR_REQUIRE_ESM','EADDRINUSE','EACCES','ENOENT','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','42501','28P01','3D000','42P01','42703','23503','23505']);
const PG_CODES:Record<string,string>={'53100':'disk_full','53200':'out_of_memory','53300':'too_many_connections','53400':'configuration_limit','57014':'query_canceled','57P01':'admin_shutdown','57P02':'crash_shutdown','57P03':'cannot_connect_now','08006':'connection_failure','54000':'program_limit','54001':'statement_too_complex','54011':'too_many_columns','42501':'insufficient_privilege','23505':'unique_violation','23503':'foreign_key_violation'};
for(const code of Object.keys(PG_CODES))CODES.add(code);
const TYPES=new Set(['Error','TypeError','ReferenceError','SyntaxError','RangeError','AggregateError']);
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function startupDiagnostic(error:unknown){
 const e=error instanceof Error?error:undefined;
 const message=e?.message??'',stack=e?.stack??'';
 const code=typeof (e as any)?.code==='string'?(e as any).code:'';
 const frames:{file:string;line:number;column:number}[]=[];
 for(const line of stack.slice(0,32768).split('\n').slice(1,25)){
  const match=line.match(/(?:\(|\s|file:\/\/)(\/[^\s()]+\.(?:ts|js|mjs|cjs)):(\d+):(\d+)\)?$/);
  if(!match)continue;
  const absolute=resolve(match[1]),local=relative(ROOT,absolute);
  if(local.startsWith('..'+sep)||!['apps/','packages/','tests/','scripts/','node_modules/'].some(p=>local.startsWith(p))||local.length>220||!existsSync(absolute))continue;
  frames.push({file:local,line:Number(match[2]),column:Number(match[3])});if(frames.length===6)break;
 }
 return {errorType:e&&TYPES.has(e.name)?e.name:(e?.name==='error'&&Object.hasOwn(PG_CODES,code)?'PostgresError':'Unknown'),errorCode:CODES.has(code)?code:null,postgresClass:Object.hasOwn(PG_CODES,code)?PG_CODES[code]:null,
  clientQueryReadTimeout:message==='Query read timeout',
  messageBytes:Buffer.byteLength(message),messageSha256:hash(message),stackBytes:Buffer.byteLength(stack),stackSha256:hash(stack),frames,
  categories:{moduleResolution:/Cannot find (module|package)|ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED/.test(message),
   dependencyInjection:/Nest can't resolve dependencies|UnknownDependenciesException/.test(message),
   connection:/ECONNREFUSED|Connection terminated|connect timeout/.test(message),
   configuration:/required|must be|missing|not configured/i.test(message)}};
}
