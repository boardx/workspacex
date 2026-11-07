import type {z} from 'zod';
import type {AuxiliaryModelAdmission,AuxiliaryModelStart,AuxiliaryModelTerminal} from '@repo/contracts/auxiliary-model-accounting';
import type {OrgId} from '../../domain/org-id';
export const AUXILIARY_MODEL_ACCOUNTING=Symbol('AUXILIARY_MODEL_ACCOUNTING');
export interface AuxiliaryModelAccounting {
 admit(orgId:OrgId,id:string,input:Omit<z.infer<typeof AuxiliaryModelAdmission>,'orgId'>):Promise<void>;
 start(orgId:OrgId,id:string,input:Omit<z.infer<typeof AuxiliaryModelStart>,'orgId'>):Promise<void>;
 terminal(orgId:OrgId,id:string,input:Omit<z.infer<typeof AuxiliaryModelTerminal>,'orgId'>):Promise<void>;
}
