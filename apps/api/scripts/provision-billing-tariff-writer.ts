/** Explicit operator provisioning. Password is read from a protected file, never printed. */
import {readFileSync,statSync} from 'node:fs';
import pg from 'pg';
import {migrationConfig} from '../src/infrastructure/db/pg-config';
export async function provisionBillingTariffWriter(password:string){
 if(password.length<16||password.includes('\n'))throw new Error('INVALID_WRITER_CREDENTIAL');
 const client=new pg.Client(migrationConfig());await client.connect();
 try{
  const role=(await client.query<{rolsuper:boolean;rolcreatedb:boolean;rolcreaterole:boolean;rolbypassrls:boolean;rolinherit:boolean}>("SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolinherit FROM pg_roles WHERE rolname='app_billing_tariff_writer'")).rows[0];
  if(!role||role.rolsuper||role.rolcreatedb||role.rolcreaterole||role.rolbypassrls||role.rolinherit)throw new Error('UNSAFE_WRITER_ROLE');
  const memberships=(await client.query("SELECT 1 FROM pg_auth_members WHERE member='app_billing_tariff_writer'::regrole OR roleid='app_billing_tariff_writer'::regrole")).rows;
  if(memberships.length)throw new Error('UNSAFE_WRITER_MEMBERSHIP');
  // PostgreSQL utility statements do not accept bind parameters. Quote using pg's SQL literal helper.
  await client.query(`ALTER ROLE app_billing_tariff_writer LOGIN PASSWORD ${pg.escapeLiteral(password)}`);
 }finally{await client.end();}
}
async function main(){const path=process.env.BILLING_TARIFF_PASSWORD_FILE;if(!path)throw new Error('PASSWORD_FILE_REQUIRED');const st=statSync(path);if(!st.isFile()||(st.mode&0o077)!==0)throw new Error('PRIVATE_PASSWORD_FILE_REQUIRED');await provisionBillingTariffWriter(readFileSync(path,'utf8').trim());console.log('BILLING_TARIFF_WRITER_PROVISIONED');}
if(process.argv[1]?.endsWith('provision-billing-tariff-writer.ts'))void main().catch(()=>{console.error('BILLING_TARIFF_WRITER_PROVISION_FAILED');process.exitCode=1;});
