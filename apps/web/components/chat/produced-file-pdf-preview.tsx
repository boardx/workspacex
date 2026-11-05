"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { createPortal } from "react-dom";
import { Download, Eye } from "lucide-react";
import { Modal } from "@/components/files/overlay";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/chat-attachment-format";
import type { ActiveFile } from "@/lib/agui-file-events";

/**
 * #3563 — preview an agent-produced PDF with the browser's native PDF viewer.
 * `src` is the same authenticated blob URL used by the adjacent download link, so previewing
 * neither invents a second content endpoint nor fetches the attachment bytes again.
 */
export function ProducedFilePdfPreview({ file, src }: { file: ActiveFile; src: string }): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        type="button"
        size="xs"
        variant="outline"
        className="shrink-0"
        data-testid="chat-produced-file-pdf-preview-trigger"
        onClick={() => setOpen(true)}
      >
        <Eye aria-hidden className="h-3.5 w-3.5" />{t("chatInspector.file.preview")}</Button>
      {open ? <ProducedFilePdfPreviewModal file={file} src={src} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ProducedFilePdfPreviewModal({
  file,
  src,
  onClose,
}: {
  file: ActiveFile;
  src: string;
  onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return createPortal(
    <div className="fixed inset-0 z-40" data-testid="chat-produced-file-pdf-preview-portal">
      <Modal
        testid="chat-produced-file-pdf-preview"
        title={file.name}
        subtitle={`application/pdf${file.bytes !== null ? ` · ${formatBytes(file.bytes)}` : ""}`}
        onClose={onClose}
        width="lg"
        footer={
          <>
            <Button type="button" size="sm" variant="ghost" data-testid="chat-produced-file-pdf-preview-dismiss" onClick={onClose}>{t("chatInspector.file.close")}</Button>
            <Button type="button" size="sm" variant="primary" asChild>
              <a href={src} download={file.name} data-testid="chat-produced-file-pdf-preview-download">
                <Download aria-hidden className="h-3.5 w-3.5" />{t("chatInspector.download")}</a>
            </Button>
          </>
        }
      >
        <iframe
          src={src}
          title={t("chatInspector.file.pdfTitle", { name: file.name })}
          className="h-[65vh] w-full rounded-md border border-border-subtle"
          data-testid="chat-produced-file-pdf-preview-frame"
        />
      </Modal>
    </div>,
    document.body,
  );
}
