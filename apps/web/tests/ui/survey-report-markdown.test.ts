import { expect, it } from 'vitest';
import { surveyReportMarkdown } from '@/components/survey/report/report-markdown';
it('includes actual images and omits unavailable legacy sample sizes',()=>{
 const result=surveyReportMarkdown({id:'r',title:'报告',issues:[],sections:[{id:'s',title:'章节',blocks:[{id:'b',title:'图片',type:'image',questionIds:[],statistic:'responses',samplePolicy:'valid',minGroupSize:8,imageUrl:'https://example.com/image.png',caption:'封面',issues:[],rows:[]}]}]});
 expect(result).toContain('![封面](https://example.com/image.png)');
 expect(result).not.toContain('实际样本量');expect(result).not.toContain('undefined');
});
it('projects the actual report into readable Markdown without invented benchmarks',()=>{
 const result=surveyReportMarkdown({id:'r',title:'真实报告',issues:[],sampleSummary:{total:9,pendingReview:0,excluded:1,included:8},sections:[{id:'s',title:'真实章节',blocks:[{id:'b',title:'实际指标',type:'metric',questionIds:[],statistic:'mean',samplePolicy:'valid',sampleSize:8,minGroupSize:8,issues:[],rows:[{label:'满意度',value:3.5,count:8}]}]}]});
 expect(result).toContain('# 真实报告');expect(result).toContain('## 真实章节');expect(result).toContain('满意度');expect(result).toContain('3.5');expect(result).toContain('纳入分析 8');expect(result).not.toContain('行业');
});
