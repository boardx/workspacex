import {it,expect} from "vitest";
import {Configuration} from "@repo/contracts/ai-policy";
import {resolveMemberTokenLimit,evaluateAiTokenThresholds} from "../../src/domain/agent-run/ai-member-token-policy";
const base=Configuration.parse({window:{start:"2026-10-01T00:00:00Z",end:"2026-11-01T00:00:00Z",timezone:"Etc/UTC"},ordinaryTokensPerUser:"100",costMicrosPerUser:"50",currency:"CNY",prices:[{modelId:"m",modelProvider:"p",runtimeModelId:"r",inputMicrosPerMillion:"1",outputMicrosPerMillion:"1",cachedInputMicrosPerMillion:"1",maxInputTokens:10,maxOutputTokens:10}],fallbackModelIds:[],maxAttempts:1});
const controls={quotaSource:"member-monthly-utc" as const,warningAtTokens:"50",degradeAtTokens:"80",memberOverrides:[]};
it("legacy configuration preserves its amount and does not activate old thresholds",()=>{
 expect(resolveMemberTokenLimit(base,"u","0")).toBe("100");expect(evaluateAiTokenThresholds(base,"ordinary",1000n)).toEqual({warning:false,degrade:false});expect(base).not.toHaveProperty("tokenControls");
});
it("explicit authority preserves member zero and unconfigured without template fallback",()=>{
 const config={...base,tokenControls:controls};expect(resolveMemberTokenLimit(config,"u","0")).toBe("0");expect(resolveMemberTokenLimit(config,"u",null)).toBeNull();
 expect(()=>resolveMemberTokenLimit({...config,window:{...config.window,timezone:"Asia/Shanghai"}},"u","20")).toThrow("WINDOW_INCOMPATIBLE");
 expect(()=>resolveMemberTokenLimit({...config,window:{...config.window,start:"2026-10-02T00:00:00Z"}},"u","20")).toThrow("WINDOW_INCOMPATIBLE");
});
it("explicit template overrides are per-user and enterprise ignores product thresholds",()=>{
 const config={...base,tokenControls:{...controls,quotaSource:"organization-template" as const,memberOverrides:[{userId:"u",tokens:"0"}]}};
 expect(resolveMemberTokenLimit(config,"u","999")).toBe("0");expect(resolveMemberTokenLimit(config,"other","999")).toBe("100");
 expect(evaluateAiTokenThresholds(config,"ordinary",79n)).toEqual({warning:true,degrade:false});expect(evaluateAiTokenThresholds(config,"ordinary",80n)).toEqual({warning:true,degrade:true});expect(evaluateAiTokenThresholds(config,"enterprise",1000n)).toEqual({warning:false,degrade:false});
});
it("rejects mixed quota authorities, duplicate overrides and reversed thresholds",()=>{
 for(const tokenControls of [{...controls,memberOverrides:[{userId:"u",tokens:"1"}]},{...controls,warningAtTokens:"90"},{...controls,quotaSource:"organization-template",memberOverrides:[{userId:"u",tokens:"1"},{userId:"u",tokens:"2"}]}])expect(Configuration.safeParse({...base,tokenControls}).success).toBe(false);
});
