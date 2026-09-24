import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';
export default defineConfig({resolve:{alias:{'@repo/contracts':fileURLToPath(new URL('../../packages/contracts/src/index.ts',import.meta.url))}},test:{include:['tests/whiteboard/room-display-security.test.ts'],environment:'node',fileParallelism:false}});
