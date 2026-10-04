import {defineConfig,devices} from '@playwright/test';
const baseURL=process.env.BOARD_R01_WEB_URL,outputDir=process.env.BOARD_R01_OUTPUT_DIR;
if(!baseURL||!outputDir||!process.env.BOARD_CONNECTOR_RUNTIME_MANIFEST||!process.env.BOARD_ACCEPTANCE_SHA)throw new Error('R01 requires explicit versioned native runtime identity and private output');
export default defineConfig({testDir:'.',testMatch:'board-r01-native-matrix.spec.ts',workers:1,fullyParallel:false,retries:0,timeout:240_000,outputDir,use:{baseURL,trace:'off',screenshot:'only-on-failure'},projects:[
 {name:'r01-native-1440',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}},
 {name:'r01-native-390',use:{...devices['Desktop Chrome'],viewport:{width:390,height:844}}},
]});
