import { createHash } from 'node:crypto';
import { interviewMarkdown } from '@repo/contracts';
import { ReportFileSourceError, type ReportFileActor, type ReportFileSourceResolver, type ReportFileSourceSnapshot } from '../report-files/ports';
import { authorizeDigitalInterview, type GetDigitalInterviewDeps } from './get-digital-interview';
import { readInterviewMarkdown, type InterviewMarkdownReader } from './read-interview-markdown';
import { NoInterviewAccessError } from './errors';

export const INTERVIEW_REPORT_FILE_SOURCE = Symbol('InterviewReportFileSource');
export type InterviewReportFileSourceDeps = GetDigitalInterviewDeps & { readonly reader: InterviewMarkdownReader };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** Reads authorized canonical bytes; approval never grants access or gates file generation. */
export class InterviewReportFileSource implements ReportFileSourceResolver {
 readonly kind = 'interview' as const;
 constructor(private readonly deps: InterviewReportFileSourceDeps) {}
 async read(actor: ReportFileActor, id: string): Promise<ReportFileSourceSnapshot> {
  const input = {orgId:actor.orgId,viewerUserId:actor.userId,interviewId:id};
  try {
   const current = await readInterviewMarkdown(this.deps,input);
   const authorized = await authorizeDigitalInterview(this.deps,input);
   const document = current.documents.find(item=>item.step==='report');
   const state = current.states.find(item=>item.documentId===document?.documentId);
   if(!current.revisionId || !document || !document.markdown.trim() || !state || !['draft','confirmed','completed'].includes(state.status)) throw new ReportFileSourceError('REPORT_UNAVAILABLE');
   const reportHash = hash(document.markdown);
   if(reportHash!==document.contentHash) throw new ReportFileSourceError('REPORT_CHANGED');
   const notices:string[]=[`文档版本 ${document.version} · 内容哈希 ${reportHash}`];
   if(document.evidenceMode==='simulated') notices.push('本报告基于 AI 模拟访谈，不代表真实用户证据，需真人验证。');
   if(document.evidenceMode==='mixed') notices.push('本报告包含混合证据，模拟内容不代表真实用户证据。');
   if(state.status==='draft') notices.push('当前报告为已保存草稿。');
   const review=current.review;
   const matching=review && review.revisionId===current.revisionId && review.documentId===document.documentId && review.documentVersion===document.version && review.contentHash===reportHash;
   if(!matching || review.status!=='approved') notices.push('当前报告未批准，不代表已批准结论。');
   if(matching && review.note) notices.push(`复核说明：${review.note}`);
   const appendix:string[]=[];
   let unavailableReferences = 0;
   for(const reference of document.references){
    const locator=reference.locator;
    const source=current.documents.find(item=>item.documentId===reference.documentId && item.version===reference.version);
    if(!locator || !source || hash(source.markdown)!==source.contentHash || source.contentHash!==locator.sourceHash || source.evidenceMode!==locator.evidenceMode || locator.end>source.markdown.length || source.markdown.slice(locator.start,locator.end)!==locator.quote){
     unavailableReferences++;continue;
    }
    appendix.push(`### 引用 ${reference.anchor}\n\n来源版本 ${source.version} · SHA256 ${source.contentHash}\n\n${locator.quote}`);
   }
   if(unavailableReferences) notices.push(`${unavailableReferences} 项引用的已保存来源当前不可核验。`);
   const title = (interviewMarkdown.parseInterviewMarkdown(document).headings[0]?.text || authorized.interview.name || '访谈报告').slice(0,300);
   // Reviews advance the aggregate version even when the report bytes do not change.
   // Recheck the monotonic stamp after assembling the authorized source snapshot.
   const latest = await readInterviewMarkdown(this.deps,input);
   if(latest.version!==current.version || latest.revisionId!==current.revisionId) throw new ReportFileSourceError('REPORT_CHANGED');
   return {kind:this.kind,id,title,reportVersion:document.version,reportHash,bindingKey:JSON.stringify([current.version,current.revisionId,document.documentId,document.version,reportHash]),markdown:document.markdown,...(appendix.length?{appendixMarkdown:appendix.join('\n\n')}:{}),projectId:authorized.projectId,notices};
  }catch(error){if(error instanceof NoInterviewAccessError)throw new ReportFileSourceError('REPORT_NOT_FOUND');throw error;}
 }
}
