import base from '/tmp/wsx-two-2-main-original.config';
const out='/Users/shenyangjun/.codex/worktrees/548a/workspacex/evidence/e2e-two-round-20261030/round-2';
const servers=base.webServer.map((server,index)=>index===base.webServer.length-1?{...server,command:`next start -p ${process.env.WORKSPACEX_WEB_PORT}`,timeout:120000,env:{...server.env,NEXT_DIST_DIR:'.next-fullstack-e2e',WORKSPACEX_RELEASE_BUILD:'0'}}:server);
const selections:Record<string,string[]>={
 'board-unified-desktop':['board-edge-pan.spec.ts','board-multi-image-upload.spec.ts'],
 'board-image-ingress':['board-image-ingress-acceptance.spec.ts'],
 'board-collaboration-regressions':['board-acl-race.spec.ts','board-shared-outbox.spec.ts'],
};
export default {...base,projects:base.projects.filter(project=>selections[project.name]).map(project=>({...project,testMatch:selections[project.name]})),webServer:servers,outputDir:'/Users/shenyangjun/.codex/worktrees/548a/workspacex/evidence/e2e-two-round-20261030/board-fix-browser',reporter:[['list'],['json',{outputFile:'/Users/shenyangjun/.codex/worktrees/548a/workspacex/evidence/e2e-two-round-20261030/board-fix-results.json'}]]};
