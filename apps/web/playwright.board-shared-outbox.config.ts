import base from './playwright.fullstack-smoke.config';
// Retain the actual isolated fullstack lifecycle; this lane is intentionally
// separate from independent-context spatial collaboration acceptance.
const seeded=base.projects?.find(project=>project.name==='seeded-github-import');
if(!seeded)throw new Error('Fullstack seeded browser project is required');
export default {...base,workers:1,fullyParallel:false,retries:0,outputDir:'./test-results/board-shared-outbox',
 projects:[{...seeded,name:'board-shared-outbox',dependencies:[],testMatch:['board-shared-outbox.spec.ts']}]};
