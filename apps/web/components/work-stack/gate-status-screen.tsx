"use client";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GateStatusPanel } from "@/components/work-stack/gate-status-panel";
import { DeniedState } from "@/components/work-stack/states";
import { WORK_SKILLS, type PreviewState } from "@/lib/mock/work-stack";

/** EV04 门状态面板独立签核屏。默认取 S003（G5 未过，演示 verified 灰显）。 */
export function GateStatusScreen({ state, isAdmin }: { state: PreviewState; isAdmin: boolean }) {
  const skill = WORK_SKILLS.find((s) => s.stableId === "S003");
  if (!skill) return null;

  if (state === "denied") {
    return (
      <div data-testid="gate-status-screen" className="p-6">
        <DeniedState testid="gate-status-denied" />
      </div>
    );
  }

  return (
    <div data-testid="gate-status-screen" className="mx-auto max-w-xl p-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>门状态 · {skill.name}</CardTitle>
            <Badge tone="outline">{skill.stableId}</Badge>
            <Badge tone={skill.channel === "verified" ? "primary" : "neutral"} className="ml-auto">
              {skill.channel === "verified" ? "已验证" : "候选"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <GateStatusPanel gates={skill.gates} state={state} isPlatformOperator={isAdmin} />
        </CardContent>
      </Card>
    </div>
  );
}
