"use client";
import * as React from "react";
import { CreateProjectForm } from "@/components/project/create-project-form";
import { useSession } from "@/components/session/session-provider";
import { isAidtModuleEnabled } from "@/features/aidt/lib/aidt-module-config";
import { AIDT_PROJECT_TAG, AIDT_PROJECT_LABEL, aidtHref } from "@/features/aidt/lib/project-aidt";
import { createProject, findProject, updateProjectTags } from "@/lib/live-projects";

/** Module-local profile orchestration; the shared form only owns native form controls. */
export function AidtCreateProjectForm({ cancel }: { cancel: React.ReactNode }) {
  const { session } = useSession();
  const scope = JSON.stringify([session?.userId, session?.currentOrgId, session?.sessionToken]);
  const lifecycle = React.useRef({ scope, generation: 0 });
  if (lifecycle.current.scope !== scope) lifecycle.current = { scope, generation: lifecycle.current.generation + 1 };
  const generation = lifecycle.current.generation;
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [created, setCreated] = React.useState<{ scope: string; generation: number; id: string } | null>(null);
  const savedProject = created?.scope === scope && created.generation === generation ? created : null;
  const create = React.useCallback(async (input: Parameters<typeof createProject>[0]) => {
    const current = () => mounted.current && lifecycle.current.scope === scope && lifecycle.current.generation === generation && isAidtModuleEnabled();
    if (!current() || !session?.userId || !session.currentOrgId || !session.sessionToken || input.orgId !== session.currentOrgId) return null;
    try {
      const out = savedProject ?? await createProject(input);
      if (!current()) return null;
      setCreated({ scope, generation, id: out.id });
      const project = await findProject(input.orgId, out.id);
      if (!current()) return null;
      if (!project) throw new Error("Created project metadata is unavailable");
      const saved = await updateProjectTags(out.id, Array.from(new Set([...project.tags, AIDT_PROJECT_TAG])));
      if (!current()) return null;
      if (!saved.tags.includes(AIDT_PROJECT_TAG)) throw new Error("AIDT project profile was not persisted");
      return out;
    } catch (error) {
      if (!current()) return null;
      throw error;
    }
  }, [scope, generation, savedProject, session]);
  if (!isAidtModuleEnabled()) return <section role="status" data-testid="aidt-create-disabled"><p>教学模块尚未启用。</p>{cancel}</section>;
  if (!session?.userId || !session.currentOrgId || !session.sessionToken) return <section role="status" data-testid="aidt-create-identity-required"><p>请先登录并选择组织。</p>{cancel}</section>;
  return <CreateProjectForm key={scope} cancel={cancel} createProjectAction={create} createdHref={aidtHref} nameLabel="小组名与研究挑战" namePlaceholder="例如：第三组 · 校园午餐体验" intro={<p className="text-13 font-medium">{AIDT_PROJECT_LABEL}</p>} nameLocked={savedProject !== null} submitLabel={savedProject ? "重试保存 AIDT 类型" : undefined} failurePrefix={savedProject ? "项目已创建，AIDT 类型尚未保存；再次提交只会重试保存类型，不会重复建项目。" : undefined} />;
}
