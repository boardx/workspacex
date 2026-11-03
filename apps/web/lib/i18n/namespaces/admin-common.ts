export const adminCommonZhCN = {
  "adminCommon.retry": "重试",
  "adminCommon.refresh": "刷新",
  "adminCommon.cancel": "取消",
  "adminCommon.save": "保存",
  "adminCommon.platform": "平台运营",
  "adminCommon.headerNoOrg": "尚未选择组织",
  "adminCommon.loadingBudget": "额度读取中…",
  "adminCommon.headerUnset": "组织本月额度未设置",
  "adminCommon.viewSwitch": "切换卡片视图或列表视图",
  "adminCommon.cards": "卡片",
  "adminCommon.list": "列表",
  "adminCommon.noBackend": "尚未接入真实后端",
  "adminCommon.orgId": "组织 ID {id}",
  "adminCommon.headerFailed": "额度读取失败（{error}）",
  "adminCommon.headerPercent": "本月组织额度 {percent}%",
  "adminCommon.days": "还剩 {count} 天",
  "adminCommon.prototypeExplanation": "此功能尚未接入真实后端——没有对应的服务端接口，以下内容为静态演示数据，任何操作都不会真的生效。"
} as const;

export const adminCommonEn: Record<keyof typeof adminCommonZhCN, string> = {
  "adminCommon.retry": "Retry",
  "adminCommon.refresh": "Refresh",
  "adminCommon.cancel": "Cancel",
  "adminCommon.save": "Save",
  "adminCommon.platform": "Platform operations",
  "adminCommon.headerNoOrg": "No organization selected",
  "adminCommon.loadingBudget": "Loading budget…",
  "adminCommon.headerUnset": "Organization monthly budget is not set",
  "adminCommon.viewSwitch": "Switch between card and list views",
  "adminCommon.cards": "Cards",
  "adminCommon.list": "List",
  "adminCommon.noBackend": "Not connected to a live backend",
  "adminCommon.orgId": "Organization ID {id}",
  "adminCommon.headerFailed": "Could not load budget ({error})",
  "adminCommon.headerPercent": "Organization budget this month: {percent}%",
  "adminCommon.days": "{count} days remaining",
  "adminCommon.prototypeExplanation": "This feature has no live backend or server API. The content below is static demonstration data; actions do not take effect."
};
