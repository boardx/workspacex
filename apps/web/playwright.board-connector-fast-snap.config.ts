import base from './playwright.fullstack-smoke.config';
// #5666 owns a diagnostic lane, not a replacement for native acceptance suites.
const seeded = base.projects?.find(project => project.name === 'seeded-github-import');
if (!seeded) throw new Error('Fullstack seeded browser project is required');
const config = {...base, workers: 1, fullyParallel: false, retries: 0,
  outputDir: './test-results/board-connector-fast-snap',
  projects: [{...seeded, name: 'board-connector-fast-snap', dependencies: [],
    testMatch: ['board-connector-fast-snap.spec.ts']}]};

export default config;
