import {
  Brain, BriefcaseBusiness, ChartPie, Cpu, Factory, GraduationCap, Heart,
  Landmark, Lightbulb, ListChecks, Megaphone, Network, Rocket, Scale,
  Telescope, TrendingUp, UsersRound, type LucideIcon,
} from "lucide-react";

const specialtyIcons: Record<string, LucideIcon> = {
  人力资源专家: UsersRound,
  创业导师: Rocket,
  商业专家: BriefcaseBusiness,
  学术专家: GraduationCap,
  心理与行为大师: Heart,
  战略创新大师: Lightbulb,
  战略执行大师: ListChecks,
  技术专家: Cpu,
  投资专家: TrendingUp,
  政策专家: Landmark,
  法务专家: Scale,
  管理大师: Network,
  组织与领导力大师: UsersRound,
  营销与增长大师: Megaphone,
  行业专家: Factory,
  财务专家: ChartPie,
  趋势洞察大师: Telescope,
};

export const EXPERT_SPECIALTY_ICON_CATEGORIES = Object.keys(specialtyIcons);

export function ExpertSpecialtyIcon({ category, className = "size-5" }: { category: string; className?: string }) {
  const Icon = specialtyIcons[category] ?? Brain;
  return <Icon role="img" aria-label={`${category}专业图标`} className={className} strokeWidth={1.8} />;
}
