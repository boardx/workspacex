'use client';
import { useI18n } from "@/lib/i18n/provider";
import { useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';

export function SurveyShareCode({link}: {link:string}) {
  const { t } = useI18n();
  const [code, setCode] = useState<{link:string; image:string} | null>(null);
  const [busy,setBusy]=useState(false);
  const [failed,setFailed]=useState(false);
  return <section aria-label={t("survey.workspace.shareQr")} className="space-y-3 rounded-lg border border-border bg-card p-4">
    <Button variant="outline" disabled={!link || busy} onClick={async()=>{
      setBusy(true);setFailed(false);
      try { setCode({link,image:await QRCode.toDataURL(link,{errorCorrectionLevel:'M',margin:4,width:256})}); }
      catch {setFailed(true);} finally {setBusy(false);}
    }}>{busy ? t("survey.workspace.generating") : t("survey.workspace.generateQr")}</Button>
    {failed && <p role="alert" className="text-12 text-destructive">{t("survey.workspace.qrFailed")}</p>}
    {code?.link===link && <div className="flex flex-wrap items-center gap-4">
      {/* A local data URL keeps respondent links out of third-party QR services. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={code.image} alt={t("survey.workspace.qrAlt")} width={160} height={160}/>
      <a href={code.image} download="survey-qr.png" className="text-13 underline">{t("survey.workspace.downloadQr")}</a>
    </div>}
  </section>;
}
