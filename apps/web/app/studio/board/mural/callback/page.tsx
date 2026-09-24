"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { completeMuralOAuth } from "@/lib/live-whiteboard";

export default function MuralOAuthCallbackPage() {
  const router = useRouter(),
    params = useSearchParams(),
    [error, setError] = useState(false);
  useEffect(() => {
    const state = params.get("state"),
      code = params.get("code");
    if (!state || !code) {
      setError(true);
      return;
    }
    let active = true;
    void completeMuralOAuth({ state, code })
      .then((result) => {
        if (active)
          router.replace(
            `${result.returnTo}${result.returnTo.includes("?") ? "&" : "?"}mural=connected`,
          );
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [params, router]);
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <section className="max-w-md rounded-panel border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="text-20 font-semibold">连接 Mural</h1>
        {error ? (
          <p role="alert" className="mt-3 text-14 text-destructive">
            授权无法完成。请返回白板并重新连接 Mural。
          </p>
        ) : (
          <p role="status" className="mt-3 text-14 text-muted-foreground">
            正在验证一次性授权并安全保存连接…
          </p>
        )}
      </section>
    </main>
  );
}
