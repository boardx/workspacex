import {CreditConsumptionError} from "../../application/billing/credit-consumption";
import {ModelCallError, type ModelCallInput, type ModelCallPort, type TokenUsageMeterPort} from '../../application/agent-run/ports';
import type {DatabasePort} from '../../application/ports/database.port';
import type {OrgId} from '../../domain/org-id';
import {currentCreditSubject} from '../../application/billing/credit-execution-context';

/** Every public model entry shares the physical dispatch boundary. Content is never persisted. */
export function creditModelGateway(model: ModelCallPort, db: DatabasePort, meter: TokenUsageMeterPort): ModelCallPort {
  const bind = async (input: ModelCallInput): Promise<ModelCallInput> => {
    const unavailable=(reason:string)=>new CreditConsumptionError('credit_accounting_unavailable','team',String(input.orgId??currentCreditSubject()?.orgId??''),reason);
    // Resolve configuration failures before accounting capability. No adapter is
    // invoked for an unregistered provider, and no fallback provider is chosen.
    if (model.registeredProviders && !model.registeredProviders().includes(input.modelProvider)) {
      throw new ModelCallError('MODEL_PROVIDER_NOT_CONFIGURED', `provider "${input.modelProvider}" is not registered`);
    }
    // Private runtimes report each internal physical request through the authenticated runtime ledger.
    if (!model.supportsRequestAccounting?.(input.modelProvider)) {
      throw unavailable('CREDIT_DISPATCH_ACCOUNTING_UNSUPPORTED');
    }
    const scope = currentCreditSubject();
    const orgId = (input.orgId ?? scope?.orgId) as OrgId | undefined;
    if (!orgId || (scope && scope.orgId !== orgId)) throw unavailable('CREDIT_SUBJECT_UNAVAILABLE');
    const owner = input.runId ? await db.withTenant(orgId, async s => (await s.query<{
      user_id:string;project_id:string|null;thread_id:string;agent_id:string;root_run_id:string;subtask_id:string|null;
    }>(`SELECT m.author_id AS user_id,t.project_id,r.thread_id,r.agent_id,r.id AS root_run_id,
      CASE WHEN r.id=$2 THEN NULL ELSE $2 END AS subtask_id FROM agent_runs r
      JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id
      JOIN chat_threads t ON t.org_id=r.org_id AND t.id=r.thread_id WHERE r.org_id=$1 AND (r.id=$2 OR r.id=(SELECT parent_run_id FROM subtask_runs WHERE org_id=$1 AND id=$2))`, [orgId,input.runId])).rows[0]) : undefined;
    const userId = owner?.user_id ?? (!input.runId ? scope?.userId : undefined);
    if (!userId || (scope && owner && scope.userId !== userId)) throw unavailable('CREDIT_SUBJECT_UNAVAILABLE');
    const starts = new Map<string,{startedAt:string;maximumTokens:number|null}>();
    const purpose = owner ? input.usageCallPurpose ?? 'primary' : 'auxiliary';
    return {...input,outputTokenLimit:input.outputTokenLimit??4096,
      beforeProviderDispatch: async request => {
        await input.beforeProviderDispatch?.(request);
        // UTF-8 bytes upper-bound text token count, never presented as measured usage.
        // Multimodal bodies have no verified tokenizer bound and stay inadmissible with preflight ON.
        const imageBody = /"(?:image_url|input_audio)"\s*:/.test(request.serializedBody);
        const output = request.outputTokenLimit;
        const maximumTokens = !imageBody && output !== undefined && Number.isSafeInteger(output)
          ? Buffer.byteLength(request.serializedBody,'utf8') + output : null;
        starts.set(request.requestId,{startedAt:new Date().toISOString(),maximumTokens});
      },
      onProviderRequest: async event => {
        const bound = starts.get(event.requestId);
        if (event.phase === 'started') {
          if (!bound || !meter.startRequest) throw unavailable('CREDIT_DISPATCH_BOUNDARY_MISSING');
          await meter.startRequest(orgId,{requestId:event.requestId,userId,runId:owner?.root_run_id??null,subtaskId:owner?.subtask_id??null,
            executionAttemptId:input.executionAttemptId??null,executionLeaseEpoch:input.executionLeaseEpoch,
            projectId:owner?.project_id??null,threadId:owner?.thread_id??input.threadId??null,
            agentId:owner?.agent_id??null,callPurpose:purpose,modelProvider:input.modelProvider,modelId:input.modelId,
            startedAt:event.startedAt,maximumTokens:bound.maximumTokens});
          try { await input.onProviderRequest?.(event); }
          catch(error){
            // This callback is awaited before the adapter's fetch. Its rejection proves
            // this physical request never dispatched; settle a definitive zero, not unknown.
            await meter.record(orgId,{eventId:event.requestId,userId,runId:owner?.root_run_id??null,subtaskId:owner?.subtask_id??null,
              executionAttemptId:input.executionAttemptId,projectId:owner?.project_id??null,
              threadId:owner?.thread_id??input.threadId??null,agentId:owner?.agent_id??null,callPurpose:purpose,
              modelProvider:input.modelProvider,modelId:input.modelId,requestStartedAt:event.startedAt,
              requestEndedAt:new Date().toISOString(),totalSource:'reported',tokensTotal:0,promptTokens:0,completionTokens:0,outcome:'failed'});
            throw error;
          }
        } else {
          // Existing run observers own their authoritative receipt; never write a second source.
          if (input.onProviderRequest) await input.onProviderRequest(event);
          else await meter.record(orgId,{eventId:event.requestId,userId,runId:owner?.root_run_id??null,subtaskId:owner?.subtask_id??null,
            executionAttemptId:input.executionAttemptId,projectId:owner?.project_id??null,
            threadId:owner?.thread_id??input.threadId??null,agentId:owner?.agent_id??null,callPurpose:purpose,
            modelProvider:input.modelProvider,modelId:input.modelId,requestStartedAt:event.startedAt,
            requestEndedAt:event.endedAt,totalSource:event.usage?.total===undefined?'unknown':'reported',
            tokensTotal:event.usage?.total??0,promptTokens:event.usage?.prompt??null,
            completionTokens:event.usage?.completion??null,cacheInputTokens:event.usage?.cacheInput??null,
            reasoningOutputTokens:event.usage?.reasoningOutput??null,outcome:event.outcome??'failed'});
        }
      },
    };
  };
  return new Proxy(model,{get(target,key){
    if(key==='complete') return async(input:ModelCallInput)=>target.complete(await bind(input));
    if(key==='completeStream' && target.completeStream) return async(input:ModelCallInput,...args:Parameters<NonNullable<ModelCallPort['completeStream']>> extends [unknown,...infer R]?R:never)=>target.completeStream!(await bind(input),...args);
    if(key==='completeWithProgress' && target.completeWithProgress) return async(input:ModelCallInput,...args:Parameters<NonNullable<ModelCallPort['completeWithProgress']>> extends [unknown,...infer R]?R:never)=>target.completeWithProgress!(await bind(input),...args);
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
}
