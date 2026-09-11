/**
 * issue #3421 —— `pptx-create` 正文里的建稿示例必须能被**真实 pptxgenjs** 跑通。
 *
 * 为什么补这条：#3421 为查 PPTX 超时，把这份正文逐段改过又逐段撤回（见
 * `docs/design/standard-capabilities/evidence/issue-3421/README.md`）。改的过程中
 * 才发现——这段示例是模型照抄的模板，却**没有任何门**保证它还能跑：把
 * `addSlide`/`addText` 的参数形状写错、或换一个 pptxgenjs 不认的字段，正文照样发布，
 * 模型照抄，然后在沙箱里当场失败，再花几个模型轮次去改它。pdf-create 的同类缺口
 * （正文没写颜色怎么传）实测代价是端到端的 10–35%（#3401/#3406）。
 *
 * 这条判的是**行为**不是措辞：把正文代码块原样交给真实 pptxgenjs，产物必须是
 * 真的 OOXML 容器（zip，magic `PK`），不是"看起来像"。
 */
import {describe,it,expect} from 'vitest';
import PptxGenJS from 'pptxgenjs';
import {PPTX_CREATE_SKILL_MD} from '../../scripts/office-docs-skill-content';

describe('pptx-create 正文的建稿示例',()=>{
 it('能被真实 pptxgenjs 跑通并产出 OOXML(zip) 容器',async()=>{
  const fences=[...PPTX_CREATE_SKILL_MD.matchAll(/```js\n([\s\S]*?)```/g)].map(m=>m[1]!);
  const example=fences.find(f=>f.includes('addSlide'));
  expect(example,'正文必须留一段真的建稿示例').toBeTruthy();
  // 只把落盘换成内存导出，其余逐字照跑——参数形状写错会在这里抛。
  const source=example!.replace(/pres\.writeFile\([\s\S]*?\);/,"module.exports=pres.write({outputType:'nodebuffer'});");
  expect(source,'示例的落盘调用必须被成功替换，否则这条门等于没跑').not.toContain('writeFile');
  const loaded={exports:undefined as unknown};
  new Function('require','module',source)((name:string)=>{
   if(name!=='pptxgenjs')throw new Error(`示例只应依赖预装的 pptxgenjs，实际 require 了 ${name}`);
   return PptxGenJS;
  },loaded);
  const buffer=await (loaded.exports as Promise<Buffer>);
  expect(buffer.subarray(0,2).toString('latin1'),'OOXML 就是 zip，头两字节必须是 PK').toBe('PK');
  expect(buffer.length).toBeGreaterThan(1000);
 });
});
