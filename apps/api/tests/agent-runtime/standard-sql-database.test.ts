import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {ensureDatabase,migrateOnce} from '../support/db';
import {migrationConfig} from '../../src/infrastructure/db/pg-config';
import {enableIsolatedSqlTls} from '../support/standard-sql-tls';
it('official SQL Toolkit crosses the real asynchronous read-only PostgreSQL boundary',async()=>{
 ensureDatabase();await migrateOnce();await enableIsolatedSqlTls();const pg=migrationConfig();
 const dsn=`postgresql://${encodeURIComponent(pg.user)}:${encodeURIComponent(pg.password)}@${pg.host}:${pg.port}/${pg.database}`;
 const cwd=join(process.cwd(),'../deep-agent-service');
 const output=await new Promise<string>((resolve,reject)=>{
  const child=spawn(join(cwd,'.venv/bin/python'),['-m','pytest','tests/test_standard_sql_database.py','-q'],{cwd,env:{...process.env,WX_SQL_TEST_DSN:dsn}});let result='';
  child.stdout.on('data',chunk=>result+=chunk);child.stderr.on('data',chunk=>result+=chunk);child.on('error',reject);
  child.on('exit',code=>code===0?resolve(result):reject(new Error(result)));
 });
 expect(output).toContain('3 passed');
},90000);
