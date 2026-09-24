"use client";

/**
 * backlog E6 —— Skill 库默认视图的三个场景入口（方案 B「按场景」）。
 *
 * 入口 / 归属 / 隐藏表的**唯一事实源**是 `@repo/contracts` 的 `skillEntryPoints`；
 * 本组件只负责把列表里的平台行（`platformStableName` 非空）按那张表分进三个入口。
 * 隐藏的底层能力（自动触发 / 管理区）不在这里出现，但**不从数据里删掉**——运行时
 * 解析 / 挂载走的是后端，与这里的展示无关。
 */
import * as React from "react";
import { skillEntryPoints } from "@repo/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { SkillListItem } from "@/lib/live-skill";

/** 该行是否被入口表「接管」（进入某个入口或被隐藏）——这些行不再出现在平铺网格里。 */
export function isEntryManaged(row: SkillListItem): boolean {
  return row.platformStableName != null && skillEntryPoints.entryPointOf(row.platformStableName) !== null;
}

export function isHiddenPlatformSkill(row: SkillListItem): boolean {
  return row.platformStableName != null && skillEntryPoints.entryPointOf(row.platformStableName) === "hidden";
}

export function SkillEntryPoints({
  rows,
  hrefOf,
}: {
  rows: readonly SkillListItem[];
  /** 平台行都是 `skills` 表来源（源码文件支撑），点进去走与卡片「编辑源码」同一个目的地。 */
  hrefOf: (row: SkillListItem) => string;
}) {
  const bySlug = React.useMemo(() => {
    const m = new Map<string, SkillListItem>();
    for (const r of rows) if (r.platformStableName != null) m.set(r.platformStableName, r);
    return m;
  }, [rows]);

  return (
    <section className="grid gap-3 md:grid-cols-3" data-testid="skill-entry-points" aria-label="按场景找 skill">
      {skillEntryPoints.SKILL_ENTRY_POINTS.map((entry) => {
        const members = entry.skillSlugs
          .map((slug) => bySlug.get(slug))
          .filter((r): r is SkillListItem => r !== undefined);
        return (
          <Card key={entry.id} data-testid={`skill-entry-${entry.id}`}>
            <CardContent className="flex h-full flex-col gap-2 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-14 font-semibold">{entry.label}</span>
                <Badge tone="outline">{members.length}</Badge>
              </div>
              <p className="text-11 text-muted-foreground">{entry.promise}</p>
              {members.length === 0 ? (
                <p className="text-11 text-muted-foreground">这个场景的 skill 还没有装到当前组织。</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {members.map((row) => (
                    <li key={row.skillId}>
                      <Button asChild size="xs" variant="ghost" data-testid="skill-entry-member">
                        <a href={hrefOf(row)}>{row.name}</a>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
