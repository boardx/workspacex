'use client';
import { useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';

export function SurveyShareCode({link}: {link:string}) {
  const [code, setCode] = useState<{link:string; image:string} | null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  return <section aria-label="分享二维码" className="space-y-3 rounded-lg border border-border bg-card p-4">
    <Button variant="outline" disabled={!link || busy} onClick={async()=>{
      setBusy(true);setError('');
      try { setCode({link,image:await QRCode.toDataURL(link,{errorCorrectionLevel:'M',margin:4,width:256})}); }
      catch {setError('二维码生成失败，请重试。');} finally {setBusy(false);}
    }}>{busy ? '正在生成…' : '生成二维码'}</Button>
    {error && <p role="alert" className="text-12 text-destructive">{error}</p>}
    {code?.link===link && <div className="flex flex-wrap items-center gap-4">
      {/* A local data URL keeps respondent links out of third-party QR services. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={code.image} alt="问卷分享二维码" width={160} height={160}/>
      <a href={code.image} download="survey-qr.png" className="text-13 underline">下载二维码</a>
    </div>}
  </section>;
}
