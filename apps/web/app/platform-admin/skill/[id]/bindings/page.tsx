import { SkillAgentPinsPanel } from "@/components/admin/skill-agent-pins-panel";
export default function SkillBindingsPage({ params }: { params: { id: string } }) { return <SkillAgentPinsPanel key={params.id} skillId={params.id} />; }
