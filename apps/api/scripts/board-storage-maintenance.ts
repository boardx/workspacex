/** Trusted, explicit operator maintenance; no body bytes or credentials are printed. */
import {realpath,stat} from 'node:fs/promises';
import {archiveRootsOverlap} from '../src/infrastructure/whiteboard/maintenance-archive-paths';
import {BackupMaintenanceService,BackupMaintenanceError,MaintenanceRequest} from '../src/application/whiteboard/backup-maintenance';
import {PgBackupMaintenance} from '../src/infrastructure/whiteboard/pg-backup-maintenance';
import {PgDatabase} from '../src/infrastructure/db/pg-database';
import {appConfig} from '../src/infrastructure/db/pg-config';
import {FsObjectStore} from '../src/infrastructure/storage/fs-object-store';
import {toOrgId} from '../src/domain/org-id';
async function main(){
 if(process.env.BOARD_STORAGE_MAINTENANCE_OPERATOR!=='1')throw new BackupMaintenanceError('OPERATOR_OPT_IN_REQUIRED');
 const [action,...args]=process.argv.slice(2),options:Record<string,string>={};let execute=false;
 for(let i=0;i<args.length;i++){const key=args[i]!;if(key==='--execute'){if(execute)throw new BackupMaintenanceError('INVALID_ARGUMENT');execute=true;continue;}if(!['--org','--actor','--backup','--request','--board','--expected-epoch','--expected-seq','--target-version','--retention-days'].includes(key)||options[key]||!args[i+1])throw new BackupMaintenanceError('INVALID_ARGUMENT');options[key]=args[++i]!;}
 if(!options['--org']||!options['--actor'])throw new BackupMaintenanceError('EXPLICIT_SCOPE_REQUIRED');
 const request=MaintenanceRequest.parse(action==='release-pins'?{action,backupId:options['--backup'],requestId:options['--request'],retentionDays:Number(options['--retention-days']??30)}:{action,backupId:options['--backup'],requestId:options['--request'],boardId:options['--board'],expectedEpoch:Number(options['--expected-epoch']),expectedSeq:Number(options['--expected-seq']),targetVersion:Number(options['--target-version']??1)});
 if(!process.env.BOARD_OBJECT_ROOT||!process.env.BOARD_BACKUP_OBJECT_ROOT)throw new BackupMaintenanceError('OBJECT_ROOTS_REQUIRED');
 const primary=await realpath(process.env.BOARD_OBJECT_ROOT),archive=await realpath(process.env.BOARD_BACKUP_OBJECT_ROOT);
 if(archiveRootsOverlap(primary,archive)||!(await stat(primary)).isDirectory()||!(await stat(archive)).isDirectory()||((await stat(archive)).mode&0o077)!==0)throw new BackupMaintenanceError('INDEPENDENT_PRIVATE_ARCHIVE_REQUIRED');
 const db=new PgDatabase(appConfig());try{const result=await new BackupMaintenanceService(new PgBackupMaintenance(db),new FsObjectStore(primary),new FsObjectStore(archive)).run({orgId:toOrgId(options['--org']),userId:options['--actor']},request,execute);process.stdout.write(JSON.stringify(result)+'\n');}finally{await db.close();}
}
void main().catch(error=>{const code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^[A-Z_]{1,80}$/.test(error.code)?error.code:'BOARD_STORAGE_MAINTENANCE_FAILED';process.stderr.write(JSON.stringify({error:code})+'\n');process.exitCode=1;});
