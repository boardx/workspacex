"use client";
import * as React from "react";
import { BrainCircuit, Gem, User, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import type { SubscriptionVariant } from "@/lib/mock/billing";

/**
 * 个人菜单入口原型（需求 01 R8 / 03 R8 的前端入口）：
 * 用户菜单新增「购买额度」与「升级 / 我的订阅」两项；已订阅时菜单项带计划标识。
 *
 * ⚠ 这是**原型投影**，不改生产 `components/shell/personal-menu.tsx`——
 *    生产落地时把这两个 MenuItem 接入真实 PersonalMenu（签核后由 feature 实现）。
 */
export function MenuEntriesPreview({
  variant,
  onOpenCashier,
  onOpenSubscription,
}: {
  variant: SubscriptionVariant;
  onOpenCashier: () => void;
  onOpenSubscription: () => void;
}) {
  const subscribed = variant === "active" || variant === "trialing" || variant === "canceled" || variant === "syncing";

  return (
    <div
      data-testid="billing-menu-host"
      className="flex h-full items-start justify-center bg-background pt-12"
    >
      {/* 左下角头像位置的示意（原型画布，非真实三栏骨架） */}
      <div className="flex w-64 flex-col items-center gap-2">
        <p className="text-11 text-muted-foreground">原型画布：个人菜单（左下角头像入口）</p>
        <Menu defaultOpen>
          <MenuTrigger asChild>
            <button
              type="button"
              data-testid="billing-menu-trigger"
              aria-label="个人菜单"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-13 font-medium text-accent-foreground transition-all duration-base hover:bg-accent-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              林
            </button>
          </MenuTrigger>
          <MenuContent side="right" align="end" sideOffset={8} aria-label="个人菜单" data-testid="billing-menu" className="w-52">
            <MenuItem data-testid="billing-menu-profile">
              <User aria-hidden className="h-3.5 w-3.5" />
              个人资料
            </MenuItem>
            <MenuItem data-testid="billing-menu-brain">
              <BrainCircuit aria-hidden className="h-3.5 w-3.5" />
              个人 Brain
            </MenuItem>
            <MenuSeparator />
            <MenuItem data-testid="billing-menu-buy-credits" onSelect={() => onOpenCashier()}>
              <Wallet aria-hidden className="h-3.5 w-3.5" />
              购买额度
            </MenuItem>
            <MenuItem data-testid="billing-menu-subscription" onSelect={() => onOpenSubscription()}>
              <Gem aria-hidden className="h-3.5 w-3.5" />
              {subscribed ? "我的订阅" : "升级订阅"}
              {subscribed && (
                <Badge tone="primary" data-testid="billing-menu-sub-badge" className="ml-auto">
                  Pro
                </Badge>
              )}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}
