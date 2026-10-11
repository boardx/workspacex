import { GoogleGuidedSearch } from '../../../../apps/api/src/infrastructure/research/google-guided-search';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const inputs = [
 ['2e143b4d-fae2-40a1-be1e-e2a01b4f4116','http://www.jiangmen.gov.cn/home/sqdt/pkzx/content/post_3245984.html','30d73d941371c8c9a64618b85b8b24495057aff96b1f092e03f7253dcf0dfd9e'],
 ['44ac9f92-0871-4a76-8cb2-d61aa2f1bc09','https://www.bbc.com/zhongwen/articles/cdj792z4j74o/simp','efc3367f92a7799908299e2b4ee8fb0fc1ea5a946b62335c69a1bfc4b8298cad'],
 ['e77af5a2-5a31-4f1a-958d-eac1470d3105','https://www.designmarathon.cn/task','f4789cc047b8737d2f32f5da18d683abc60aa88e40d3db5e7af0d3b69854d878'],
];
async function main() {
 const reader = new GoogleGuidedSearch();
 const results = await Promise.all(inputs.map(async ([id,url,expected])=>{
  try { const document = await reader.read(url!); const hash=createHash('sha256').update(document.text).digest('hex');
   console.log(JSON.stringify({id,length:document.text.length,hash,identical:hash===expected}));
   return {id,url,document,hash,expected};
  } catch(error) {console.log(JSON.stringify({id,reason:error instanceof Error?error.message:'unknown'}));return null;}
 }));
 writeFileSync('/tmp/research-5546-documents.json',JSON.stringify(results),{mode:0o600});
}
void main();
