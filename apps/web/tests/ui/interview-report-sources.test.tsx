import * as React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InterviewReportStep } from "@/components/itv/interview-report-step";
import type { interviewMarkdown } from "@repo/contracts";
afterEach(cleanup);
const hash="a".repeat(64);
const raw='## 我自称客服\n\nQ2：厨房插座冲突。\n';
const start=raw.indexOf('Q2');
const source: interviewMarkdown.InterviewMarkdownDocument={documentId:'runs',step:'runs',version:2,contentHash:hash,evidenceMode:'simulated',references:[],markdown:raw,answerSpans:[{taskKey:'revision/support',expertId:'support',start:0,end:raw.length,contentHash:hash}]};
const report: interviewMarkdown.InterviewMarkdownDocument={documentId:'report',step:'report',version:1,contentHash:hash,evidenceMode:'simulated',markdown:'# 报告\n\n[Q2：厨房插座冲突。](#answer-1)',references:[{anchor:'answer-1',documentId:'runs',version:2,locator:{sourceHash:hash,start,end:raw.length-1,quote:'Q2：厨房插座冲突。',expertId:'support',taskKey:'revision/support',evidenceMode:'simulated'}}]};
const experts: interviewMarkdown.InterviewMarkdownDocument={documentId:'experts',step:'experts',version:1,contentHash:hash,evidenceMode:'simulated',references:[],markdown:'## [支持研究员](#expert-support)\n\n研究支持。'};
it('routes a repeated question citation to the exact saved source and server identity rather than a model role claim',()=>{
 render(<InterviewReportStep document={report} sourceDocuments={[source]} expertsDocument={experts}/>);
 const citation=screen.getByRole('link',{name:'Q2：厨房插座冲突。'});
 expect(citation).toHaveAttribute('href','#itv-source-answer-1');
 const target=document.getElementById('itv-source-answer-1')!;
 expect(target).toHaveTextContent('支持研究员');
 expect(target).not.toHaveTextContent('我自称客服');
 expect(target.querySelector('blockquote')?.textContent).toBe('Q2：厨房插座冲突。');
 expect(target).toHaveTextContent('模拟证据，需真人验证');
 const scroll=vi.fn(); target.scrollIntoView=scroll;
 fireEvent.click(citation);
 expect(scroll).toHaveBeenCalledWith({block:'start'});
 expect(document.activeElement).toBe(target);
});
it('does not substitute the latest source when a pinned citation version differs',()=>{
 render(<InterviewReportStep document={report} sourceDocuments={[{...source,version:3,markdown:'已修改的不同回答'}]}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('无法验证此引用');
 expect(document.querySelector('blockquote')).toBeNull();
 expect(screen.getByTestId('itv-source-report-markdown')).toHaveTextContent('Q2：厨房插座冲突。');
});
it('retains the exact legacy quotation without reconstructing expert identity from headings',()=>{
 const legacy={...report,references:report.references.map(ref=>({...ref,locator:{...ref.locator!,expertId:null,taskKey:null}}))};
 render(<InterviewReportStep document={legacy} sourceDocuments={[{...source,answerSpans:[]}]}/>);
 expect(document.getElementById('itv-source-answer-1')).toHaveTextContent('身份未验证');
 expect(document.querySelector('blockquote')?.textContent).toBe('Q2：厨房插座冲突。');
});
