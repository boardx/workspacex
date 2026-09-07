import {z} from 'zod';
import native from './generated/standard-sql-tools.json';
export const SQL_LIMITS={maxArgumentChars:16384,maxRows:100,maxRowChars:4096,maxOutputBytes:65536,statementTimeoutMs:2000,databaseTimeoutMs:8000,maxConcurrentOperations:8} as const;
const names=Object.keys(native.tools) as [string,...string[]];
export const StandardSqlToolName=z.enum(names);
const id=z.string().min(1).max(256);
const identifier=z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/);
export const StandardSqlSourceCheckInput=z.object({orgId:id,userId:id,attemptId:id,leaseEpoch:z.number().int().positive(),
 toolCallId:id,permissionRequestId:z.string().uuid().optional(),toolName:StandardSqlToolName,toolArgs:z.record(z.string().max(SQL_LIMITS.maxArgumentChars))}).strict();
export const StandardSqlSourceCheckOutput=z.object({dataSourceId:identifier}).strict();
export const StandardSqlBindings=z.array(z.object({orgId:id,userIds:z.array(id).min(1).max(256),dataSourceId:identifier}).strict()).max(256);
export const StandardSqlSources=z.record(identifier,z.object({dsn:z.string().min(1).max(4096),sslMode:z.enum(['verify-full','verify-ca','require']),schema:identifier,views:z.array(identifier).min(1).max(64),
 applicationDatabases:z.array(z.string().min(1).max(128)).min(1).max(16)}).strict());
/** Native upstream field names/requiredness; transport adds a length ceiling and rejects unknown keys. */
export function validateSqlToolArgs(toolName:string,args:unknown):Record<string,string>{
 const schema=(native.tools as Record<string,{properties:Record<string,unknown>;required?:string[]}>)[toolName];
 if(!schema)throw new Error('unknown SQL tool');
 return z.object(Object.fromEntries(Object.keys(schema.properties).map(key=>[key,schema.required?.includes(key)?z.string().max(SQL_LIMITS.maxArgumentChars):z.string().max(SQL_LIMITS.maxArgumentChars).optional()]))).strict().parse(args) as Record<string,string>;
}
