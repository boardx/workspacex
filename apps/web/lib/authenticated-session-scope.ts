"use client";
import { useRef } from "react";
import { useSession } from "@/components/session/session-provider";
/** A render-time isolation key, without putting a session token into React keys or DOM.
 * Any session transition unmounts the old resource UI before its state can be disclosed.
 */
export function useAuthenticatedSessionScope(): number | null {
  const { status, session } = useSession();
  const previous = useRef({ status, userId: session?.userId, orgId: session?.currentOrgId, token: session?.sessionToken, revision: 0 });
  const value = previous.current;
  if (value.status !== status || value.userId !== session?.userId || value.orgId !== session?.currentOrgId || value.token !== session?.sessionToken) {
    previous.current = { status, userId: session?.userId, orgId: session?.currentOrgId, token: session?.sessionToken, revision: value.revision + 1 };
  }
  return status === "authenticated" && session ? previous.current.revision : null;
}
