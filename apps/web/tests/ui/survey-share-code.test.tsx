import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SurveyShareCode } from '@/components/survey/live/share-code';
const encode=vi.hoisted(()=>vi.fn(async()=> 'data:image/png;base64,real-code'));
vi.mock('qrcode',()=>({default:{toDataURL:encode}}));
it('encodes the actual respondent link locally and allows download',async()=>{
 render(<SurveyShareCode link="https://example.com/surveys/actual-token"/>);
 fireEvent.click(screen.getByRole('button',{name:'生成二维码'}));
 expect(await screen.findByRole('img',{name:'问卷分享二维码'})).toHaveAttribute('src','data:image/png;base64,real-code');
 expect(encode).toHaveBeenCalledWith('https://example.com/surveys/actual-token',expect.objectContaining({errorCorrectionLevel:'M'}));
 expect(screen.getByRole('link',{name:'下载二维码'})).toHaveAttribute('download','survey-qr.png');
});
