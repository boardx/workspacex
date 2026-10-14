import base from './playwright.fullstack-smoke.config';
const seeded=base.projects?.find(project=>project.name==='seeded-github-import');
if(!seeded)throw new Error('Fresh fullstack seeded project is required');
export default {...base,workers:1,fullyParallel:false,retries:0,outputDir:'./test-results/board-menu-layout',
 projects:[{...seeded,name:'board-menu-layout',dependencies:[],testMatch:['board-menu-layout.spec.ts']}]};
