import {defineConfig} from 'vitest/config';
export default defineConfig({test: {include: ['e2e/support/board-meeting-room-evidence.unit.ts'], environment: 'node', maxWorkers: 1, minWorkers: 1}});
