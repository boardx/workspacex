"use client";

import { SessionProvider } from "@/components/session/session-provider";
import { GlobalErrorReporter } from "@/components/system/global-error-reporter";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <GlobalErrorReporter />
      {children}
    </SessionProvider>
  );
}
