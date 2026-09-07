import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {migrationConfig} from '../../src/infrastructure/db/pg-config';
/** Enable TLS only inside this standard wrapper's disposable PostgreSQL container. */
export async function enableIsolatedSqlTls(){
 const project=process.env.COMPOSE_PROJECT_NAME;
 if(!project?.startsWith('wsx-'))throw new Error('isolated SQL TLS requires wrapper ownership');
 const container=execFileSync('docker',['compose','-f',join(process.cwd(),'docker-compose.dev.yml'),'-p',project,'ps','-q','postgres'],{encoding:'utf8'}).trim();
 if(!/^[a-f0-9]{12,64}$/.test(container))throw new Error('one owned postgres container required');
 const root=await mkdtemp(join(tmpdir(),'wx-sql-tls-'));
 try{
  const key=join(root,'server.key'),cert=join(root,'server.crt');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=localhost','-days','1'],{stdio:'pipe'});
  await chmod(key,0o600);
  execFileSync('docker',['exec',container,'mkdir','-p','/tmp/wx-sql-tls']);
  for(const file of ['server.key','server.crt'])execFileSync('docker',['cp',join(root,file),`${container}:/tmp/wx-sql-tls/${file}`]);
  execFileSync('docker',['exec',container,'chown','postgres:postgres','/tmp/wx-sql-tls/server.key','/tmp/wx-sql-tls/server.crt']);
  execFileSync('docker',['exec',container,'chmod','600','/tmp/wx-sql-tls/server.key']);
  const client=new pg.Client(migrationConfig());await client.connect();
  try{
   await client.query("ALTER SYSTEM SET ssl_cert_file='/tmp/wx-sql-tls/server.crt'");
   await client.query("ALTER SYSTEM SET ssl_key_file='/tmp/wx-sql-tls/server.key'");
   await client.query("ALTER SYSTEM SET ssl='on'");await client.query('SELECT pg_reload_conf()');
  }finally{await client.end();}
 }finally{await rm(root,{recursive:true,force:true});}
}
