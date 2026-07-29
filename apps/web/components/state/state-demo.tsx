"use client";
import { StateShell } from "./state-shell";
import type { UiState } from "@/lib/ui-state";

/**
 * 七态演示 —— 必须是客户端组件：`onCreate` / `retry` 是事件处理器，
 * 服务端组件不能把函数当 props 传给客户端组件（Next.js 会直接报错）。
 * 样板页本身保持服务端组件（它要读 searchParams），演示块下沉到这里。
 */
export function StateDemo({ state }: { state: UiState }) {
  return (
    <StateShell
      state={state}
      emptyHint="这个项目还没有材料，先上传一份试试"
      onCreate={() => window.alert("演示：新建材料")}
      errors={{ email: "邮箱格式不正确", password: "密码至少 12 位" }}
      depFailure={{
        what: "转录服务（ASR）暂时不可用，已排队重试 2 次",
        retry: () => window.location.reload(),
      }}
      denial={{ layer: "project", reason: "你在本项目中没有对应的角色" }}
      successMessage="已保存到项目"
    >
      <div className="flex flex-col gap-2">
        <p className="text-13">这里是默认态的正常内容。</p>
        <p className="text-12 text-muted-foreground">
          切到其他状态可以看到加载骨架、空态引导、字段级错误、依赖失败与无权限说明。
        </p>
      </div>
    </StateShell>
  );
}
