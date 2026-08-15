"use client";

/**
 * 后台管理统一标准（2026-08-15，人类原话：「对于后台的管理功能，修改为一个统一的标准，
 * 类似 skill 目录，左边还是保留一个 column 显示当前的后台菜单，右边列出卡片来表达当前的
 * entity 的列表，卡片也可以切换为列表，需要有这个切换的功能」）——通用「卡片 / 列表」
 * 双态目录容器，供各 admin 子屏（Agent / Skill / 模型 / MCP / 画布模板…）复用。
 *
 * ## 设计取舍
 *
 * ① **内容渲染完全交给调用方**（`renderCard` / `renderListRow`），本组件只负责「切换态」
 *    与「布局容器」。两个 render prop 允许渲染**同一个**组件（只是外层网格/纵向排列不同）——
 *    很多既有列表行本身已经是一张 `<Card>`（比如 `capability-catalog-screen.tsx` 的
 *    `CapabilityRow`），这种情况下卡片视图与列表视图的差别只在「网格排列」还是
 *    「单列纵向排列」，不需要为了这次改动重新发明一套卡片渲染。
 * ② **本地 state，不持久化**。人类原话没有要求跨会话记住上次选择，`useState` 足够；
 *    需要持久化时调用方可以自己接 `defaultView` + 提升 state（本组件不强绑定 URL/localStorage）。
 * ③ **testid 约定**（调用方与门控脚本都依赖这个形状，改动前先看谁在读）：
 *    - 切换按钮：`{prefix}-view-toggle-card` / `{prefix}-view-toggle-list`
 *    - 外层容器（始终存在，与当前视图无关）：`{prefix}-view-container`
 *    - 当前视图的内容容器：默认 `{prefix}-card-grid` / `{prefix}-list`，
 *      可用 `cardContainerTestId`/`listContainerTestId` 覆盖——接入一个已有既定 testid 的
 *      目录（比如 `admin-agent-list`）时，把两个都指向同一个既有 testid 即可做到
 *      「不管当前是卡片还是列表，断言都读同一个容器」，不用改任何既有测试。
 */

import * as React from "react";
import { LayoutGrid, LayoutList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type EntityViewMode = "card" | "list";

const DEFAULT_CARD_CLASS_NAME = "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 items-start";
const DEFAULT_LIST_CLASS_NAME = "flex flex-col gap-2";

export interface EntityViewToggleProps<T> {
  /** testid 前缀（例如 `"admin-agent"`），同时用于派生下面几个 testid 的默认值。 */
  prefix: string;
  entities: readonly T[];
  keyOf: (entity: T) => string;
  renderCard: (entity: T) => React.ReactNode;
  renderListRow: (entity: T) => React.ReactNode;
  /** 初始视图，默认 `"card"`（人类原话「默认卡片视图」）。 */
  defaultView?: EntityViewMode;
  cardClassName?: string;
  listClassName?: string;
  /** 覆盖卡片态内容容器的 testid，默认 `${prefix}-card-grid`。 */
  cardContainerTestId?: string;
  /** 覆盖列表态内容容器的 testid，默认 `${prefix}-list`。 */
  listContainerTestId?: string;
  className?: string;
}

export function EntityViewToggle<T>({
  prefix,
  entities,
  keyOf,
  renderCard,
  renderListRow,
  defaultView = "card",
  cardClassName,
  listClassName,
  cardContainerTestId,
  listContainerTestId,
  className,
}: EntityViewToggleProps<T>) {
  const [view, setView] = React.useState<EntityViewMode>(defaultView);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex justify-end">
        <div
          className="inline-flex overflow-hidden rounded-md border border-border"
          role="group"
          aria-label="切换卡片 / 列表视图"
        >
          <Button
            type="button"
            size="xs"
            variant={view === "card" ? "primary" : "ghost"}
            aria-pressed={view === "card"}
            onClick={() => setView("card")}
            data-testid={`${prefix}-view-toggle-card`}
          >
            <LayoutGrid aria-hidden className="h-3.5 w-3.5" />
            卡片
          </Button>
          <Button
            type="button"
            size="xs"
            variant={view === "list" ? "primary" : "ghost"}
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
            data-testid={`${prefix}-view-toggle-list`}
          >
            <LayoutList aria-hidden className="h-3.5 w-3.5" />
            列表
          </Button>
        </div>
      </div>
      <div data-testid={`${prefix}-view-container`}>
        {view === "card" ? (
          <div
            className={cardClassName ?? DEFAULT_CARD_CLASS_NAME}
            data-testid={cardContainerTestId ?? `${prefix}-card-grid`}
          >
            {entities.map((entity) => (
              <React.Fragment key={keyOf(entity)}>{renderCard(entity)}</React.Fragment>
            ))}
          </div>
        ) : (
          <div
            className={listClassName ?? DEFAULT_LIST_CLASS_NAME}
            data-testid={listContainerTestId ?? `${prefix}-list`}
          >
            {entities.map((entity) => (
              <React.Fragment key={keyOf(entity)}>{renderListRow(entity)}</React.Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
