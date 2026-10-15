"use client";

import * as React from "react";
import { useSession } from "@/components/session/session-provider";
import { DeniedState, LoadingSkeleton } from "@/components/work-stack/states";
import { OfficialDigitalHumanPanel } from "@/components/admin/official-digital-human-panel";
import { AgentDirectory } from "./agent-directory";

export function AgentDirectoryWorkspace({
  onStartChat,
}: {
  onStartChat: (agentId: string, prefill?: string) => void;
}) {
  const { session, identity, status } = useSession();
  // Keys contain only a local revision, never a bearer or organization identity.
  // Replacing org, account or token unmounts the old offer/import and directory together.
  const scope = React.useRef({ orgId: "", userId: "", token: "", revision: 0 });
  const orgId = session?.currentOrgId ?? "";
  const userId = session?.userId ?? "";
  const token = session?.sessionToken ?? "";
  if (scope.current.orgId !== orgId || scope.current.userId !== userId || scope.current.token !== token) {
    scope.current = { orgId, userId, token, revision: scope.current.revision + 1 };
  }
  const revision = scope.current.revision;
  const [refresh, setRefresh] = React.useState({ revision: -1, value: 0 });
  if (!session) {
    return status === "anonymous"
      ? <DeniedState testid="agent-directory-session-denied" />
      : <LoadingSkeleton testid="agent-directory-session-loading" />;
  }
  return (
    <AgentDirectory
      key={revision}
      onStartChat={onStartChat}
      canManageOfficial={identity?.orgRole === "admin"}
      directoryRefreshKey={refresh.revision === revision ? refresh.value : 0}
      officialRoles={
        <OfficialDigitalHumanPanel
          layout="cards"
          onEnabled={() => {
            if (scope.current.revision !== revision) return;
            setRefresh((current) => ({ revision, value: current.revision === revision ? current.value + 1 : 1 }));
          }}
        />
      }
    />
  );
}
