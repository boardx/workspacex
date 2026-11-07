import {NativeArtifactPublishInput} from '@repo/contracts/native-artifact-publish';
import {REPORT_FILE_FORMATS} from '@repo/contracts/report-files';
import type {StoredReportFileJob} from './job-ports';
/** Frozen product-action target; also used when instructing the existing Skill. */
export function reportFilePublication(record:StoredReportFileJob){
 const format=REPORT_FILE_FORMATS[record.job.format];
 return NativeArtifactPublishInput.parse({workspacePath:`/workspace/report${format.extension}`,title:record.downloadFilename ?? `report${format.extension}`,mediaType:format.mediaType,idempotencyKey:`report-file:${record.requestId}`});
}
