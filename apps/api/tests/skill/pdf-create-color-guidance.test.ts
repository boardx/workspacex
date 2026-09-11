/**
 * issue #3401 —— `pdf-create` 正文里每一个文档化的颜色写法，都必须被**真实 pdf-lib**接受。
 *
 * 为什么是这条：本机实测（`.perf-evidence/`，SHA 551c8e97f）里，同一句
 * 「生成一个 pdf，总结你可以做的事情」五次生成有四次撞上
 * `Invalid color: {"r":0.6,"g":0.6,"b":0.6}` —— 模型把 `color` 写成普通对象/数组，
 * 脚本退出码 1，然后要花 3–9 个模型轮次去改它（占端到端 10–35%）。
 * 正文当时**一个字都没写过颜色怎么传**，所以这不是模型乱来，是指引缺口。
 *
 * 这条门判的是**行为**不是措辞：把正文代码块里出现的每个 `color:` 表达式取出来，
 * 交给真实 `pdf-lib` 的 `drawText`/`drawLine` 去画。正文里写错的颜色形状会在这里
 * 抛出与沙箱里逐字相同的 `Invalid color`。
 */
import {describe,it,expect} from 'vitest';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {PDF_CREATE_SKILL_MD} from '../../scripts/office-docs-skill-content';

const fences=[...PDF_CREATE_SKILL_MD.matchAll(/```js\n([\s\S]*?)```/g)].map(m=>m[1]!);
const colorExpressions=fences.flatMap(fence=>[...fence.matchAll(/\b(?:border)?[Cc]olor:\s*(rgb\([^)]*\)|\{[^}]*\}|\[[^\]]*\]|[A-Za-z0-9_.]+)/g)].map(m=>m[1]!.trim()));

describe('pdf-create 正文的颜色写法',()=>{
 it('正文确实示范了带颜色的绘制（缺了就等于回到 #3401 之前的无指引状态）',()=>{
  expect(fences.length).toBeGreaterThan(0);
  expect(colorExpressions.length).toBeGreaterThan(0);
 });

 it('每一个文档化的 color 表达式都被真实 pdf-lib 接受',async()=>{
  const doc=await PDFDocument.create();
  const font=await doc.embedFont(StandardFonts.Helvetica);
  const page=doc.addPage([595,842]);
  for(const expression of colorExpressions){
   const value=new Function('rgb',`return (${expression});`)(rgb) as ReturnType<typeof rgb>;
   // 真实 pdf-lib 的颜色校验就在 drawText/drawLine 里，和沙箱里那次失败同一行。
   page.drawText('x',{x:50,y:700,size:12,font,color:value});
   page.drawLine({start:{x:50,y:690},end:{x:545,y:690},thickness:0.8,color:value});
  }
  expect((await doc.save()).length).toBeGreaterThan(0);
 });

 it('正文点名了那两个会抛 Invalid color 的错误写法',()=>{
  expect(PDF_CREATE_SKILL_MD).toContain('rgb(');
  expect(PDF_CREATE_SKILL_MD).toContain('Invalid color');
  expect(PDF_CREATE_SKILL_MD).toMatch(/绝对不要写[\s\S]{0,120}color:\s*\{\s*r:/);
  expect(PDF_CREATE_SKILL_MD).toMatch(/绝对不要写[\s\S]{0,200}color:\s*\[/);
 });
});
