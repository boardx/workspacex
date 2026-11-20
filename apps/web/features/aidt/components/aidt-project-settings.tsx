"use client";
import * as React from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProjectCollaboratorsPanel } from "@/components/project/project-collaborators-panel";

/** Mounted only after the workspace's project and actor membership checks. */
export function AidtProjectSettings({ projectId, readOnly }: { projectId: string; readOnly: boolean }) {
  const [open, setOpen] = React.useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button variant="ghost" size="sm" className="gap-2" data-testid="aidt-project-settings">
        <Settings2 aria-hidden className="h-4 w-4" /><span>设置</span>
      </Button>
    </DialogTrigger>
    <DialogContent className="max-w-3xl" data-testid="aidt-settings-dialog">
      <DialogHeader className="pr-8">
        <DialogTitle>小组设置</DialogTitle>
        <DialogDescription>管理本组成员与访问权限。个人对话与录音不会自动共享。</DialogDescription>
      </DialogHeader>
      <section className="min-h-0 overflow-y-auto" aria-label="本组成员与可见范围" data-testid="aidt-group-members">
        {open && <ProjectCollaboratorsPanel projectId={projectId} readOnly={readOnly} />}
      </section>
    </DialogContent>
  </Dialog>;
}
