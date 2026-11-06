import { defineConfig } from 'vitest/config';
/** Native approval transport and report identity checks without a database service. */
export default defineConfig({test:{include:[
 'tests/agent-runtime/execute-run-progress.test.ts',
 'tests/report-files/service.test.ts',
 'tests/agent-run/parent-run-control-unit.test.ts',
 'tests/agent-run/tool-approval-replay.test.ts',
 'tests/agent-run/tool-approval-resume-security.test.ts',
],maxWorkers:1,minWorkers:1}});
