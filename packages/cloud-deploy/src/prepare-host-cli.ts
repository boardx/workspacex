import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { prepareHost } from "./prepare-host";
import { assertTrustedPath } from "./trusted-path";
async function json(path:string){await assertTrustedPath(path,{trustedRoot:"/",kind:"file"});const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=await file.stat();if(!stat.isFile()||stat.size<1||stat.size>65536)throw new Error();return JSON.parse(await file.readFile("utf8"));}finally{await file.close();}}
try{
 const [config,manifest,checkoutDirectory,runtimeDirectory,...extra]=process.argv.slice(2);
 if(!config||!manifest||!checkoutDirectory||!runtimeDirectory||extra.length)throw new Error();
 console.log(JSON.stringify(await prepareHost(await json(config),await json(manifest),{checkoutDirectory,runtimeDirectory})));
}catch{console.error(JSON.stringify({ok:false,reason:"host_preparation_failed"}));process.exitCode=1;}
