import { backupStarterDatabase, restoreStarterDatabase } from "./starter-backup";
try {
  const [operation,directory,...extra]=process.argv.slice(2);
  if(process.env.WORKSPACEX_DEPLOY_PROFILE!=="starter"||!directory||extra.length||!["backup","restore"].includes(operation??""))throw new Error("invalid input");
  const target={container:process.env.STARTER_POSTGRES_CONTAINER??"",database:process.env.PGDATABASE??"",user:process.env.PGUSER??"",password:process.env.PGPASSWORD??""};
  const result=operation==="backup"?await backupStarterDatabase(target,directory):await restoreStarterDatabase(target,directory);
  console.log(JSON.stringify({ok:true,...result,cloudVerified:false}));
}catch{console.error(JSON.stringify({ok:false,reason:"starter_backup_operation_failed"}));process.exitCode=1;}
