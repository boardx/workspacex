"use client";
import * as React from "react";
import Link from "next/link";
import { Check, Settings } from "lucide-react";
import { type Identity } from "@/lib/identity";
import { apiUrl } from "@/lib/api-client";
import { useAuthedImageSrc } from "@/lib/use-authed-image-src";
import { useOptionalSession } from "@/components/session/session-provider";
import { updateOrganization } from "@/lib/live-org-admin";
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
 * 下拉写法照 `personal-menu.tsx`（左下角个人菜单）抄，与之对称：外点关闭 + Escape
 * 关闭；菜单项是原生 button/Link，Tab/Enter/Space 原生可达。
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
 * ## 组织头像的读路径（契约现状，不发明新端点）
 * `resolveIdentity`（session 的身份来源）的 `Organization` 里**没有** avatarUrl 字段；
 * 唯一的读路径是 `updateOrganization({orgId})` 空补丁即读（见 `org-admin-screen.tsx`
 * 文件头：`sets.length === 0` 分支是纯 SELECT）。但这条操作**仅组织 admin** 可调
 * （err 含 `PROJECT_ROLE_INSUFFICIENT`）——所以只在 `orgRole === "admin"` 时尝试拉，
 * 非 admin 成员**不发一个注定 403 的请求**，直接用首字回落。给全员看组织头像需要
 * 契约加读字段（ADR-023 人类签核），本轮不越界。
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

function useOrgAvatarUrl(orgId: string, enabled: boolean): string | null {
  const [url, setUrl] = React.useState<string | null>(() => (enabled ? orgAvatarCache.get(orgId) ?? null : null));
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    orgAvatarListeners.add(listener);
    return () => {
      orgAvatarListeners.delete(listener);
    };
  }, []);

  React.useEffect(() => {
    if (!enabled) {
      setUrl(null);
      return;
    }
    if (orgAvatarCache.has(orgId)) {
      setUrl(orgAvatarCache.get(orgId) ?? null);
      return;
    }
    let cancelled = false;
    void updateOrganization({ orgId })
      .then((out) => {
        orgAvatarCache.set(orgId, out.avatarUrl);
        if (!cancelled) setUrl(out.avatarUrl);
      })
      .catch(() => {
        // 拉不到头像不是错误态——安静回落到组织名首字，不打扰壳层。
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, orgId, version]);

  return url;
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
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const session = useOptionalSession();

  // 见文件头「组织头像的读路径」：只有真实 session 且当前身份是组织 admin 才尝试拉。
  const canFetchAvatar = session?.status === "authenticated" && identity.orgRole === "admin";
  const avatarUrl = useOrgAvatarUrl(identity.org.id, canFetchAvatar);
  // ⚠ 用 `apiUrl()` 拼，不许 `${apiBaseUrl()}${path}` 字符串拼接——后者会吃掉
  //   `NEXT_PUBLIC_API_PATH_PREFIX`（fullstack e2e 的同源代理前缀），实测 404。
  const { src: avatarSrc } = useAuthedImageSrc(avatarUrl ? apiUrl(avatarUrl) : null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const orgName = identity.org.name?.trim() ?? "";
  const orgInitial = orgName.charAt(0) || "X";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-testid={`org-switcher${testIdSuffix}`}
        aria-label={`组织菜单，当前：${orgName || "组织"}`}
        title={orgName || "组织菜单"}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={switching}
        onClick={() => setOpen((v) => !v)}
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

      {open && (
        <div
          role="menu"
          aria-label="组织菜单"
          data-testid={`org-menu${testIdSuffix}`}
          className={cn(
            // max-h + 滚动：组织数量多（10+）时菜单不溢出视口——复核读代码起疑的预防项，
            // 固定宽 w-52 不变，超高时列表内部滚动。
            "absolute z-20 max-h-[70vh] w-52 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md",
            placement === "right" ? "left-[calc(100%+8px)] top-0" : "left-0 top-[calc(100%+4px)]",
          )}
        >
          <span className="block select-none px-2 pb-1 pt-1.5 text-10 font-medium uppercase tracking-wide text-muted-foreground">
            切换组织
          </span>
          {organizations.map((o) => {
            const current = o.id === identity.org.id;
            return (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                data-testid={`org-switcher-option-${o.id}${testIdSuffix}`}
                onClick={() => {
                  setOpen(false);
                  if (!current) onSelect(o.id);
                }}
                className={cn(
                  // focus-visible 背景：纯键盘用户 Tab 到菜单项时要能看见焦点落点——复核实测
                  // 焦点在 DOM 上推进但屏幕上无任何指示（outline 透明、无底色）。
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-200 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  current ? "font-medium text-primary" : "text-card-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {current && <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}

          <div className="my-1 h-px bg-border" aria-hidden />

          {/* 组织功能区块：只放有真实后端支撑的入口，不发明死入口 */}
          <Link
            href="/org-admin"
            role="menuitem"
            data-testid={`org-admin-entry${testIdSuffix}`}
            aria-label="组织管理"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-12 text-card-foreground transition-colors duration-200 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <Settings aria-hidden className="h-3.5 w-3.5" />
            组织管理
          </Link>
        </div>
      )}
    </div>
  );
}
