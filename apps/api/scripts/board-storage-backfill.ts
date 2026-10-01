/** Trusted operator; app_rw + fresh tenant/owner checks. No public arbitrary-principal API. */
import {readFile,realpath,stat} from 'node:fs/promises';
import {runStorageBackfill,StorageBackfillError} from '../src/application/whiteboard/storage-backfill';
import {PgStorageBackfill} from '../src/infrastructure/whiteboard/pg-storage-backfill';
import {PgWhiteboardCollaborationStore} from '../src/infrastructure/whiteboard/pg-collaboration-store';
import {PgWhiteboardCommentStore} from '../src/infrastructure/whiteboard/pg-whiteboard-comment-store';
import {WorkerWhiteboardUpdateValidator} from '../src/infrastructure/whiteboard/update-validator';
import {PgDatabase} from '../src/infrastructure/db/pg-database';
import {appConfig} from '../src/infrastructure/db/pg-config';
import {FsObjectStore} from '../src/infrastructure/storage/fs-object-store';
async function main(){
 if(process.env.BOARD_BACKFILL_OPERATOR!=='1')throw new StorageBackfillError('OPERATOR_OPT_IN_REQUIRED');
 const args=process.argv.slice(2),options:Record<string,string>={};let execute=false;
 for(let i=0;i<args.length;i++){const key=args[i]!;if(key==='--execute'){if(execute)throw new StorageBackfillError('INVALID_ARGUMENT');execute=true;continue;}if(!['--scope','--cursor','--board-limit','--row-limit','--delay-ms'].includes(key)||options[key]||!args[i+1])throw new StorageBackfillError('INVALID_ARGUMENT');options[key]=args[++i]!;}
 if(!options['--scope'])throw new StorageBackfillError('EXPLICIT_SCOPE_REQUIRED');
 const scopeStat=await stat(options['--scope']);if(!scopeStat.isFile()||scopeStat.size>4*1024*1024)throw new StorageBackfillError('INVALID_SCOPE_FILE');
 const scope:unknown=JSON.parse(await readFile(options['--scope'],'utf8'));
 if(!process.env.BOARD_OBJECT_ROOT)throw new StorageBackfillError('OBJECT_ROOT_REQUIRED');
 const root=await realpath(process.env.BOARD_OBJECT_ROOT);if(!(await stat(root)).isDirectory())throw new StorageBackfillError('OBJECT_ROOT_REQUIRED');
 const db=new PgDatabase(appConfig());try{const objects=new FsObjectStore(root),validator=new WorkerWhiteboardUpdateValidator(),collaboration=new PgWhiteboardCollaborationStore(db,validator,120,objects),comments=new PgWhiteboardCommentStore(db,validator,undefined,collaboration,objects);
  const result=await runStorageBackfill(new PgStorageBackfill(db,collaboration,comments),scope,{execute,cursor:options['--cursor'],...(options['--board-limit']?{boardLimit:Number(options['--board-limit'])}:{}),...(options['--row-limit']?{rowLimit:Number(options['--row-limit'])}:{}),...(options['--delay-ms']?{delayMs:Number(options['--delay-ms'])}:{})});
  process.stdout.write(JSON.stringify(result)+'\n');if(result.failures.length)process.exitCode=2;
 }finally{await db.close();}
}
void main().catch(error=>{process.stderr.write(JSON.stringify({error:error instanceof StorageBackfillError?error.code:'BOARD_STORAGE_BACKFILL_FAILED'})+'\n');process.exitCode=1;});
