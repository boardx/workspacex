"use client";
import * as React from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import { type Identity } from "@/lib/identity";
import { apiUrl } from "@/lib/api-client";
import { useAuthedImageSrc } from "@/lib/use-authed-image-src";
import { useOptionalSession } from "@/components/session/session-provider";
import { updateOrganization } from "@/lib/live-org-admin";
import {
  Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/utils";

/**
 * 左上角组织标识 → 组织菜单（2026-08-11 信息架构调整，人类直接要求：
 * 「组织头像应该放在左上角的 X 的位置，点击 X 可以出来菜单切换组织，
 *   以及一些基础的和组织相关的功能菜单」）。
 *
 * 此前左上角是黑底 `X` logo，点击直接跳 `/org-admin`；顶栏另有一个独立的组织切换器
 * （`top-bar.tsx` 的 `OrgSwitcher`）。现在两者合并到这里：触发器显示组织头像
 * （拿不到时回落组织名首字），点击弹出菜单 = 「切换组织」区块 + 「组织管理」入口。
 * 顶栏那个独立切换器已删——同一功能不许两个入口。
 *
 * F09 起与 `personal-menu.tsx` 一起改走 `components/ui/menu.tsx`（Radix DropdownMenu 别名，
 * 见 F01/F09）：外点关闭 + Escape 关闭 + 焦点陷阱 + ↑↓ 导航都由 Radix 原生提供，
 * 不再手写 `document.mousedown`/`keydown` 监听。「切换组织」列表用 `MenuRadioGroup` +
 * `MenuRadioItem`（`role="menuitemradio"`、`aria-checked`、选中态 Check 图标均由 Radix
 * 原生渲染，语义比手写 button 更准确）。
 *
 * ## 触发器视觉与回落方案（交付说明里要求写理由）
 * - 有组织头像 ⇒ 圆角方块小图（`rounded-md`）。组织用圆角方，个人用正圆
 *   （`personal-menu.tsx` 的 `rounded-full`）——两类主体在同一根栏上必须一眼可分，
 *   这是 Slack/Teams 一脉的通行区分，不是发明。
 * - 无头像 ⇒ 保留原来的黑底（`bg-inverse`）方块，但字从品牌 `X` 换成**组织名首字**：
 *   这个位置的语义已经从「产品 logo」变成「你当前所在的组织」，继续画 X 会宣称一个
 *   错误的身份；首字与左下角个人头像首字母同一套读法，用户已经会读。
 *   组织名彻底拿不到（极端时序）时才回落 `X`。
 *
 * ⚠ 2026-09-03 一度加过 `triggerVariant="grid"`（图标栏左上角强制画黑底 9 宫格图标，
 *   不管组织有没有真实头像）——2026-09-04 用户直接反馈（issue 2636 号）「左上角组织
 *   icon 显示错误：应优先用组织已上传的图片，没有则用组织名首字生成默认头像」，
 *   否掉了那个方向：9 宫格让「切换组织」这件事失去了「这是哪个组织」的视觉线索，
 *   而这正是本文件最早那版设计签核要解决的问题。已删除 `triggerVariant`，触发器
 *   回到唯一一种视觉：头像图 / 组织名首字，不再有第二种「宫格图标」皮肤。
 *
 * ## 组织头像的读路径（invite-link-and-reads delta ④ 之后）
 * 首选 `identity.org.avatarUrl`——`resolveIdentity` 的 `Organization` 实体已带 avatarUrl
 * （delta ④，全员可得）：登录即有、零额外请求、非 admin 也能显示真实组织头像。
 * `updateOrganization({orgId})` 空补丁即读（admin-only，`sets.length === 0` 分支是纯
 * SELECT）**保留为 `invalidateOrgAvatar` 之后的刷新通道**：admin 在组织资料页上传新头像
 * 后，session 里的 identity 还是旧 URL（不重新 resolveIdentity），要靠这条不经 session
 * 缓存的权威回读把左上角当场刷新——所以它不能退役，也只在失效后才被触发（非 admin
 * 永远不打这条注定 403 的请求）。
 */

/** orgId → avatarUrl（相对路径或 null）。失败不缓存——下次挂载重试；成功（含「没头像」）缓存，壳层每次导航不重复打请求。 */
const orgAvatarCache = new Map<string, string | null>();
const orgAvatarListeners = new Set<() => void>();

/**
 * 组织头像变更后让左上角菜单跟着刷新（`org-admin-screen.tsx` 上传成功后调）——
 * 同 `session.updateOrgName` 改组织名时刷新顶栏的先例：同一个事实两处显示，
 * 不许等整页 reload 才同步。
 */
export function invalidateOrgAvatar(orgId: string): void {
  orgAvatarCache.delete(orgId);
  orgAvatarListeners.forEach((l) => l());
}

function useOrgAvatarUrl(orgId: string, identityAvatarUrl: string | null, adminCanRefresh: boolean): string | null {
  // override：`invalidateOrgAvatar` 之后经空补丁读拿到的比 session identity 更新的权威值
  // （模块缓存里的条目）。undefined = 没有覆盖值，用 identity 里登录即得的那份。
  const [override, setOverride] = React.useState<string | null | undefined>(() =>
    orgAvatarCache.has(orgId) ? orgAvatarCache.get(orgId) ?? null : undefined,
  );
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    orgAvatarListeners.add(listener);
    return () => {
      orgAvatarListeners.delete(listener);
    };
  }, []);

  React.useEffect(() => {
    if (orgAvatarCache.has(orgId)) {
      setOverride(orgAvatarCache.get(orgId) ?? null);
      return;
    }
    // 缓存没有条目 = 从未失效过（首次挂载）或刚被 `invalidateOrgAvatar` 清掉。
    // 首次挂载不发请求——identity 里已经带了 avatarUrl（delta ④，零额外请求）；
    // 只有失效过（version > 0，即上传过新头像）且当前身份能调 admin-only 空补丁读时，
    // 才走刷新通道拿最新值。非 admin 不发注定 403 的请求，安静用 identity 旧值。
    if (version === 0 || !adminCanRefresh) {
      setOverride(undefined);
      return;
    }
    let cancelled = false;
    void updateOrganization({ orgId })
      .then((out) => {
        orgAvatarCache.set(orgId, out.avatarUrl);
        if (!cancelled) setOverride(out.avatarUrl);
      })
      .catch(() => {
        // 拉不到头像不是错误态——安静回落（identity 值或组织名首字），不打扰壳层。
        if (!cancelled) setOverride(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [adminCanRefresh, orgId, version]);

  return override !== undefined ? override : identityAvatarUrl;
}

export function OrgMenu({
  identity, organizations, onSelect, switching, placement = "right", testIdSuffix = "",
}: {
  identity: Identity;
  organizations: ReadonlyArray<{ id: string; label: string }>;
  onSelect: (orgId: string) => void;
  switching?: boolean;
  /** rail 实例菜单往右弹；移动端顶栏实例往下弹 */
  placement?: "right" | "below";
  /** 移动端顶栏实例传 "-mobile"，避免与 ≥md 的 rail 实例撞 data-testid */
  testIdSuffix?: string;
}) {
  const session = useOptionalSession();

  // 见文件头「组织头像的读路径」：URL 首选 identity（全员、零请求）；
  // admin-only 空补丁读只作为上传头像后（invalidateOrgAvatar）的刷新通道。
  const adminCanRefresh = session?.status === "authenticated" && identity.orgRole === "admin";
  const avatarUrl = useOrgAvatarUrl(identity.org.id, identity.org.avatarUrl, adminCanRefresh);
  // ⚠ 用 `apiUrl()` 拼，不许 `${apiBaseUrl()}${path}` 字符串拼接——后者会吃掉
  //   `NEXT_PUBLIC_API_PATH_PREFIX`（fullstack e2e 的同源代理前缀），实测 404。
  const { src: avatarSrc } = useAuthedImageSrc(avatarUrl ? apiUrl(avatarUrl) : null);

  const orgName = identity.org.name?.trim() ?? "";
  const orgInitial = orgName.charAt(0) || "X";

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          data-testid={`org-switcher${testIdSuffix}`}
          aria-label={`组织菜单，当前：${orgName || "组织"}`}
          title={orgName || "组织菜单"}
          disabled={switching}
          className={cn(
            "flex h-8 w-8 items-center justify-center overflow-hidden rounded-md transition-all duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            switching ? "cursor-wait opacity-60" : "hover:scale-105",
            avatarSrc ? "border border-border bg-card" : "bg-inverse text-14 font-semibold text-inverse-foreground hover:bg-inverse/90",
          )}
        >
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- 组织头像来自后端 object store（鉴权 blob URL），非 Next 静态资源
            <img src={avatarSrc} alt="" data-testid={`org-menu-avatar${testIdSuffix}`} className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden>{orgInitial}</span>
          )}
        </button>
      </MenuTrigger>
      <MenuContent
        side={placement === "right" ? "right" : "bottom"}
        align={placement === "right" ? "start" : "start"}
        sideOffset={8}
        aria-label="组织菜单"
        data-testid={`org-menu${testIdSuffix}`}
        // max-h + 滚动：组织数量多（10+）时菜单不溢出视口——复核读代码起疑的预防项，
        // 固定宽 w-52 不变，超高时列表内部滚动。
        className="max-h-[70vh] w-52 overflow-y-auto"
      >
        <MenuLabel className="pb-1 pt-1.5 text-10 uppercase tracking-wide">切换组织</MenuLabel>
        <MenuRadioGroup
          value={identity.org.id}
          onValueChange={(id) => {
            if (id !== identity.org.id) onSelect(id);
          }}
        >
          {organizations.map((o) => (
            <MenuRadioItem
              key={o.id}
              value={o.id}
              data-testid={`org-switcher-option-${o.id}${testIdSuffix}`}
              className={cn(o.id === identity.org.id ? "font-medium text-primary" : "text-card-foreground")}
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>

        <MenuSeparator />

        {/* 组织功能区块：只放有真实后端支撑的入口，不发明死入口 */}
        <MenuItem asChild>
          <Link
            href="/org-admin"
            data-testid={`org-admin-entry${testIdSuffix}`}
            aria-label="组织管理"
            className="gap-2"
          >
            <Settings aria-hidden className="h-3.5 w-3.5" />
            组织管理
          </Link>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
