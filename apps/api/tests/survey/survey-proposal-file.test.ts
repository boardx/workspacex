import { expect,it } from 'vitest';
import { extractSurveyProposalFile } from '../../src/application/survey/proposal-file';
it('reads UTF-8 source without claiming a local parser is AI',async()=>{
 const result=await extractSurveyProposalFile({convert:async()=>{throw new Error('text needs no converter');}},{name:'目标.md',base64:Buffer.from('研究客户最近一次体验').toString('base64')});
 expect(result).toBe('研究客户最近一次体验');
});
it('rejects disguised executable bytes before conversion',async()=>{
 await expect(extractSurveyProposalFile({convert:async()=>({ok:true,markdown:'unsafe'})},{name:'研究.pdf',base64:Buffer.from('MZexecutable').toString('base64')})).rejects.toMatchObject({code:'SURVEY_AI_INPUT_INVALID'});
});
it('reports conversion failure instead of making up extracted text',async()=>{
 await expect(extractSurveyProposalFile({convert:async()=>({ok:false,code:'encrypted'})},{name:'研究.pdf',base64:Buffer.from('%PDF-1.7 encrypted').toString('base64')})).rejects.toMatchObject({code:'SURVEY_AI_INPUT_INVALID'});
});
