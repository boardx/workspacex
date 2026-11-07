import {it,expect,vi,afterEach} from 'vitest';
import {CreditConsumptionError} from '../../src/application/billing/credit-consumption';
import {generateSurveyMarkdownProposal} from '../../src/application/survey/generate-markdown-proposal';
import {generateIntakeQuestions} from '../../src/application/design-workbench/intake-questions';
afterEach(()=>vi.useRealTimers());
it.each(['credit_required','credit_accounting_unavailable'] as const)('survey generation preserves %s for HTTP recharge/recovery guidance',async code=>{
 const error=new CreditConsumptionError(code,'user','actual-user');const complete=vi.fn(async()=>{throw error;});
 await expect(generateSurveyMarkdownProposal({model:{complete},provider:'model',modelId:'id'},{text:'调查用户的需求'})).rejects.toBe(error);expect(complete).toHaveBeenCalledOnce();
});
it('design intake does not hide a credit refusal behind generic fallback questions',async()=>{
 const error=new CreditConsumptionError('credit_required','team','actual-org');const complete=vi.fn(async()=>{throw error;});
 await expect(generateIntakeQuestions({model:{complete},chatModel:{provider:'model',modelId:'id'},log:()=>{}},{brief:'设计一个项目管理系统'})).rejects.toBe(error);expect(complete).toHaveBeenCalledOnce();
});
