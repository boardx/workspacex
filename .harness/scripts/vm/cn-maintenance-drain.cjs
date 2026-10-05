'use strict';
// Pinned 9b agent_runs lifecycle. Credentials remain in the exact API runtime env.
// All unfinished states block: paused/awaiting permission are not terminal.
const SQL="SELECT status,count(*)::text AS count FROM agent_runs GROUP BY status";
const TERMINAL=new Set(['succeeded','failed','cancelled']);
const STATES=new Set(['queued','running','writeback_pending','succeeded','failed','paused','cancelled','awaiting_tool_permission']);
function aggregate(rows){
 if(!Array.isArray(rows))throw Error('DRAIN_ROWS');const counts={queued:0,running:0,writebackPending:0};const seen=new Set();
 for(const row of rows){if(!STATES.has(row.status)||seen.has(row.status)||typeof row.count!=='string'||!/^\d+$/.test(row.count))throw Error('DRAIN_STATUS');seen.add(row.status);const n=Number(row.count);if(!Number.isSafeInteger(n))throw Error('DRAIN_COUNT');if(TERMINAL.has(row.status))continue;const key=row.status==='queued'?'queued':row.status==='writeback_pending'?'writebackPending':'running';counts[key]+=n;if(!Number.isSafeInteger(counts[key]))throw Error('DRAIN_COUNT');}
 return counts;
}
async function run(env,Client){
 if(env.PGSSLMODE!=='verify-full'||!env.DIAG_DB_USER||!env.DIAG_DB_PASSWORD||!env.PGHOST||env.PGPORT!=='5432'||env.PGDATABASE!=='workspacex'||!env.PGSSLROOTCERT)throw Error('DRAIN_PRIVATE_CONNECTION_REQUIRED');
 const client=new Client({host:env.PGHOST,port:5432,database:env.PGDATABASE,user:env.DIAG_DB_USER,password:env.DIAG_DB_PASSWORD,ssl:{rejectUnauthorized:true,ca:require('node:fs').readFileSync(env.PGSSLROOTCERT,'utf8')},connectionTimeoutMillis:5000,statement_timeout:10000});
 let begun=false;try{await client.connect();if(client.connection.stream.authorized!==true)throw Error('DRAIN_TLS');await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;const r=await client.query(SQL);await client.query('ROLLBACK');begun=false;return aggregate(r.rows);}finally{if(begun)await client.query('ROLLBACK');await client.end();}
}
module.exports={SQL,aggregate,run};
