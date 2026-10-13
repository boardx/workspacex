import base from './playwright.fullstack-smoke.config';
const seeded=base.projects?.find(project=>project.name==='seeded-github-import');
if(!seeded)throw new Error('Fullstack seeded browser project is required');
export default {...base,workers:1,fullyParallel:false,retries:0,outputDir:'./test-results/board-free-connector-snap',projects:[{...seeded,name:'board-free-connector-snap',dependencies:[],testMatch:['board-free-connector-snap.spec.ts']}]};
