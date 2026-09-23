/**
 * 「这一屏的数字是示例，不是你的数据」——**独立发布的本地版必须说这句话**（#3872 R10）。
 *
 * ## 为什么要有这个组件
 *
 * 2026-09-23 在真实安装版（全新本地库、零项目）上逐条打开 17 条导航路由，读每一屏
 * `main` 的实际文本，发现三屏在**什么都没有的机器上**显示了编造的数字：
 *
 * | 路由                | 实测看到的                                              |
 * | ------------------- | ------------------------------------------------------- |
 * | `/brain`            | 「我（私有层）86 / 项目层 1,482 / 组织大脑 604」        |
 * | `/tpl`              | 「用过 12 次 · 满意度 4.6（9 场）」                      |
 * | `/asset-governance` | 「远洋咨询 · org_8f21 · 4,820 万 / 6,200 万 tokens」     |
 *
 * 空白屏只是没用（R10 的另一条修的就是 `/tasks` 的空白）；**编造的数字比空白更糟**，
 * 因为用户没有办法知道它是假的——`/asset-governance` 连组织名和组织 ID 都是编的，
 * 而旁边 `/skill`、`/canvas` 这些屏显示的是同一个界面里的真实组织 ID。同一个外壳里
 * 真假混排，用户学不会该信哪一个。本仓自己的规矩也写在 `/tasks` 的页脚上：
 * 「样本不足或口径表未配置时不显示折算值，**不编造数字**」。
 *
 * `/agent` 是对照组：它也是纯 mock，但自己写了「当前为示例展示，暂未开放使用」，
 * 所以它不在名单里——本组件要补的是**没说**的那三屏。
 *
 * ## 名单是人维护的，这一点不粉饰
 *
 * 想做成静态门（「import 了 @/lib/mock 的 page 必须挂 banner」）是不成立的：`/rec`、
 * `/research`、`/skill`、`/tasks` 的 page 同样 import mock（预览模式用），但默认渲染的
 * 是活数据；而三屏假数据的 page 与它们在 import 形状上**完全一样**（live-refs 都是 0，
 * 活性在下一层组件里）。所以判据只能来自**把每条路由真的打开看一眼**。
 * `PROTOTYPE_DATA_ROUTES` 因此是一份带日期和取证方式的显式名单：
 * 测试只能保证「名单里的都挂了 banner」，**不能**保证「没挂 banner 的都不是假数据」。
 * 以后新增导航路由时，这道门不会替你发现它——要重跑那一轮逐屏实测。
 */
import { FlaskConical } from "lucide-react";

/** 文案只写在这里一处：#3872 R10 之前本仓已经有 11 例「同一事实声明在两处」。 */
export const PROTOTYPE_DATA_NOTICE =
  "这一屏展示的是示例数据，不是你工作区里的内容——上面的数量、比例和名称都不反映你的实际情况。";

/**
 * 实测（2026-09-23，真实安装版，全新本地库）默认就渲染编造数字、且自己没有声明的路由。
 * 取证与名单的局限见文件头。
 */
export const PROTOTYPE_DATA_ROUTES = ["/brain", "/tpl", "/asset-governance"] as const;

export function PrototypeDataBanner({ className }: { className?: string }): JSX.Element {
  return (
    <div
      data-testid="prototype-data-banner"
      role="note"
      className={`flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 ${className ?? ""}`}
    >
      <FlaskConical aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <p className="text-11 leading-relaxed text-muted-foreground">{PROTOTYPE_DATA_NOTICE}</p>
    </div>
  );
}
