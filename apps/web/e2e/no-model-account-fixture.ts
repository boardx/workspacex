import {randomUUID} from 'node:crypto';
import {expect,type Page} from '@playwright/test';
import {readVerificationToken} from './core-loop-fixture';

/** Real registration owns the entire payer scope for negative model-activity assertions. */
export async function freshNoModelAccount(page:Page){
 const unique=randomUUID(),email=`no-model-${unique}@example.test`,password=`NoModel-${unique}!`;
 const registration=await page.request.post('/__fullstack_api/auth/register-open',{data:{orgName:`No-model audit ${unique}`,displayName:'Model activity auditor',email,password}});
 expect(registration.status()).toBe(201);
 const {orgId}=await registration.json() as {orgId:string};expect(orgId).toBeTruthy();
 const verification=await page.request.post('/__fullstack_api/auth/email-verifications/confirm',{data:{token:readVerificationToken(email).token}});
 expect(verification.ok()).toBe(true);
 return {orgId,email,password};
}
