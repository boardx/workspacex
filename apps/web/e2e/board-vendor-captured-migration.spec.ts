import {expect,test,type Page} from '@playwright/test';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';
import {loadCapturedVendorFixtures} from './support/board-vendor-captured-fixtures';
import {produceVendorMigrationEvidence} from './support/board-vendor-import-producer';

async function login(page:Page,peer=false){await page.goto('/login');await page.getByTestId('login-email').fill(peer?F.leadEmail:F.adminEmail);await page.getByTestId('login-password').fill(peer?F.leadPassword:F.adminPassword);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/projects$/);return(await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY))!;}

test('three captured Miro/Mural account exports migrate with reviewed inventories',async({browser,request:api,baseURL},info)=>{
  expect(process.env.BOARD_CAPTURED_VENDOR_ACCEPTANCE).toBe('1');
  const manifestPath=process.env.WHITEBOARD_CAPTURED_VENDOR_MANIFEST;expect(manifestPath,'WHITEBOARD_CAPTURED_VENDOR_MANIFEST is required').toBeTruthy();
  const apiUrl=process.env.WHITEBOARD_API_URL??(process.env.WORKSPACEX_API_PORT?`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`:undefined);expect(apiUrl).toBeTruthy();expect(baseURL).toBeTruthy();
  const fixtures=await loadCapturedVendorFixtures(manifestPath!);expect(fixtures).toHaveLength(3);
  for(const fixture of fixtures)await test.step(`${fixture.source}:${fixture.name}`,async()=>{
    const ownerContext=await browser.newContext({baseURL}),peerContext=await browser.newContext({baseURL}),owner=await ownerContext.newPage(),peer=await peerContext.newPage();
    try{
      const ownerToken=await login(owner);await login(peer,true);
      const result=await produceVendorMigrationEvidence({api,apiUrl:apiUrl!,ownerToken,peerUserId:F.leadUserId,owner,peer,fixture});
      expect(result.realBoardAcceptance).toBe('requires-source-evidence-review');
      const {ownerScreenshot,peerScreenshot,roundtripOwnerScreenshot,roundtripPeerScreenshot,...evidence}=result,prefix=`${fixture.source}-${fixture.name.replaceAll(/[^a-zA-Z0-9._-]/g,'_')}`;
      await info.attach(`${prefix}-migration-evidence.json`,{body:Buffer.from(JSON.stringify(evidence,null,2)),contentType:'application/json'});
      await info.attach(`${prefix}-owner.png`,{body:ownerScreenshot,contentType:'image/png'});await info.attach(`${prefix}-peer.png`,{body:peerScreenshot,contentType:'image/png'});
      await info.attach(`${prefix}-roundtrip-owner.png`,{body:roundtripOwnerScreenshot,contentType:'image/png'});await info.attach(`${prefix}-roundtrip-peer.png`,{body:roundtripPeerScreenshot,contentType:'image/png'});
    }finally{await ownerContext.close();await peerContext.close();}
  });
});
