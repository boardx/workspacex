import {expect,it} from 'vitest';
import {NativeInputManifest,NativeSessionResolved,canonicalNativeInputs} from '../src/native-session-binding';
const input={attachmentId:'attachment',filename:'原始.csv',path:'/inputs/'+'a'.repeat(64)+'/original.csv',mediaType:'text/csv',sizeBytes:1,digest:'b'.repeat(64)};
it('preserves legacy empty inputs while refusing path and identity collisions',()=>{
 expect(NativeSessionResolved.parse({sessionId:'00000000-0000-4000-8000-000000000001',token:'c'.repeat(64),expiresAt:1,interruptOn:{},packageDigest:'d'.repeat(64)}).inputs).toEqual([]);
 expect(NativeInputManifest.safeParse([input,input]).success).toBe(false);
 expect(NativeInputManifest.safeParse([{...input,path:'/workspace/original.csv'}]).success).toBe(false);
 expect(NativeInputManifest.safeParse([{...input,path:'/inputs/'+'a'.repeat(64)+'/../file'}]).success).toBe(false);
});
it('canonical snapshot changes with content and is independent of input ordering',()=>{
 const other={...input,attachmentId:'other',path:'/inputs/'+'e'.repeat(64)+'/same.csv'};
 expect(canonicalNativeInputs([input,other])).toBe(canonicalNativeInputs([other,input]));
 expect(canonicalNativeInputs([input])).not.toBe(canonicalNativeInputs([{...input,digest:'f'.repeat(64)}]));
});
