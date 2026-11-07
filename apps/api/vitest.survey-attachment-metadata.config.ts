import {defineConfig} from 'vitest/config';
// This service-port test uses no database or object store.
export default defineConfig({test:{include:['tests/survey/survey-attachment-metadata.test.ts']}});
