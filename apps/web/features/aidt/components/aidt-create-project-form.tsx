"use client";
import * as React from "react";
import { CreateProjectForm } from "@/components/project/create-project-form";
import { useSession } from "@/components/session/session-provider";
import { isAidtModuleEnabled } from "@/features/aidt/lib/aidt-module-config";
import { aidtHref, isAidtProject } from "@/features/aidt/lib/project-aidt";
import { createProject, findProject } from "@/lib/live-projects";

/** Module-local profile orchestration; the shared form only owns native form controls. */
export function AidtCreateProjectForm({ cancel }: { cancel: React.ReactNode }) {
  const { session, identity } = useSession();
  const scope = JSON.stringify([session?.userId, session?.currentOrgId, session?.sessionToken, identity?.orgRole]);
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
      const out = savedProject ?? await createProject({ ...input, profile: "aidt" });
      if (!current()) return null;
      setCreated({ scope, generation, id: out.id });
      const project = await findProject(input.orgId, out.id);
      if (!current()) return null;
      if (!project || project.id !== out.id || !isAidtProject(project) || project.status !== "active") throw new Error("Created AIDT project metadata is unavailable");
      return out;
    } catch (error) {
      if (!current()) return null;
      throw error;
    }
  }, [scope, generation, savedProject, session]);
  if (!isAidtModuleEnabled()) return <section role="status" data-testid="aidt-create-disabled"><p>教学模块尚未启用。</p>{cancel}</section>;
  if (!session?.userId || !session.currentOrgId || !session.sessionToken) return <section role="status" data-testid="aidt-create-identity-required"><p>请先登录并选择组织。</p>{cancel}</section>;
  return <CreateProjectForm key={scope} className="flex flex-col gap-5 [&_input]:h-12 [&_input]:rounded-xl [&_input]:text-16 [&_button]:h-11 [&_button]:rounded-full [&_button]:px-5" cancel={cancel} createProjectAction={create} createdHref={aidtHref} nameLabel="小组名称" namePlaceholder="例如：第三组" nameLocked={savedProject !== null} submitLabel={savedProject ? "重试打开小组" : "创建小组"} failurePrefix={savedProject ? "已收到创建回执，小组资料尚未核实。重试不会重复创建。" : undefined} />;
}
