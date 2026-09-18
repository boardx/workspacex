import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {FileSkillStarterPackSource} from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import {verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
const require=createRequire(import.meta.url);
async function main(){
const root=resolve(import.meta.dirname,'..'),source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
const pack=verifySkillStarterPack(await source.load('maau-diagnostics','1.0.0'),{packId:'maau-diagnostics',packVersion:'1.0.0'});
assert.equal(pack.skills.length,1);assert.equal(pack.skills[0]!.files.length,8);
for(const file of pack.skills[0]!.files)assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(resolve(root,'maau-recursive-asset-report',file.path)));
const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64='dGFtcGVy';assert.throws(()=>verifySkillStarterPack(changed,{packId:'maau-diagnostics',packVersion:'1.0.0'}));

// 计算不变量：确定性、γ 封顶、γ≤1 无 Mcrit、Preflight。
const {computeDiagnosis}=require(resolve(root,'maau-recursive-asset-report/scripts/compute.cjs'));
const sample=JSON.parse(readFileSync(resolve(root,'maau-recursive-asset-report/examples/sample-canvas.json'),'utf8'));
const a=computeDiagnosis(sample),b=computeDiagnosis(JSON.parse(JSON.stringify(sample)));
assert.deepEqual(a,b,'same input must give identical output');
assert.equal(a.current.gamma,1);assert.equal(a.current.gammaCapped,true);assert.equal(a.current.Mcrit,null);assert.equal(a.current.state,'ordinary-maau');
assert.equal(a.assets.M,5.5);assert.equal(a.current.mu,0.21);assert.equal(a.current.beta,1.29);
assert.ok(!a.conclusion.includes('已越过'),'γ≤1 must never claim the threshold is crossed');
const strong=JSON.parse(readFileSync(resolve(root,'maau-recursive-asset-report/examples/sample-canvas-strong.json'),'utf8'));
const s=computeDiagnosis(strong);assert.equal(s.current.state,'strong-recursive');assert.equal(s.current.gamma,1.4);assert.equal(s.current.Mcrit,3.38);assert.equal(s.current.position,'above');
assert.ok(s.stress.gamma<1&&s.stress.mu>s.current.mu,'stress test must degrade γ and raise μ');
const missing=structuredClone(sample);missing.canvas.validation='';const m=computeDiagnosis(missing);assert.equal(m.preflight.ok,false);assert.deepEqual(m.preflight.missingRegions,['validation']);assert.equal(m.current,undefined);
const bad=structuredClone(sample);bad.loops.L3.score=0.7;assert.ok(computeDiagnosis(bad).errors.some((e:string)=>e.includes('loops.L3')));

// 渲染：只有在拿得到单面 CJK 字体时才真的画（沙箱/CI 镜像有，裸开发机可能没有）。
const {renderReport,resolveFont}=require(resolve(root,'maau-recursive-asset-report/scripts/render-report.cjs'));
let font:string|null=null;try{font=resolveFont(process.env.MAAU_REPORT_FONT);}catch{font=null;}
if(font){const bytes:Uint8Array=await renderReport(a,font);assert.equal(Buffer.from(bytes.subarray(0,5)).toString(),'%PDF-');assert.equal((Buffer.from(bytes).toString('latin1').match(/\/Type\s*\/Page[^s]/g)||[]).length,5,'fixed 5 pages');
 const again:Uint8Array=await renderReport(a,font);assert.deepEqual(Buffer.from(bytes),Buffer.from(again),'render must be byte-deterministic');
 console.log('PASS maau-diagnostics pack + compute invariants + 5-page deterministic PDF render (font '+font+'). Not a live model G-SKILL.');}
else console.log('PASS maau-diagnostics pack + compute invariants; PDF render SKIPPED (no single-face CJK font; set MAAU_REPORT_FONT). Not a live model G-SKILL.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
