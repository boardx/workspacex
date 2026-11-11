import { OrganizationAiCatalog } from "@/components/admin/organization-ai-catalog";

export default function AgentDirectoryPage({ searchParams }: { searchParams?: { screen?: string } }) {
  return <OrganizationAiCatalog kind="agent" initialScreen={searchParams?.screen} standalone />;
}
