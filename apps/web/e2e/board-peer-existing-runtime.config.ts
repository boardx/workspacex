import {defineConfig,devices} from '@playwright/test';
import suite from './support/r08/r08-native-suite.json';

const web=process.env.BOARD_PEER_WEB_URL,output=process.env.BOARD_PEER_OUTPUT_DIR;
if(!web||!output||!process.env.WORKSPACEX_API_PORT||!process.env.BOARD_ACCEPTANCE_SHA||!process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER||!process.env.BOARD_ACCEPTANCE_RUNTIME_STARTED_AT)throw new Error('Explicit isolated runtime identity, web URL, API port and output directory required');
export default defineConfig({
 testDir:'.',testMatch:suite.files,workers:1,fullyParallel:false,retries:0,timeout:240_000,
 use:{baseURL:web,trace:'off',screenshot:'only-on-failure'},
 projects:suite.projects.map(project=>({name:project.name,use:{...devices['Desktop Chrome'],viewport:project.viewport}})),
 outputDir:output,
 // The runtime owner starts and attests the isolated native stack separately.
});
