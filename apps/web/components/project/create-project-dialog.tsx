"use client";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CreateProjectForm } from "./create-project-form";

/**
 * 「新建项目」弹窗（#4743）—— 与系统其它创建弹窗（问卷库 CreateSurveyDialog 等）同一结构：
 * Dialog + 标题 + 说明 + 表单。只有一个字段（项目名称）；成功后跳进新项目。testid 沿用 `/project/new` 页的一套。
 *
 * 表单组件随弹窗关闭卸载，所以每次打开都是空白状态。
 */
export function CreateProjectDialog({ open, onOpenChange, onCloseAutoFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  /** 弹窗是受控打开的（没有 DialogTrigger），Radix 不知道该把焦点还给谁——由调用方接管。 */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="project-new" data-mode="general" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle data-testid="project-new-title">{t("projects.new")}</DialogTitle>
        <DialogDescription>
          {t("projects.createDescription")}
        </DialogDescription>
        <CreateProjectForm
          cancel={
            <Button type="button" size="sm" variant="ghost" className="transition-colors" data-testid="project-new-cancel" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
