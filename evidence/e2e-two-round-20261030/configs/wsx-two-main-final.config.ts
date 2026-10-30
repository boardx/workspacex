import base from '/tmp/wsx-two-2-main-original.config';
const out='/Users/shenyangjun/.codex/worktrees/548a/workspacex/evidence/e2e-two-round-20261030/round-2';
const servers=base.webServer.map((server,index)=>index===base.webServer.length-1?{...server,command:`next start -p ${process.env.WORKSPACEX_WEB_PORT}`,timeout:120000,env:{...server.env,NEXT_DIST_DIR:'.next-fullstack-e2e',WORKSPACEX_RELEASE_BUILD:'0'}}:server);
export default {...base,webServer:servers,outputDir:out+'/main-final-browser',reporter:[['list'],['json',{outputFile:out+'/main-final-results.json'}]]};
