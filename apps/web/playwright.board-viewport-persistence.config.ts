import base from './playwright.fullstack-smoke.config';
// #5675 uses the fresh isolated fullstack runtime; native acceptance is unchanged.
const seeded = base.projects?.find(project => project.name === 'seeded-github-import');
if (!seeded) throw new Error('Fullstack seeded browser project is required');
const config = {...base, workers: 1, fullyParallel: false, retries: 0,
  outputDir: './test-results/board-viewport-persistence',
  projects: [{...seeded, name: 'board-viewport-persistence', dependencies: [],
    testMatch: ['board-viewport-persistence.spec.ts']}]};

export default config;
