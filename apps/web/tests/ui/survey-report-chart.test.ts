import { describe, expect, it } from 'vitest';
import type { survey } from '@repo/contracts';
import { reportChartOptions, reportChartSvg, reportChartHeight } from '@/components/survey/report/report-chart';
const block: survey.CompiledSurveyBlock = { id:'roles',title:'职责层级',type:'bar',questionIds:[],statistic:'count',samplePolicy:'valid',minGroupSize:5,issues:[],rows:[{label:'您目前承担的主要职责层级是？',group:'企业高管',value:0,count:0},{label:'您目前承担的主要职责层级是？',group:'项目负责人',value:1,count:1}] };
describe('template report chart',()=>{
 it('uses option labels without repeating the shared question and preserves zero values',()=>{
  const option=reportChartOptions(block);
  expect(option.yAxis).toMatchObject({data:['企业高管','项目负责人']});
  expect(option.series).toMatchObject([{data:[0,1]}]);
 });
 it('removes the shared question prefix in compiled distributions',()=>{
  const option=reportChartOptions({...block,statistic:'distribution',rows:[{label:'职责 · 高管',value:0,count:0},{label:'职责 · 员工',value:1,count:1}]});
  expect(option.yAxis).toMatchObject({data:['高管','员工']});
  expect(option.xAxis).toMatchObject({minInterval:1});
 });
 it('formats fractional values in exported charts',()=>{
  const svg=reportChartSvg({...block,rows:[{label:'均值',value:100/3,count:3}]});
  expect(svg).toContain('33.33');expect(svg).not.toContain('33.333333333');
 });
 it('sizes grouped labels using their full wrapped text',()=>{
  const rows=[{label:'很长的问题'.repeat(12),group:'A',value:1,count:1},{label:'另一道问题'.repeat(12),group:'B',value:2,count:1}];
  expect(reportChartHeight({...block,rows})).toBeGreaterThan(200);
 });
 it('uses category colors for distribution while keeping numeric series consistent',()=>{
  expect(reportChartOptions({...block,statistic:'distribution'}).series).toMatchObject([{colorBy:'data'}]);
  expect(reportChartOptions({...block,statistic:'mean'}).series).toMatchObject([{colorBy:'series'}]);
 });
 it('exports actual SVG from the same chart data',()=>{
  const svg=reportChartSvg(block);
  expect(svg).toContain('<svg');expect(svg).toContain('项目负责人');
  expect(svg).not.toContain('您目前承担');expect(svg).toContain('<path');
 });
 it('keeps absent series data missing rather than manufacturing zero',()=>{
  const option=reportChartOptions({...block,type:'line',rows:[{label:'一月',group:'A',value:3,count:1},{label:'二月',group:'B',value:4,count:1}]});
  expect(option.series).toMatchObject([{name:'A',data:[3,null]},{name:'B',data:[null,4]}]);
 });
});
