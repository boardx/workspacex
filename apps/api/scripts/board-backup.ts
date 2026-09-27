/** Trusted operator CLI. DB credentials confer authority; this is not a public principal-taking API. */
import { mkdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { z } from 'zod';
import { PgDatabase } from '../src/infrastructure/db/pg-database';
import { appConfig } from '../src/infrastructure/db/pg-config';
import { FsObjectStore } from '../src/infrastructure/storage/fs-object-store';
import { PgWhiteboardCollaborationStore } from '../src/infrastructure/whiteboard/pg-collaboration-store';
import { PgWhiteboardCommentStore } from '../src/infrastructure/whiteboard/pg-whiteboard-comment-store';
import { WorkerWhiteboardUpdateValidator } from '../src/infrastructure/whiteboard/update-validator';
import { PgBoardBackupRepository } from '../src/infrastructure/whiteboard/pg-board-backup';
import { BoardBackupService, BoardBackupError } from '../src/application/whiteboard/board-backup';
import { toOrgId } from '../src/domain/org-id';

async function main(){
  if(process.env.BOARD_BACKUP_OPERATOR!=='1')throw new BoardBackupError('OPERATOR_OPT_IN_REQUIRED');
  const [command,...args]=process.argv.slice(2);if(!['create','restore'].includes(command??''))throw new BoardBackupError('INVALID_COMMAND');
  const options:Record<string,string>={};for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!['--org','--actor','--board','--backup','--restore'].includes(key)||!value||options[key])throw new BoardBackupError('INVALID_ARGUMENT');options[key]=value;}
  const org=z.string().min(1).max(256).parse(options['--org']),actor=z.string().min(1).max(256).parse(options['--actor']),backupId=z.string().uuid().parse(options['--backup']);
  const source=process.env.BOARD_OBJECT_ROOT,archive=process.env.BOARD_BACKUP_OBJECT_ROOT;if(!source||!archive)throw new BoardBackupError('OBJECT_ROOTS_REQUIRED');
  const primary=await realpath(resolve(source));await mkdir(resolve(archive),{recursive:true,mode:0o700});const secondary=await realpath(resolve(archive));
  const contained=(a:string,b:string)=>{const r=relative(a,b);return r===''||(!r.startsWith('..')&&!isAbsolute(r));};
  if(contained(primary,secondary)||contained(secondary,primary)||!(await stat(primary)).isDirectory()||!(await stat(secondary)).isDirectory())throw new BoardBackupError('INDEPENDENT_BACKUP_ROOT_REQUIRED');
  if(((await stat(secondary)).mode&0o077)!==0)throw new BoardBackupError('PRIVATE_BACKUP_ROOT_REQUIRED');
  const database=new PgDatabase(appConfig());try{
    const objects=new FsObjectStore(primary),collaboration=new PgWhiteboardCollaborationStore(database,undefined,120,objects),repository=new PgBoardBackupRepository(database,collaboration,new PgWhiteboardCommentStore(database,new WorkerWhiteboardUpdateValidator(),undefined,collaboration,objects)),service=new BoardBackupService(repository,objects,new FsObjectStore(secondary)),p={orgId:toOrgId(org),userId:actor};
    const result=command==='create'?await service.backup(p,z.string().uuid().parse(options['--board']),backupId):await service.restore(p,backupId,z.string().uuid().parse(options['--restore']));
    process.stdout.write(JSON.stringify(result)+'\n');
  }finally{await database.close();}
}
void main().catch(error=>{process.stderr.write(JSON.stringify({error:error instanceof BoardBackupError?error.code:'BOARD_BACKUP_FAILED'})+'\n');process.exitCode=1;});
