import { OrganizationAiCatalog } from '@/components/admin/organization-ai-catalog';
export default function OrganizationSkillPage({searchParams}:{searchParams:{screen?:string}}){return <OrganizationAiCatalog kind="skill" initialScreen={searchParams.screen}/>;}
