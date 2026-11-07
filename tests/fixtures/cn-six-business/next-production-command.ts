import type {PlaywrightTestConfig} from '../../../apps/web/node_modules/@playwright/test';
type WebServerConfig=Exclude<PlaywrightTestConfig['webServer'],undefined|unknown[]>;
// Derive build and runtime bindings from the existing chat-read server, once.
export function productionCommand(server:WebServerConfig,phase:'build'|'start'){
 const match=/^NEXT_PUBLIC_API_URL=(http:\/\/127\.0\.0\.1:[0-9]+) CHAT_READ_E2E_API_ORIGIN=(http:\/\/127\.0\.0\.1:[0-9]+) COPILOTKIT_V2_AGENT_ID=([A-Za-z0-9_-]+) NEXT_DIST_DIR=\.next-chat-read-e2e next dev -p ([0-9]+)$/.exec(server.command);
 if(!match)throw Error('EXACT_NEXT_STARTUP_SHAPE_REQUIRED');
 return {...server,command:`node ../../tests/fixtures/cn-six-business/next-production-launch.cjs ${phase} ${match[4]}`,env:{...server.env,NEXT_PUBLIC_API_URL:match[1]!,CHAT_READ_E2E_API_ORIGIN:match[2]!,COPILOTKIT_V2_AGENT_ID:match[3]!,NEXT_DIST_DIR:'.next-chat-read-e2e',NODE_ENV:'production',WORKSPACEX_RELEASE_BUILD:'1'}};
}
