"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { useSession } from "@/components/session/session-provider";

export default function OrgAdminLayout({ children }: { children: ReactNode }) {
  const { status, identity } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const canAccess = status === "authenticated" && identity?.orgRole === "admin";

  useEffect(() => {
    if (status !== "authenticated" || !identity || canAccess) return;
    if (pathname === "/org-admin/agent" || pathname === "/org-admin/skill") {
      router.replace(pathname.slice("/org-admin".length) + window.location.search);
    } else {
      router.replace("/home");
    }
  }, [status, identity, canAccess, pathname, router]);

  if (status === "dependency-failed" || status === "anonymous") {
    // Reuse session recovery and the sanitized login return URL without mounting admin pages.
    return <AppShell previewRole={null}>{null}</AppShell>;
  }

  return canAccess ? children : null;
}
