import {describe,it,expect} from 'vitest';
import {z} from 'zod';
import {BoardBackupError} from '../../src/application/whiteboard/board-backup';
import {jointDrillDiagnostic} from '../../scripts/board-joint-drill-diagnostics';
describe('joint drill safe stage diagnostics',()=>{
 it('identifies starter failures without exposing command stderr',()=>{expect(jointDrillDiagnostic('postgres-backup',new Error('POSTGRES_16_REQUIRED'))).toEqual({error:'BOARD_JOINT_DRILL_FAILED',stage:'postgres-backup',code:'POSTGRES_16_REQUIRED'});});
 it('does not stringify credentials, SQL, document text or nested errors',()=>{const secret='postgres://user:password@private/board-body';const error=Object.assign(new Error(secret),{code:'BAD_'+secret,detail:secret,cause:new Error(secret)});expect(JSON.stringify(jointDrillDiagnostic('capture-board',error))).not.toContain(secret);expect(jointDrillDiagnostic('capture-board',error).code).toBe('UNCLASSIFIED_FAILURE');});
 it('reports failed validation without Zod input or issue messages',()=>{const result=z.string().min(16,'credential-value-must-not-appear').safeParse('short-secret');expect(result.success).toBe(false);if(!result.success){const output=jointDrillDiagnostic('postgres-backup',result.error);expect(output.code).toBe('INVALID_CONFIGURATION_OR_MANIFEST');expect(JSON.stringify(output)).not.toMatch(/short-secret|credential-value/);}});
 it('retains known permission and file error codes with their stage',()=>{expect(jointDrillDiagnostic('restore-board',{code:'42501',message:'secret sql'}).code).toBe('42501');expect(jointDrillDiagnostic('prepare-directory',{code:'EEXIST',path:'secret path'}).code).toBe('EEXIST');expect(jointDrillDiagnostic('verify-blobs',new BoardBackupError('RESTORED_BLOB_MISMATCH')).code).toBe('RESTORED_BLOB_MISMATCH');});
});
