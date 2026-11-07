import { REPORT_FILE_FORMATS } from '@repo/contracts/report-files';
import type { FileRequest } from './job-ports';

/** Change when visible export rules change, so persisted older files cannot be reused. */
export const REPORT_EXPORT_RENDER_POLICY = 'report-presentation-v2';

export function reportDownloadFilename(title: string, format: FileRequest['format']): string {
  const cleaned = title.normalize('NFC').replace(/[\x00-\x1f\x7f-\x9f/\\:*?"<>|\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/gu, ' ').replace(/^[. ]+|[. ]+$/gu, '');
  let stem = '';
  for (const character of cleaned) {
    if (Buffer.byteLength(stem + character, 'utf8') > 180) break;
    stem += character;
  }
  stem = stem.trim().replace(/[. ]+$/u, '') || '报告';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(stem)) stem = `报告 ${stem}`;
  return `${stem}${REPORT_FILE_FORMATS[format].extension}`;
}
