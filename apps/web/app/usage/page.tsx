"use client";
import { AppShell } from "@/components/shell/app-shell";
import { AiUsagePanel } from "@/components/admin/ai-usage-panel";
import { useSession } from "@/components/session/session-provider";
export default function UsagePage(){
 const {session}=useSession();
 return <AppShell previewRole={null}><div className="mx-auto w-full max-w-6xl p-6">
  <h1 className="text-20 font-semibold">我的 AI 用量</h1><p>按当前组织查看本人调用。切换组织后显示该组织内的本人用量。</p>
  {session&&<AiUsagePanel key={session.currentOrgId+":"+session.userId} orgId={session.currentOrgId} selfUserId={session.userId}/>}
 </div></AppShell>;
}
