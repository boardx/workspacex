import {afterEach,expect,it,vi} from "vitest";
import {TeamPaymentRecoveryWorker} from "../../src/infrastructure/billing/team-payment-recovery-worker";
afterEach(()=>vi.useRealTimers());
it("coalesces overlapping sweeps and drains its owned work on shutdown",async()=>{
 let finish!:()=>void;const blocking=new Promise<void>(resolve=>finish=resolve),sweep=vi.fn(async()=>{await blocking;return {processed:1,failed:0};});
 const worker=new TeamPaymentRecoveryWorker({sweep},{info(){},error(){}});
 const a=worker.runOnce(),b=worker.runOnce();expect(a).toBe(b);expect(sweep).toHaveBeenCalledTimes(1);
 let stopped=false;const stopping=worker.onModuleDestroy().then(()=>stopped=true);await Promise.resolve();expect(stopped).toBe(false);finish();await stopping;await worker.runOnce();expect(sweep).toHaveBeenCalledTimes(1);
});
it("reports sweep failure and releases the guard for retry",async()=>{
 const error=vi.fn(),sweep=vi.fn().mockRejectedValueOnce(Error("secret-database-detail")).mockResolvedValue({processed:0,failed:0});
 const worker=new TeamPaymentRecoveryWorker({sweep},{info(){},error});await worker.runOnce();await worker.runOnce();
 expect(sweep).toHaveBeenCalledTimes(2);expect(error).toHaveBeenCalledWith("billing_team_recovery_failed",{traceId:expect.stringMatching(/^team-payment-recovery:/),err:{stage:"bounded_sweep"}});expect(JSON.stringify(error.mock.calls)).not.toContain("secret-database-detail");await worker.onModuleDestroy();
});

it("logs completed sweep counts under its own trace",async()=>{
 const info=vi.fn(),worker=new TeamPaymentRecoveryWorker({sweep:async()=>({processed:2,failed:1})},{info,error(){}});
 await worker.runOnce();expect(info).toHaveBeenCalledWith("billing_team_recovery",{traceId:expect.stringMatching(/^team-payment-recovery:/),processed:2,failed:1});await worker.onModuleDestroy();
});
