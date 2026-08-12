import { AppShell } from "@/components/shell/app-shell";
import { QuickDigitalInterview } from "@/components/itv/quick-digital-interview";
export default function Page({params,searchParams}:{params:{interviewId:string};searchParams:{expertId?:string}}){return <AppShell previewRole={null}><QuickDigitalInterview interviewId={params.interviewId} expertId={searchParams.expertId}/></AppShell>}
