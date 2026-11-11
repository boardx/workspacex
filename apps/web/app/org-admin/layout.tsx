"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/components/session/session-provider";

export default function OrgAdminLayout({ children }: { children: ReactNode }) {
  const { status, identity } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const canAccess = status === "authenticated" && identity?.orgRole === "admin";

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
      return;
    }
    if (status !== "authenticated" || !identity || canAccess) return;
    if (pathname === "/org-admin/agent" || pathname === "/org-admin/skill") {
      router.replace(pathname.slice("/org-admin".length) + window.location.search);
    } else {
      router.replace("/home");
    }
  }, [status, identity, canAccess, pathname, router]);

  return canAccess ? children : null;
}
