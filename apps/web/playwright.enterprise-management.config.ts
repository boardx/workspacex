import {defineConfig,devices} from "@playwright/test";
function required(name:string){const value=process.env[name];if(!value)throw Error(`${name} required: use with-test-isolation`);return value;}
const apiPort=required("WORKSPACEX_API_PORT"),webPort=required("WORKSPACEX_WEB_PORT");
const origin=`http://127.0.0.1:${webPort}`,api=`http://127.0.0.1:${apiPort}`;
export default defineConfig({testDir:"./e2e",testMatch:"enterprise-management.browser.ts",globalSetup:"./e2e/enterprise-management.setup.ts",workers:1,retries:0,timeout:120000,expect:{timeout:20000},use:{baseURL:origin,...devices["Desktop Chrome"],screenshot:"only-on-failure"},webServer:[
 {command:"pnpm --filter @repo/api exec tsx scripts/start-enterprise-acceptance.ts",url:`${api}/healthz`,timeout:240000,reuseExistingServer:false},
 {command:`pnpm exec next dev -H 127.0.0.1 -p ${webPort}`,url:`${origin}/login`,timeout:180000,reuseExistingServer:false,env:{...process.env,NEXT_DIST_DIR:'.next-enterprise-6108',NEXT_PUBLIC_API_URL:origin,NEXT_PUBLIC_API_PATH_PREFIX:"/__fullstack_api",NEXT_PUBLIC_API_WS_URL:api,FULLSTACK_E2E_API_ORIGIN:api}},
]});
