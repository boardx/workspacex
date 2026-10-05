const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../../..');
function hashes(){const rows=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(tsx?|css|html|cjs|mjs|md)$/.test(f))rows.push([path.relative(root,f),crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]);}}for(const d of ['apps/web/components/whiteboard','packages/whiteboard-core/src','packages/contracts/src','apps/web/tests/whiteboard-feedback-browser'])walk(path.join(root,d));return rows.sort(([a],[b])=>a.localeCompare(b));}
module.exports={hashes};
