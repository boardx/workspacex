import {formatSurveyAnswer,isSurveyPageElement,type SurveyResponse,type SurveyWorkflowQuestion} from '@repo/contracts/survey';
const escape=(value:string)=>value.replace(/[\\`*_{}\[\]<>]/g,'\\$&').replace(/[\r\n]/g,' ');
export async function surveyResponseMarkdown(responses:SurveyResponse[],questions:SurveyWorkflowQuestion[],readAttachment:(responseId:string,id:string)=>Promise<{attachmentId:string;name:string;mime:string;sizeBytes:number}>) {
 const rows=await Promise.all(responses.map(async response=>{
  const answers=await Promise.all(questions.filter(q=>!isSurveyPageElement(q)).map(async q=>{
   const answer=response.answers.find(a=>a.questionId===q.id);
   let value=answer?formatSurveyAnswer(q,answer.value):'未填写';
   if((q.type==='file'||q.type==='signature')&&Array.isArray(answer?.value)) {
    value=(await Promise.all(answer.value.map(async id=>{
     const file=await readAttachment(response.id,id);
     return `- ${escape(file.name)} · ${file.sizeBytes} bytes · ${escape(file.mime)} · 附件 ID: ${escape(id)}`;
    }))).join('\n');
   }
   return `### ${escape(q.title)}\n\n${value}`;
  }));
  return [`## 答卷 ${escape(response.id)}`,`提交时间：${response.submittedAt}`,`用时：${response.durationSeconds} 秒`,`分析状态：${response.analysis==='excluded'?'已排除':'纳入分析'}`,...answers].join('\n\n');
 }));
 return ['# 问卷答卷',...rows].join('\n\n');
}
