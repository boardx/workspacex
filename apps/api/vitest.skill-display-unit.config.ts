import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/skill/published-task-description.test.ts','tests/skill/read-side-uncontracted-source.test.ts'],maxWorkers:1,minWorkers:1}});
