import type {z} from 'zod';
import type {NativeFileDelegationCheckInput,NativeFileDelegationCheckOutput} from '@repo/contracts/native-file-delegation';
export const NATIVE_FILE_DELEGATION=Symbol('NativeFileDelegation');
export interface NativeFileDelegation {
 check(runId:string,input:z.infer<typeof NativeFileDelegationCheckInput>):Promise<z.infer<typeof NativeFileDelegationCheckOutput>>;
}
