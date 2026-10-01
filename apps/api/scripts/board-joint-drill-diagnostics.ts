import {ZodError} from 'zod';
import {BoardBackupError} from '../src/application/whiteboard/board-backup';
export type JointDrillStage='preflight'|'prepare-directory'|'capture-board'|'read-backup-root'|'postgres-backup'|'postgres-restore'|'verify-restored-root'|'restore-board'|'verify-canonical'|'verify-blobs'|'verify-comments'|'verify-pg-metadata'|'publish-evidence';
const safeToolErrors=new Set(['INVALID_BACKUP_TIMEOUT','BACKUP_TOOL_UNAVAILABLE','BACKUP_COMMAND_FAILED','POSTGRES_16_REQUIRED','UNSAFE_BACKUP_DIRECTORY','BACKUP_ALREADY_EXISTS','EMPTY_BACKUP','INVALID_BACKUP_MANIFEST','RESTORE_REQUIRES_NEW_DATABASE','UNSAFE_BACKUP_FILE','BACKUP_CHECKSUM_MISMATCH','BACKUP_CHANGED']);
const safeNativeCodes=new Set(['EEXIST','ENOENT','EACCES','EPERM','ENOSPC','ECONNREFUSED','ETIMEDOUT','28P01','42501','42P01','42703','23503','23505','3D000']);
/** Never return raw error messages, causes, Zod inputs, SQL, paths, env or child stderr. */
export function jointDrillDiagnostic(stage:JointDrillStage,error:unknown){
 let code='UNCLASSIFIED_FAILURE';
 if(error instanceof BoardBackupError&&/^[A-Z][A-Z_]{0,80}$/.test(error.code))code=error.code;
 else if(error instanceof ZodError)code='INVALID_CONFIGURATION_OR_MANIFEST';
 else if(error instanceof Error&&safeToolErrors.has(error.message))code=error.message;
 else if(error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&safeNativeCodes.has(error.code))code=error.code;
 return {error:'BOARD_JOINT_DRILL_FAILED',stage,code};
}
