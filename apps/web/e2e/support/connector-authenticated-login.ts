import {expect,type Page,type TestInfo} from '@playwright/test';
import {boardLogin} from '../board-acceptance-support';
import {FULLSTACK_E2E as F} from '../fullstack-smoke-fixture';
import {captureBoardLogin} from './board-login-capture.mjs';
import {connectorLoginDiagnostic} from './connector-login-diagnostic.mjs';

/** Capture the single real upstream response before the login page navigates. */
export async function connectorBoardLogin(page:Page,info:TestInfo,email:string=F.email,password:string=F.password,userId:string=F.userId){
 const captured=await captureBoardLogin(page,()=>boardLogin(page,email,password));
 const diagnostic=connectorLoginDiagnostic(captured.status,captured.body,userId,captured.token,captured.jsonParsed);
 expect(captured.posts,'CONNECTOR_LOGIN_SINGLE_POST').toBe(1);
 expect(captured.status,'CONNECTOR_LOGIN_HTTP_OK').toBe(200);
 expect(diagnostic.jsonParsed&&diagnostic.objectSchema&&diagnostic.actorString&&diagnostic.tokenString,'CONNECTOR_LOGIN_JSON_SCHEMA').toBe(true);
 expect(diagnostic.actorMatches,'CONNECTOR_LOGIN_FIXTURE_ACTOR').toBe(true);
 expect(diagnostic.tokenMatches,'CONNECTOR_LOGIN_SESSION_TOKEN').toBe(true);
 const navigationPath=new URL(page.url()).pathname;
 expect(navigationPath,'CONNECTOR_LOGIN_NAVIGATION').toMatch(/^\/(?:home|projects)$/);
 // Authentication uses Bearer tokens; cookies may legitimately be absent.
 // Never retain cookie values, passwords, tokens, or the original response body.
 const cookies=await page.context().cookies();
 await info.attach('connector-login-receipt',{body:JSON.stringify({...diagnostic,posts:captured.posts,actor:userId,navigationPath,cookieCount:cookies.length}),contentType:'application/json'});
 return captured.token;
}
