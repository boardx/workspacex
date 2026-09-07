import {Client,escapeLiteral} from 'pg';
import type {PgConfig} from '../db/pg-config';
/** Deployment-only provisioning. Runtime never receives the migration identity. */
export async function setupMcpExecutor(config:PgConfig,password:string){
 if(password.length<24||password.length>256||/[\0\r\n]/.test(password))throw new Error('mcp_executor_password_invalid');
 const client=new Client(config);await client.connect();
 try{
  // The identifier is constant; pg's literal escaping handles operator-provided password bytes.
  await client.query(`ALTER ROLE mcp_executor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${escapeLiteral(password)}`);
 }catch{throw new Error('mcp_executor_setup_failed');}finally{await client.end();}
}
