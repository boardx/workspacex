import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { maintainStarter, type StarterMaintenanceOptions } from "./starter-maintenance";
async function json(path:string){const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=await file.stat();if(!stat.isFile()||stat.size<1||stat.size>65536)throw new Error();return JSON.parse(await file.readFile("utf8"));}finally{await file.close();}}
try{
 const [operation,configFile,releaseFile,runtimeDirectory,backupDirectory,database,backupId,...extra]=process.argv.slice(2);
 if(!operation||!configFile||!releaseFile||!runtimeDirectory||!backupDirectory||extra.length||!["backup","restore"].includes(operation)||operation==="backup"&&backupId)throw new Error();
 if(process.platform!=="linux"||process.getuid?.()!==0)throw new Error();
 const options=operation==="backup"?{operation,runtimeDirectory,backupDirectory,database:database??"workspacex"}:{operation,runtimeDirectory,backupDirectory,database,backupId};
 const result=await maintainStarter(await json(configFile),await json(releaseFile),options as StarterMaintenanceOptions);
 console.log(JSON.stringify(result));
}catch{console.error(JSON.stringify({ok:false,reason:"starter_maintenance_failed"}));process.exitCode=1;}
