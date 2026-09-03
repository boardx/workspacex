/**
 * @generated 由 apps/api/scripts/gen-design-facet-catalog.ts 从
 * `apps/api/src/domain/templates/design-facet-table.ts` 派生，**请勿手改**。
 *
 * 改这里不会改变定义表，只会让侧栏与后端分母漂移——而「同一事实声明在两处必然漂移」
 * 是本仓已踩过九次的坑。要改请改定义表，然后跑：
 *   pnpm --filter @repo/api exec tsx scripts/gen-design-facet-catalog.ts
 *
 * 门控：pnpm --filter @repo/api exec tsx scripts/gen-design-facet-catalog.ts --check
 * （挂在 @repo/api 的 lint 上；`blueprint-designer-shell.test.tsx` 也会跑一次）
 */

/** 目录里的一项。字段与 `DesignFacetDefinition` 同源，外加契约今天带不动的 `group`（分组由本文件的结构表达） */
export interface DesignFacetCatalogItem {
  readonly designFacetKey: string;
  readonly label: string;
  /** 发布门槛的唯一驱动（I-6）。今天全 false 是**数据缺口 D-2**，不是没有门 */
  readonly required: boolean;
  /** 组内序 */
  readonly ordinal: number;
}

export interface DesignFacetCatalogGroup {
  readonly group: string;
  readonly label: string;
  readonly items: readonly DesignFacetCatalogItem[];
}

export interface DesignFacetCatalog {
  /** 五个组恒存在，空组也出现 */
  readonly groups: readonly DesignFacetCatalogGroup[];
  /** ⚠ 分母由服务端算，前端**不许**数 `items.length` */
  readonly denominator: number;
}

export const DESIGN_FACET_CATALOG: DesignFacetCatalog = {
  "groups": [
    {
      "group": "basic",
      "label": "基本配置",
      "items": [
        {
          "designFacetKey": "topic-and-background",
          "label": "主题与背景",
          "required": false,
          "ordinal": 1
        },
        {
          "designFacetKey": "flow-agenda",
          "label": "流程 Agenda",
          "required": false,
          "ordinal": 2
        },
        {
          "designFacetKey": "grouping-rule",
          "label": "分组规则",
          "required": false,
          "ordinal": 3
        }
      ]
    },
    {
      "group": "pre-input",
      "label": "会前输入",
      "items": [
        {
          "designFacetKey": "survey",
          "label": "问卷",
          "required": false,
          "ordinal": 1
        },
        {
          "designFacetKey": "interview-and-subjects",
          "label": "访谈与对象",
          "required": false,
          "ordinal": 2
        },
        {
          "designFacetKey": "pre-tasks",
          "label": "会前任务",
          "required": false,
          "ordinal": 3
        }
      ]
    },
    {
      "group": "onsite",
      "label": "现场",
      "items": [
        {
          "designFacetKey": "venue-and-format",
          "label": "场地与形式",
          "required": false,
          "ordinal": 1
        },
        {
          "designFacetKey": "project-materials",
          "label": "项目材料",
          "required": false,
          "ordinal": 2
        },
        {
          "designFacetKey": "print-materials",
          "label": "分组打印素材",
          "required": false,
          "ordinal": 3
        }
      ]
    },
    {
      "group": "ai",
      "label": "AI 能力",
      "items": [
        {
          "designFacetKey": "agent-orchestration",
          "label": "Agent 编排",
          "required": false,
          "ordinal": 1
        },
        {
          "designFacetKey": "skill-binding",
          "label": "Skill 绑定",
          "required": false,
          "ordinal": 2
        }
      ]
    },
    {
      "group": "output",
      "label": "产出",
      "items": [
        {
          "designFacetKey": "outputs",
          "label": "输出物",
          "required": false,
          "ordinal": 1
        },
        {
          "designFacetKey": "report-template",
          "label": "报告模板",
          "required": false,
          "ordinal": 2
        }
      ]
    }
  ],
  "denominator": 13
};
