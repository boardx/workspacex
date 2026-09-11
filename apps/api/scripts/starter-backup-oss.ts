import { createBackupStore } from "./backup-oss-adapter";
import { uploadStarterBackup, downloadStarterBackup } from "../../../packages/cloud-deploy/src/backup-objects";
try{
  if(process.env.WORKSPACEX_DEPLOY_PROFILE!=="starter")throw new Error("starter only");
  const [operation,directory,id,...extra]=process.argv.slice(2);
  if(!operation||!directory||extra.length||!["upload","download"].includes(operation)||operation==="download"&&!id)throw new Error("invalid operation");
  const store=await createBackupStore(process.env.STARTER_BACKUP_TARGET_JSON??"");
  const result=operation==="upload"?await uploadStarterBackup(store,directory,id):await downloadStarterBackup(store,id!,directory);
  console.log(JSON.stringify({ok:true,...result}));
}catch{console.error(JSON.stringify({ok:false,reason:"starter_backup_transfer_failed"}));process.exitCode=1;}
