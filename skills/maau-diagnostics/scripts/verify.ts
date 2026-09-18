import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {FileSkillStarterPackSource} from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import {verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
const require=createRequire(import.meta.url);
async function main(){
const root=resolve(import.meta.dirname,'..'),source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
const pack=verifySkillStarterPack(await source.load('maau-diagnostics','2.0.0'),{packId:'maau-diagnostics',packVersion:'2.0.0'});
assert.equal(pack.skills.length,1);assert.equal(pack.skills[0]!.stableName,'maau-venture-valuation');assert.equal(pack.skills[0]!.files.length,8);
for(const file of pack.skills[0]!.files)assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(resolve(root,'maau-venture-valuation',file.path)));
// 1.0.0 仍可加载（历史清单不动）；篡改被拒。
assert.equal((await source.load('maau-diagnostics','1.0.0'))?.skills?.[0]?.stableName,'maau-recursive-asset-report');
const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64='dGFtcGVy';assert.throws(()=>verifySkillStarterPack(changed,{packId:'maau-diagnostics',packVersion:'2.0.0'}));

// Calculator 不变量（Requirement V0.5 §16 验收表）。
const {calculate,formatValue}=require(resolve(root,'maau-venture-valuation/scripts/calc.cjs'));
const load=(n:string)=>JSON.parse(readFileSync(resolve(root,'maau-venture-valuation/examples',n),'utf8'));
const idx=load('sample-index.json'),usd=load('sample-usd.json');
const a=calculate(idx),b=calculate(JSON.parse(JSON.stringify(idx)));
assert.deepEqual(a,b,'同一输入重复计算：确定性数字完全一致');
assert.equal(a.benchmark.mode,'index');assert.equal(a.snapshot.V_seed,100);assert.equal(a.quadrant.key,'q3','M 高 EI 低 → 技术自嗨风险');
assert.equal(a.recursive.gamma,0.945);assert.equal(a.recursive.Mcrit,null);assert.equal(a.ledger.EI_observed,0.1);
assert.ok(a.ledger.ledger.filter((e:any)=>e.type!=='observed').every((e:any)=>e.entersVnow===false),'Target/Planned/Assumption 不进 V_now');
assert.equal(formatValue(a.snapshot.V_now,'index'),'指数 111');
const u=calculate(usd);
assert.equal(u.benchmark.mode,'usd');assert.equal(u.benchmark.sourceCount,3,'D 级与未披露不计');assert.deepEqual([u.benchmark.low,u.benchmark.base,u.benchmark.high],[4000000,6500000,9000000]);
assert.equal(u.ledger.EI_observed,1.05,'E1+E2+E3+E4');assert.equal(u.recursive.state,'strong-recursive');assert.equal(u.quadrant.key,'q4');assert.equal(u.confidence.level,'High');
assert.equal(u.vNow.base,Math.round(6500000*Math.exp(1.05)));
assert.ok(u.forecast.horizons['12m'].base.value.base>u.forecast.horizons['90d'].base.value.base&&u.forecast.horizons['90d'].base.value.base>u.vNow.base);
assert.ok(u.forecast.horizons['12m'].upside.value.base>u.forecast.horizons['12m'].base.value.base&&u.forecast.horizons['12m'].base.value.base>u.forecast.horizons['12m'].conservative.value.base);
// 只有 Target 没有 Fact → V_now 不获得增益；续费只是计划 → 只进 Forecast。
const onlyTarget=structuredClone(usd);onlyTarget.evidence=onlyTarget.evidence.filter((e:any)=>e.type!=='observed');const t=calculate(onlyTarget);
assert.equal(t.ledger.EI_observed,0);assert.equal(t.vNow.base,t.benchmark.base);assert.ok(t.forecast.horizons['90d'].base.EI_future>0);
// 单一 Comparable 不得决定 V_seed → 退回 Value Index。
const single=structuredClone(usd);single.benchmark.comparables=single.benchmark.comparables.slice(0,1);assert.equal(calculate(single).benchmark.mode,'index');
// 同级 observed 重复只计一次。
const dup=structuredClone(usd);dup.evidence.push({id:'ev-x',type:'observed',level:'E3',region:'validation',statement:'第二个付费合同'});assert.equal(calculate(dup).ledger.EI_observed,1.05);
// EI 高 M 低 → 项目公司风险。
const lowM=structuredClone(usd);lowM.assets=lowM.assets.slice(0,2);assert.equal(calculate(lowM).quadrant.key,'q2');
// Preflight：无 Validation → 不给正式 V_now。
const missing=structuredClone(idx);missing.canvas.validation='';const m=calculate(missing);assert.equal(m.preflight.ok,false);assert.equal(m.snapshot,undefined);
// 非法输入拒绝。
const bad=structuredClone(idx);bad.evidence[0].type='fact';assert.ok(calculate(bad).errors.some((e:string)=>e.includes('evidence[0].type')));

// 渲染：拿得到单面 CJK 字体时真的画 8 页且字节确定。
const {renderReport,resolveFont}=require(resolve(root,'maau-venture-valuation/scripts/render.cjs'));
let font:string|null=null;try{font=resolveFont(process.env.MAAU_REPORT_FONT);}catch{font=null;}
if(font){for(const r of [a,u]){const bytes:Uint8Array=await renderReport(r,font);assert.equal(Buffer.from(bytes.subarray(0,5)).toString(),'%PDF-');assert.equal((Buffer.from(bytes).toString('latin1').match(/\/Type\s*\/Page[^s]/g)||[]).length,8,'fixed 8 pages');const again:Uint8Array=await renderReport(r,font);assert.deepEqual(Buffer.from(bytes),Buffer.from(again),'render must be byte-deterministic');}
 console.log('PASS maau-diagnostics 2.0.0 pack + V0.5 calculator acceptance + 8-page deterministic render (font '+font+'). Not a live model G-SKILL.');}
else console.log('PASS maau-diagnostics 2.0.0 pack + V0.5 calculator acceptance; PDF render SKIPPED (no single-face CJK font; set MAAU_REPORT_FONT). Not a live model G-SKILL.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
