import {z} from 'zod';
import {NativeSessionBindingRef,NativeSessionResolveInput} from './native-session-binding';
import {limits as sandboxLimits} from './sandbox-session';
export const DOCUMENT_PARSE_LIMITS={timeoutMs:30000,responseBytes:32768} as const;
export const DOCUMENT_OCR_LIMITS={maxPages:10,maxPixels:4194304,maxDimension:2048,maxOutputBytes:sandboxLimits.maxFileBytes} as const;
export const DOCUMENT_STRUCTURE_LIMITS={maxChunks:50000,maxOutputBytes:sandboxLimits.maxFileBytes} as const;
export const DOCUMENT_PARSE_TOOL='wx_document_parse';
export const DocumentParseInput=z.object({workspacePath:z.string().startsWith('/inputs/').max(4096),outputMode:z.enum(['markdown','chunks']).optional(),ocr:z.boolean().optional()}).strict();
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const pixel=z.number().int().nonnegative().max(DOCUMENT_OCR_LIMITS.maxDimension);
export const DocumentOcrStructure=z.object({engine:z.literal('tesseract'),coordinateSpace:z.literal('rendered_page_pixels'),pages:z.array(z.object({
 pageNumber:z.number().int().min(1).max(DOCUMENT_OCR_LIMITS.maxPages),width:pixel.positive(),height:pixel.positive(),
 words:z.array(z.object({text:z.string().min(1),bbox:z.object({x:pixel,y:pixel,width:pixel,height:pixel}).strict(),confidence:z.number().min(0).max(100)}).strict()),
}).strict()).min(1).max(DOCUMENT_OCR_LIMITS.maxPages)}).strict();
const index=z.number().int().nonnegative();
const pageNumber=z.number().int().positive();
const bbox=z.tuple([z.number().nonnegative(),z.number().nonnegative(),z.number().nonnegative(),z.number().nonnegative()]).refine(value=>value[2]>=value[0]&&value[3]>=value[1],'bbox must be ordered');
const nativeEngine=z.object({name:z.enum(['pdfplumber','python-docx','python-pptx','openpyxl']),version:z.string().min(1).max(64)}).strict();
const nativeChunkBase={text:z.string().min(1).max(1_000_000)} as const;
const DocumentNativeChunk=z.discriminatedUnion('type',[
 z.object({...nativeChunkBase,type:z.literal('pdf_text'),locator:z.object({pageNumber,bbox}).strict()}).strict(),
 z.object({...nativeChunkBase,type:z.literal('pdf_table_cell'),locator:z.object({tableId:z.string().regex(/^pdf-table-\d+$/),fragmentIndex:index,pageNumber,pageTableIndex:index,rowIndex:index,columnIndex:index,bbox}).strict()}).strict(),
 z.object({...nativeChunkBase,type:z.literal('docx_paragraph'),locator:z.object({paragraphIndex:index}).strict()}).strict(),
 z.object({...nativeChunkBase,type:z.literal('docx_table_cell'),locator:z.object({tableIndex:index,rowIndex:index,columnIndex:index}).strict()}).strict(),
 z.object({...nativeChunkBase,type:z.literal('pptx_element'),locator:z.object({slideNumber:pageNumber,elementIndex:index,elementName:z.string().max(1024)}).strict()}).strict(),
 z.object({...nativeChunkBase,type:z.literal('pptx_table_cell'),locator:z.object({slideNumber:pageNumber,elementIndex:index,elementName:z.string().max(1024),rowIndex:index,columnIndex:index}).strict()}).strict(),
 z.object({...nativeChunkBase,type:z.literal('xlsx_cell'),locator:z.object({sheetIndex:index,sheetName:z.string().min(1).max(1024),address:z.string().regex(/^\$?[A-Z]{1,3}\$?[1-9]\d*$/),row:pageNumber,column:pageNumber,mergedRange:z.string().max(128).optional()}).strict()}).strict(),
]);
const PdfTableFragment=z.object({tableId:z.string().regex(/^pdf-table-\d+$/),fragmentIndex:index,pageNumber,pageTableIndex:index,bbox,columnCount:index,continuationDetection:z.enum(['none','repeated_header_and_columns'])}).strict();
export const DocumentNativeStructure=z.object({schemaVersion:z.literal(1),engine:nativeEngine,sourceFormat:z.enum(['pdf','docx','pptx','xlsx']),coordinateSpace:z.enum(['pdf_points_top_left','ooxml_native']),tables:z.array(PdfTableFragment).max(DOCUMENT_STRUCTURE_LIMITS.maxChunks).optional(),chunks:z.array(DocumentNativeChunk).min(1).max(DOCUMENT_STRUCTURE_LIMITS.maxChunks)}).strict().superRefine((value,ctx)=>{
 const expected={pdf:'pdfplumber',docx:'python-docx',pptx:'python-pptx',xlsx:'openpyxl'} as const;
 const chunkTypes={pdf:new Set(['pdf_text','pdf_table_cell']),docx:new Set(['docx_paragraph','docx_table_cell']),pptx:new Set(['pptx_element','pptx_table_cell']),xlsx:new Set(['xlsx_cell'])} as const;
 if(value.engine.name!==expected[value.sourceFormat])ctx.addIssue({code:z.ZodIssueCode.custom,message:'engine does not match source format'});
 if((value.sourceFormat==='pdf')!==Boolean(value.tables))ctx.addIssue({code:z.ZodIssueCode.custom,message:'tables are required only for PDF'});
 if(value.coordinateSpace!==(value.sourceFormat==='pdf'?'pdf_points_top_left':'ooxml_native'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'coordinate space does not match source format'});
 if(value.chunks.some(chunk=>!chunkTypes[value.sourceFormat].has(chunk.type as never)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'chunk type does not match source format'});
});
export const DocumentStructure=z.union([DocumentOcrStructure,DocumentNativeStructure]);
const DocumentParseBaseOutput=z.object({textPath:z.string().regex(/^\/workspace\/parsed-[a-f0-9-]{36}\/document\.md$/),sourceHash:digest,textHash:digest,
 source:z.object({attachmentId:z.string().min(1).max(256),path:z.string().max(4096),mediaType:z.string().max(256),sizeBytes:z.number().int().nonnegative()}).strict(),
 warnings:z.array(z.enum(['markdown_only_no_page_coordinates','ocr_not_performed','tables_may_lose_layout','ocr_may_misrecognize_text','cross_page_table_grouping_heuristic','docx_page_numbers_unavailable','office_native_locations_no_rendered_coordinates','formulas_not_calculated'])).max(6)}).strict();
export const DocumentParseOutput=z.union([DocumentParseBaseOutput,DocumentParseBaseOutput.extend({structurePath:z.string().regex(/^\/workspace\/parsed-[a-f0-9-]{36}\/structure\.json$/),structureHash:digest}).strict()]);
export const DocumentParseInvocation=NativeSessionResolveInput.omit({runId:true}).extend({bindingId:NativeSessionBindingRef.shape.bindingId,toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional(),toolName:z.literal(DOCUMENT_PARSE_TOOL),toolArgs:DocumentParseInput}).strict();
