import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/billing/credit-model-gateway.test.ts','tests/chat/bailian-vision-extractor.test.ts','tests/billing/private-credit-failure.test.ts'],maxWorkers:1,minWorkers:1}});
