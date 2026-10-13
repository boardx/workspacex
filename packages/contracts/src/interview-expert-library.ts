import { z } from 'zod';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
const parser=unified().use(remarkParse);
type ExpertMarkdownNode={type:string;depth?:number;children?:readonly ExpertMarkdownNode[]};
/** Includes setext and indented ATX headings; code and literal prose remain data. */
export function containsExpertMarkdownHeading(value:string):boolean {
 const visit=(node:ExpertMarkdownNode):boolean=>
  node.type==='heading'||Boolean(node.children?.some(visit));
 return visit(parser.parse(value));
}
export function isSafeExpertMarkdownDetail(value:string):boolean {
 if(containsExpertMarkdownHeading(value))return false;
 // An unclosed code fence or HTML block must not swallow subsequent expert sections.
 const root:ExpertMarkdownNode=parser.parse(`${value}\n\n## expert-field-boundary`);
 const last=root.children?.at(-1);
 return last?.type==='heading'&&last.depth===2;
}
const line = z.string().trim().min(1).max(200).refine(value => !/[\r\n]/u.test(value) && isSafeExpertMarkdownDetail(value));
const detail = z.string().trim().min(1).max(4000).refine(isSafeExpertMarkdownDetail, 'Expert details must preserve Markdown section boundaries');
/** Reusable simulated profiles are distinct from published Agent identities. */
export const InterviewExpertFields = z.object({name:line,role:line,domains:line,focus:detail,style:detail,bio:detail,limits:detail}).strict();
export type InterviewExpertFields = z.infer<typeof InterviewExpertFields>;
export const InterviewCustomExpert = z.object({expertId:z.string().startsWith('custom-expert-'),origin:z.literal('custom'),fields:InterviewExpertFields,createdAt:z.string()}).strict();
export type InterviewCustomExpert = z.infer<typeof InterviewCustomExpert>;
export const InterviewCustomExpertList = z.object({items:z.array(InterviewCustomExpert)}).strict();
export const CreateInterviewCustomExpert = z.object({fields:InterviewExpertFields,requestId:z.string().uuid()}).strict();
