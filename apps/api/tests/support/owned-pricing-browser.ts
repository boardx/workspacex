import {spawn,execFileSync,type ChildProcess} from "node:child_process";
import {createRequire} from "node:module";
import {createServer} from "node:net";
import {resolve} from "node:path";
import {mkdirSync,writeFileSync} from "node:fs";
import {chromium,type Browser} from "playwright";
/** Owns its allocated port, Next process group and Chromium; never reuses or stops another listener. */
export interface OwnedPricingBrowser {readonly browser:Browser;readonly origin:string;close():Promise<void>}
export async function ownedPricingBrowser(apiOrigin:string,evidence:string,onOwner?:(owner:OwnedPricingBrowser)=>void):Promise<OwnedPricingBrowser> {
 const port=Number(process.env.WORKSPACEX_WEB_PORT);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error("standard test isolation allocation required");
 const origin=`http://127.0.0.1:${port}`,webRoot=resolve(import.meta.dirname,"../../../web");
 let web:ChildProcess|undefined,webClosed:Promise<void>|undefined,browser:Browser|undefined;
 let closed=false,closing=false,spawnError:Error|undefined,output="";
function outputTail() { return output.slice(-16000); }
async function assertAllocatedPortFree() {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error("Allocated web port is occupied; no existing listener will be reused or killed")));
    probe.listen(port, "127.0.0.1", () => probe.close(error => error ? reject(error) : resolve()));
  });
}
async function waitForServer() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (closed) throw new Error(`Owned Next exited before readiness: ${outputTail()}`);
    if (!output.replace(/\u001b\[[0-9;]*m/g, "").includes("Ready in")) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
    try { const response = await fetch(`${origin}/billing`, { signal: AbortSignal.timeout(5000) }); if (response.ok && !closed && !spawnError) return; } catch { /* Owned server may still be compiling. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Owned Next readiness timed out: ${outputTail()}`);
}
async function stopWeb() {
  if (!web || !webClosed) return;
  const groupAlive = () => {
    if (!web?.pid) return false;
    try { process.kill(process.platform === "win32" ? web.pid : -web.pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      let snapshot = "unavailable";
      try { snapshot = execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,uid=,stat="], { encoding: "utf8" }).split("\n").filter(line => Number(line.trim().split(/\s+/)[2]) === web?.pid).join("\n"); } catch { /* Preserve the original permission failure. */ }
      // Darwin can reject kill(0) while the owned leader is a zombie awaiting
      // Node's child reaper. This is not a live group and must not be signalled.
      // Completion still requires the captured close event below; permission
      // failures with any other process-table evidence remain fatal.
      const members = snapshot.trim().split("\n").map(line => line.trim().split(/\s+/));
      if (process.platform === "darwin" && (error as NodeJS.ErrnoException).code === "EPERM" && members.length === 1) {
        const member = members[0]!;
        if (member.length === 5 && Number(member[0]) === web.pid && Number(member[2]) === web.pid && Number(member[3]) === process.getuid?.() && member[4]!.startsWith("Z")) return false;
      }
      throw new Error(`Owned Next group probe failed: pid=${web.pid} closed=${closed} exitCode=${web.exitCode} code=${(error as NodeJS.ErrnoException).code} members=${snapshot || "none"}`, { cause: error });
    }
  };
  const signal = (name: NodeJS.Signals) => { try { if (process.platform === "win32") web?.kill(name); else if (web?.pid) process.kill(-web.pid, name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } };
  const wait = async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { if (!groupAlive() && closed) { await webClosed; return true; } await new Promise(resolve => setTimeout(resolve, 50)); }
    return !groupAlive() && closed;
  };
  // A closed leader is insufficient: Next may still have owned workers in its group.
  if (groupAlive()) signal("SIGTERM");
  if (!await wait()) { if (groupAlive()) signal("SIGKILL"); if (!await wait()) throw new Error(`Owned Next process group did not stop: ${outputTail()}`); }
  await webClosed;
}

 const owner:OwnedPricingBrowser={get browser(){if(!browser)throw Error("owned browser not ready");return browser;},origin,
  async close(){closing=true;try{if(browser){let i=0;for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:resolve(evidence,`final-${i++}.png`),fullPage:true}).catch(()=>undefined);}await browser?.close();}finally{try{await stopWeb();}finally{mkdirSync(evidence,{recursive:true});writeFileSync(resolve(evidence,"next.log"),outputTail());}}}};
 onOwner?.(owner);
 try {
  mkdirSync(evidence,{recursive:true});await assertAllocatedPortFree();if(closing)throw Error("owned browser start canceled");
  const require=createRequire(resolve(webRoot,"package.json"));
  const env:NodeJS.ProcessEnv={...process.env,NEXT_DIST_DIR:".next-personal-pricing-glue",NEXT_PUBLIC_API_URL:"/__fullstack_api",FULLSTACK_E2E_API_ORIGIN:apiOrigin,BILLING_PERSONAL_PRICING_UI_ENABLED:"true"};
  for(const key of Object.keys(env))if(/^(WECHAT_PAY_|STRIPE_)/.test(key))delete env[key];
  web=spawn(process.execPath,[require.resolve("next/dist/bin/next"),"dev","--hostname","127.0.0.1","-p",String(port)],{cwd:webRoot,env,detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"]});
  const capture=(chunk:Buffer)=>{output=(output+chunk.toString("utf8")).slice(-1000000);};web.stdout?.on("data",capture);web.stderr?.on("data",capture);
  webClosed=new Promise<void>(resolve=>{web!.once("close",()=>{closed=true;resolve();});web!.once("error",error=>{spawnError=error;closed=true;resolve();});});
  await waitForServer();browser=await chromium.launch({headless:true});
  if(closing)throw Error("owned browser start canceled");return owner;
 }catch(error){try{await browser?.close();}finally{await stopWeb();}throw error;}
}
