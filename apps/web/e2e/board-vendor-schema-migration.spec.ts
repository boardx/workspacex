import {observeRuntimeChunks,runtimeSourceIdentity,verifyRuntimeIdentity} from './board-runtime-evidence';
import {test,expect,type Page} from '@playwright/test';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';
import {loadVendorSchemaFixture} from './support/board-vendor-schema-fixtures';
import {produceVendorMigrationEvidence} from './support/board-vendor-import-producer';
async function login(page:Page,peer=false){await page.goto('/login');await page.getByTestId('login-email').fill(peer?F.leadEmail:F.adminEmail);await page.getByTestId('login-password').fill(peer?F.leadPassword:F.adminPassword);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/projects$/);return(await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY))!;}
for(const name of ['miro-workshop','mural-diagram','miro-media'] as const)test(`schema-derived diagnostic migration: ${name} (not real-account acceptance)`,async({browser,request:api,baseURL},info)=>{
 const apiUrl=process.env.WHITEBOARD_API_URL??(process.env.WORKSPACEX_API_PORT?`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`:undefined);expect(apiUrl).toBeTruthy();expect(baseURL).toBeTruthy();
 const ownerContext=await browser.newContext({baseURL}),peerContext=await browser.newContext({baseURL}),owner=await ownerContext.newPage(),peer=await peerContext.newPage();
 const runtimeSha=process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER?runtimeSourceIdentity():undefined;const runtimeChunks=runtimeSha?observeRuntimeChunks(owner):undefined;
 try{const ownerToken=await login(owner);await login(peer,true);const result=await produceVendorMigrationEvidence({api,apiUrl:apiUrl!,ownerToken,peerUserId:F.leadUserId,owner,peer,fixture:await loadVendorSchemaFixture(name)});const {ownerScreenshot,peerScreenshot,roundtripOwnerScreenshot,roundtripPeerScreenshot,...evidence}=result;expect(result.realBoardAcceptance).toBe('diagnostic-only');await info.attach('migration-evidence.json',{body:Buffer.from(JSON.stringify(evidence,null,2)),contentType:'application/json'});await info.attach('owner-after-refresh.png',{body:ownerScreenshot,contentType:'image/png'});await info.attach('independent-peer.png',{body:peerScreenshot,contentType:'image/png'});await info.attach('roundtrip-owner-after-refresh.png',{body:roundtripOwnerScreenshot,contentType:'image/png'});await info.attach('roundtrip-independent-peer.png',{body:roundtripPeerScreenshot,contentType:'image/png'});
 if(runtimeSha&&runtimeChunks)await info.attach('storage-runtime.json',{body:JSON.stringify({scenario:name,runtimeIdentity:await verifyRuntimeIdentity(api,runtimeSha,await runtimeChunks())}),contentType:'application/json'});
 }finally{await ownerContext.close();await peerContext.close();}
});
