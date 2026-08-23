import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Menu —— 契约束 interaction-primitives（F09）复合组件之一。
 *
 * feature notes 明确要求「menu 组件复用 F01 的 dropdown 底层实现」——本文件不重新实现
 * 弹层逻辑，只给 `dropdown-menu.tsx`（Radix DropdownMenu + F01 token 皮肤）起一套更贴合
 * 「菜单」语义的别名，供业务目录替换掉手写的：
 *   `open` state + `document.addEventListener("mousedown"/"keydown", …)` 手动实现
 *   外点关闭 / Esc 关闭 + `role="menu"` 绝对定位 div。
 * Radix 原生已经把焦点陷阱、Esc 关闭、外点关闭、↑↓ 导航、type-ahead 都做对了，
 * 业务目录不需要、也不应该再手写一份（这正是本次盘点发现的 5 处重复）。
 */
export const Menu = DropdownMenu;
export const MenuTrigger = DropdownMenuTrigger;
export const MenuContent = DropdownMenuContent;
export const MenuItem = DropdownMenuItem;
export const MenuLabel = DropdownMenuLabel;
export const MenuSeparator = DropdownMenuSeparator;
export const MenuGroup = DropdownMenuGroup;
export const MenuRadioGroup = DropdownMenuRadioGroup;
export const MenuRadioItem = DropdownMenuRadioItem;
