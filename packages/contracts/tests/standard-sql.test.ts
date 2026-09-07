import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {SQL_LIMITS,StandardSqlSources,StandardSqlSourceCheckInput,StandardSqlSourceCheckOutput,validateSqlToolArgs} from '../src/standard-sql';
describe('standard SQL single source',()=>{
 it('generated Python contract is current',()=>{
  const options={target:'jsonSchema7',$refStrategy:'none'} as const;
  const expected={limits:SQL_LIMITS,sources:zodToJsonSchema(StandardSqlSources,options),input:zodToJsonSchema(StandardSqlSourceCheckInput,options),output:zodToJsonSchema(StandardSqlSourceCheckOutput,options)};
  expect(JSON.parse(readFileSync(new URL('../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_sql_schema.json',import.meta.url),'utf8'))).toEqual(expected);
 });
 it('native manifests match and forbid identity or DSN tool fields',()=>{
  const ts=readFileSync(new URL('../src/generated/standard-sql-tools.json',import.meta.url),'utf8');
  expect(readFileSync(new URL('../../../apps/deep-agent-service/src/deep_agent_service/generated/standard_sql_tools.json',import.meta.url),'utf8')).toBe(ts);
  expect(validateSqlToolArgs('sql_db_query',{query:'SELECT 1'})).toEqual({query:'SELECT 1'});
  for(const extra of ['dsn','orgId','namespace','dataSourceId'])expect(()=>validateSqlToolArgs('sql_db_query',{query:'SELECT 1',[extra]:'untrusted'})).toThrow();
  expect(()=>validateSqlToolArgs('sql_db_query',{})).toThrow();
  expect(()=>validateSqlToolArgs('unknown',{})).toThrow();
 });
 it('does not support unencrypted SQL deployment sources',()=>{
  expect(StandardSqlSources.safeParse({readonly:{dsn:'postgresql+psycopg://user@host/source',sslMode:'disable',schema:'public',views:['view'],applicationDatabases:['app']}}).success).toBe(false);
 });
});
