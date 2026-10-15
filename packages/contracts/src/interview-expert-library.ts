import { z } from 'zod';
import { DigitalExpertCatalogRow } from './interview';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
const parser=unified().use(remarkParse);
type ExpertMarkdownNode={type:string;depth?:number;value?:string;position?:{start:{offset?:number};end:{offset?:number}};children?:readonly ExpertMarkdownNode[]};
/** Root section offsets exclude literal headings inside fenced code. */
export function expertMarkdownHeadings(value:string,depth:number):{text:string;start:number;end:number}[] {
 const root:ExpertMarkdownNode=parser.parse(value);
 const text=(node:ExpertMarkdownNode):string=>node.value??node.children?.map(text).join('')??'';
 return (root.children??[]).filter(node=>node.type==='heading'&&node.depth===depth).map(node=>({text:text(node),start:node.position!.start.offset!,end:node.position!.end.offset!}));
}
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
/** Profile facts reuse the published catalog contract; legacy private rows may omit them. */
const catalog = DigitalExpertCatalogRow.innerType();
export const InterviewExpertProfile = catalog.pick({
 category:true,location:true,age:true,occupation:true,goals:true,interests:true,
 painPoints:true,motivations:true,influences:true,personalityTraits:true,
 serviceValue:true,typicalAdvice:true,
}).partial().extend({personalityTraits:catalog.shape.personalityTraits.partial().optional()}).strict().superRefine((profile,ctx)=>{
 const visit=(value:unknown,path:(string|number)[])=>{
  if(typeof value==='string'&&(value.length>4000||!isSafeExpertMarkdownDetail(value)))ctx.addIssue({code:z.ZodIssueCode.custom,path,message:'Profile details must preserve Markdown section boundaries and fit 4000 characters'});
  else if(Array.isArray(value)){if(value.some(item=>typeof item==='string'&&/[\r\n]/u.test(item))||!isSafeExpertMarkdownDetail(value.join('\n')))ctx.addIssue({code:z.ZodIssueCode.custom,path,message:'Profile lists must contain safe single-line items'});if(value.length>50)ctx.addIssue({code:z.ZodIssueCode.custom,path,message:'At most 50 items'});value.forEach((item,index)=>visit(item,[...path,index]));}
  else if(value&&typeof value==='object')Object.entries(value).forEach(([key,item])=>visit(item,[...path,key]));
 };
 visit(profile,[]);
});
export type InterviewExpertProfile = z.infer<typeof InterviewExpertProfile>;
/** Reusable simulated profiles are distinct from published Agent identities. */
export const InterviewExpertFields = z.object({name:line,role:line,domains:line,focus:detail,style:detail,bio:detail,limits:detail,profile:InterviewExpertProfile.optional()}).strict();
export type InterviewExpertFields = z.infer<typeof InterviewExpertFields>;
export const InterviewCustomExpert = z.object({expertId:z.string().startsWith('custom-expert-'),origin:z.literal('custom'),fields:InterviewExpertFields,createdAt:z.string()}).strict();
export type InterviewCustomExpert = z.infer<typeof InterviewCustomExpert>;
export const InterviewCustomExpertList = z.object({items:z.array(InterviewCustomExpert)}).strict();
export const CreateInterviewCustomExpert = z.object({fields:InterviewExpertFields,requestId:z.string().uuid()}).strict();
