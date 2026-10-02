import {defineConfig,devices} from '@playwright/test';

const web=process.env.BOARD_PEER_WEB_URL,output=process.env.BOARD_PEER_OUTPUT_DIR;
if(!web||!output||!process.env.WHITEBOARD_API_URL||!process.env.BOARD_ACCEPTANCE_SHA||!process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER||!process.env.BOARD_ACCEPTANCE_RUNTIME_STARTED_AT)throw new Error('Explicit isolated runtime identity, URLs and output directory required');
export default defineConfig({
 testDir:'.',testMatch:'board-peer-origin-close.spec.ts',workers:1,fullyParallel:false,retries:0,timeout:180_000,
 use:{baseURL:web,trace:'off',screenshot:'only-on-failure'},
 projects:[{name:'chromium-same-profile-peer',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}}],
 outputDir:output,
 // The runtime owner starts and attests the isolated native stack separately.
});
