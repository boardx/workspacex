import { test, expect, type Locator } from "@playwright/test";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import {sendViaWorkbench} from "./chat-v2-send";

test("fresh native teaching audit and bounded loopback session", async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_ENABLE_AIDT !== "1", "explicit local AIDT audit only");
  const hold = Math.min(1800, Math.max(0, Number(process.env.AIDT_AUDIT_HOLD_SECONDS ?? 0)));
  test.setTimeout((hold + 180) * 1000);
  const output = process.env.AIDT_E2E_OUTPUT_DIR ?? test.info().outputDir;
  await mkdir(output, { recursive: true });
  const observations: unknown[] = [];
  const verify=process.env.AIDT_AUDIT_OBSERVE_ONLY!=="1";
  async function metric(label: string, target: Locator) {
    const record={ label, viewport: page.viewportSize(), state: await target.evaluate(element => {
      const r = element.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x:r.x,y:r.y,width:r.width,height:r.height, centerExposed: Boolean(hit && (element === hit || element.contains(hit))), probes:[0.25,0.5,0.75,0.95].map(f=>{const node=document.elementFromPoint(x,r.y+r.height*f);return {fraction:f,exposed:Boolean(node && (element===node||element.contains(node))),cover:node?.closest("button,a,header,footer")?.textContent?.trim().slice(0,100)}}),bottom:r.bottom, viewportHeight:innerHeight,chatHostHeight:document.querySelector("[data-testid=aidt-native-chat]")?.getBoundingClientRect().height };
    }) };
    observations.push(record);
    await writeFile(join(output,"observations.json"),JSON.stringify(observations,null,2));
    if(verify && (label.includes("outcome")||label.includes("welcome"))) expect(record.state.probes.slice(0,3).every(point=>point.exposed),JSON.stringify(record)).toBe(true);
  }
  async function focusByTab(id:string, reverse=false) {
    for(let count=0;count<120;count++) {
      if(await page.evaluate(()=>document.activeElement?.getAttribute("data-testid"))===id)return count;
      await page.keyboard.press(reverse?"Shift+Tab":"Tab");
    }
    throw new Error(`Keyboard could not reach ${id}`);
  }
  let memberPosts=0;
  page.on("request",request=>{if(request.method()==="POST"&&/member-chat\/messages$/.test(new URL(request.url()).pathname))memberPosts++;});
  async function shot(name: string) { await page.screenshot({ path: join(output, name + ".png"), fullPage: true }); }
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.leadEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.leadPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByTestId("rail-aidt").click();
  await page.getByTestId("aidt-new").click();
  await page.getByTestId("project-new-name").fill("反馈闭环 · 本机界面体验（非研究证据）");
  await page.getByTestId("project-new-create").click();
  await expect(page).toHaveURL(/\/aidt\/[^/?]+$/);
  const projectId = new URL(page.url()).pathname.split("/").pop()!;
  for (const width of [1280,375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto(`/aidt/${projectId}`);
    await expect(page.getByTestId("aidt-dashboard")).toBeVisible();
    await shot(`01-dashboard-${width}`);
    if(verify&&width===375) for(const stage of [1,2,3,4,5,6]) await expect(page.getByTestId(`aidt-step-${stage}`)).toBeInViewport({ratio:0.8});
    for (const stage of [1,2,3,4,5,6]) {
      await page.goto(`/aidt/${projectId}?step=${stage}`);
      const composer = page.getByTestId("copilotkit-v2-input");
      await expect(composer).toBeVisible({timeout:15000});
      const welcome=page.getByTestId("aidt-chat-welcome");
      await expect(welcome).toBeVisible({timeout:15000});
      await expect(page.getByTestId("aidt-native-chat").getByTestId("loading")).not.toBeVisible();
      await shot(`02-step-${stage}-chat-${width}`);
      await metric(`step-${stage}-welcome-${width}`,welcome);
      await metric(`step-${stage}-chat-empty-${width}`,composer);
      await page.getByTestId("aidt-open-output").click();
      const outputPanel = page.getByTestId("aidt-stage-output");
      await expect(outputPanel).toBeVisible();
      await shot(`03-step-${stage}-outcome-empty-${width}`);
      const fields = outputPanel.locator("textarea:visible, input:not([type]):visible, input[type=text]:visible");
      if(await fields.count()) {
        await fields.last().scrollIntoViewIfNeeded();
        await metric(`step-${stage}-outcome-empty-last-field-${width}`,fields.last());
        await fields.first().fill("本机体验草稿：学生先思考，尚未进行访谈或测试。");
        await shot(`04-step-${stage}-outcome-edited-${width}`);
        await fields.last().scrollIntoViewIfNeeded();
        await metric(`step-${stage}-outcome-last-field-${width}`,fields.last());
        await shot(`05-step-${stage}-outcome-bottom-${width}`);
      }
      if(stage===4) {
        const before = await outputPanel.getByRole("radio").count();
        await page.getByRole("button",{name:"移除候选 1",exact:true}).click();
        if(verify){
          await expect(page.getByRole("button",{name:"保留候选",exact:true})).toBeVisible();
          await page.getByRole("button",{name:"保留候选",exact:true}).click();
          await expect(page.getByLabel("候选1名称",{exact:true})).toHaveValue("本机体验草稿：学生先思考，尚未进行访谈或测试。");
          await expect(outputPanel.getByRole("radio")).toHaveCount(before);
          await page.getByRole("button",{name:"移除候选 1",exact:true}).click();
          await page.getByRole("button",{name:"确认移除候选",exact:true}).click();
          await expect(outputPanel.getByRole("radio")).toHaveCount(before-1);
        }
        observations.push({label:`remove-edited-idea-${width}`,before,after:await outputPanel.getByRole("radio").count(),confirmation:await page.getByRole("dialog").count()});
        await shot(`06-idea-removal-${width}`);
      }
      if(stage===6) {
        await page.getByTestId("aidt-open-report").click();
        await expect(page.getByTestId("aidt-report-preview")).toBeVisible();
        await shot(`07-report-start-${width}`);
        const report = page.getByLabel("小组报告草稿",{exact:true});
        await report.scrollIntoViewIfNeeded();
        await metric(`report-editor-${width}`,report);
        await shot(`08-report-editor-${width}`);
      }
    }
    await page.goto(`/aidt/${projectId}?step=1`);
    await page.getByTestId("global-member-chat-open").click();
    await expect(page.getByTestId("project-member-input")).toBeVisible();
    await shot(`09-team-empty-${width}`);
    const humanText=`本机体验讨论 ${width}：先明确分工；这不是访谈证据。`;
    await page.getByTestId("project-member-input").fill(humanText);
    await page.getByTestId("project-member-send").click();
    await expect(page.getByTestId("project-member-message").filter({hasText:humanText}).first()).toHaveAttribute("data-delivery","stored");
    await metric(`team-input-${width}`,page.getByTestId("project-member-input"));
    await shot(`10-team-stored-${width}`);
    await page.getByTestId("global-member-chat-close").click();
    await page.keyboard.press("Shift+Tab");
    const tabs=await focusByTab("global-member-chat-open");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("global-member-chat-project")).toBeFocused();
    observations.push({label:`team-keyboard-open-${width}`,tabs,active:await page.evaluate(()=>document.activeElement?.getAttribute("data-testid"))});
    await focusByTab("aidt-open-output",true);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("global-member-chat-panel")).toBeVisible();
    await focusByTab("project-member-input");
    const postsBefore=memberPosts;
    await page.keyboard.type("draft line 1");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("draft line 2");
    await expect(page.getByTestId("project-member-input")).toHaveValue("draft line 1\ndraft line 2");
    expect(memberPosts).toBe(postsBefore);
    await shot(`11-team-keyboard-${width}`);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("global-member-chat-panel")).not.toBeVisible();
    await expect(page.getByTestId("global-member-chat-open")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("project-member-input")).toHaveValue("draft line 1\ndraft line 2");
    observations.push({label:`team-keyboard-escape-${width}`,draftRetained:true,outsideEscapeRetainsPanel:true,shiftEnterDoesNotSend:true,ime:"not tested with a real input method"});
    await page.keyboard.press("Escape");
  }
  await page.goto(`/aidt/${projectId}?step=1`);
  await expect(page.getByTestId("aidt-chat-welcome")).toBeVisible({timeout:15000});
  const prompt="本机体验：我们研究学生取餐场景，请先追问，不做决定。";
  await sendViaWorkbench(page,prompt);
  let answer="";
  await expect.poll(async()=>{const result=await page.evaluate(async()=>{const thread=new URL(location.href).searchParams.get("thread");const response=await fetch(`/__fullstack_api/chat/threads/${thread}/messages?limit=100`,{headers:{authorization:`Bearer ${localStorage.getItem("wsx.sessionToken")}`}});return await response.json();});const agent=result.messages?.find((item:{authorKind:string;text:string;agentRunId:string|null})=>item.authorKind==="agent"&&item.agentRunId&&item.text.trim());answer=agent?.text??"";return Boolean(agent);},{timeout:60000}).toBe(true);
  for(const width of [1280,375]){await page.setViewportSize({width,height:width===375?812:900});const message=page.getByText(answer,{exact:true}).first();await expect(message).toBeVisible();await message.scrollIntoViewIfNeeded();await metric(`chat-populated-answer-${width}`,message);await shot(`12-chat-populated-${width}`);}
  await writeFile(join(output,"observations.json"),JSON.stringify(observations,null,2));
  const runtime = { verification:{strictLayout:verify,observeOnly:process.env.AIDT_AUDIT_OBSERVE_ONLY??null},isolationId:process.env.WORKSPACEX_ISOLATION_ID,composeProject:process.env.COMPOSE_PROJECT_NAME,projectId,baseURL:new URL(page.url()).origin,apiOrigin:`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`,expiresAt:new Date(Date.now()+hold*1000).toISOString(),scope:"temporary fixture acceptance; not a persistent group workspace or external user link",dataRetention:"stop or TTL cleans disposable test data",ai:"deterministic local fixture; no real supplier or ASR validation" };
  await writeFile(join(output,"runtime-ready.json"),JSON.stringify(runtime,null,2));
  console.log("AIDT_AUDIT_READY",JSON.stringify(runtime));
  const deadline=Date.now()+hold*1000;
  while(Date.now()<deadline) {
    if(await access(join(output,"stop")).then(()=>true,()=>false))break;
    await page.waitForTimeout(1000);
  }
});
