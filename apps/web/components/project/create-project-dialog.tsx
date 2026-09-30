"use client";
import * as React from "react";
import Link from "next/link";
import { Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CreateProjectForm } from "./create-project-form";

/**
 * 「新建项目」弹窗（#4743）—— 与系统其它创建弹窗（问卷库 CreateSurveyDialog 等）同一结构：
 * Dialog + 标题 + 说明 + 表单。只有一个字段（项目名称）；成功后跳进新项目；次要入口
 * 「用工作坊模板创建」通往 `/project/new?mode=workshop` 向导。testid 沿用 `/project/new` 页的一套。
 *
 * 表单组件随弹窗关闭卸载，所以每次打开都是空白状态。
 */
export function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="project-new" data-mode="general">
        <DialogTitle data-testid="project-new-title">新建项目</DialogTitle>
        <DialogDescription>
          项目是团队的工作空间：对话、白板、访谈、问卷、研究都收在一起。起个名字就能开始，内容进项目后再加。
        </DialogDescription>
        <CreateProjectForm
          cancel={
            <Button type="button" size="sm" variant="ghost" className="transition-colors" data-testid="project-new-cancel" onClick={() => onOpenChange(false)}>
              取消
            </Button>
          }
        />
        <Link
          href="/project/new?mode=workshop"
          data-testid="project-new-workshop-link"
          className="flex items-center gap-2 self-start rounded-md px-1 py-1 text-12 text-muted-foreground transition-colors duration-base hover:text-background-foreground"
        >
          <Presentation aria-hidden className="h-3.5 w-3.5" />
          要办一场工作坊？<span className="text-primary">用工作坊模板创建</span>
        </Link>
      </DialogContent>
    </Dialog>
  );
}
