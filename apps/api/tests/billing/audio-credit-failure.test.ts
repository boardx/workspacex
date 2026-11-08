import {afterEach,expect,it,vi} from 'vitest';
import {StandardAudioController} from '../../src/interface/controllers/standard-audio.controller';
import {CreditConsumptionError} from '../../src/application/billing/credit-consumption';
const body={orgId:'org',attemptId:'attempt',leaseEpoch:1,bindingId:'00000000-0000-4000-8000-000000000001',toolCallId:'call',toolName:'wx_audio_transcribe',toolArgs:{attachmentId:'original'}};
afterEach(()=>vi.unstubAllEnvs());
it.each(['credit_required','credit_accounting_unavailable'] as const)('audio callback retains %s as typed billing refusal',async code=>{
 vi.stubEnv('DEEP_AGENT_SERVICE_INTERNAL_KEY','test-only');
 const failure=new CreditConsumptionError(code,'user','owned-user');
 const transcribe=vi.fn().mockRejectedValue(failure);
 const controller=new StandardAudioController({transcribe});
 await expect(controller.parse('test-only','run',body)).rejects.toBe(failure);
 expect(transcribe).toHaveBeenCalledTimes(1);
});
it('audio provider text remains generic and cannot trigger recharge',async()=>{
 vi.stubEnv('DEEP_AGENT_SERVICE_INTERNAL_KEY','test-only');
 const controller=new StandardAudioController({transcribe:vi.fn().mockRejectedValue(new Error('credit_required secret'))});
 await expect(controller.parse('test-only','run',body)).rejects.toThrow('audio_transcription_failed_no_result_confirmed');
});
