import {defineConfig,devices} from '@playwright/test';

const web=process.env.BOARD_PEER_WEB_URL,output=process.env.BOARD_PEER_OUTPUT_DIR;
if(!web||!output||!process.env.WORKSPACEX_API_PORT||!process.env.BOARD_ACCEPTANCE_SHA||!process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER||!process.env.BOARD_ACCEPTANCE_RUNTIME_STARTED_AT)throw new Error('Explicit isolated runtime identity, web URL, API port and output directory required');
export default defineConfig({
 testDir:'.',testMatch:['board-peer-origin-close.spec.ts','board-sync-lifecycle.spec.ts'],workers:1,fullyParallel:false,retries:0,timeout:240_000,
 use:{baseURL:web,trace:'off',screenshot:'only-on-failure'},
 projects:[
  {name:'chromium-same-profile-peer-1440',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}},
  {name:'chromium-same-profile-peer-390',use:{...devices['Desktop Chrome'],viewport:{width:390,height:844}}},
 ],
 outputDir:output,
 // The runtime owner starts and attests the isolated native stack separately.
});
