import {createHash} from 'node:crypto';
export const mcpExecutionDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v)).digest('hex');
