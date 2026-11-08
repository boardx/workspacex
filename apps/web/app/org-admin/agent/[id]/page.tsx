"use client";
import { AppShell } from '@/components/shell/app-shell';
import { AdminNav } from '@/components/admin/admin-nav';
import { CapabilityEditPage } from '@/components/admin/capability-edit-page';
import { AgentCapabilityGraph } from '@/components/admin/agent-capability-graph';
import { AgentRoleAdminSection } from '@/components/admin/agent-role-admin-section';
import { WorkflowRunEntry } from '@/components/workflow/workflow-lists';
import { safeRelativePath } from '@/lib/safe-relative-path';
export default function OrganizationAgentEditor({params,searchParams}:{params:{id:string};searchParams:{from?:string}}){
 return <AppShell previewRole={null} left={<AdminNav active="org-agent" scope="org"/>}><WorkflowRunEntry agentId={params.id}/><CapabilityEditPage kind="agent" id={params.id} backHref={safeRelativePath(searchParams.from)??'/org-admin/agent?screen=manage'} renderEditExtra={row=><><AgentRoleAdminSection agentId={row.id}/><AgentCapabilityGraph orgId={row.orgId} agentId={row.id}/></>}/></AppShell>;
}
