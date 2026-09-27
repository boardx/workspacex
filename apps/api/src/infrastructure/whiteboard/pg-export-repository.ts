import type { Principal } from '../../domain/principal';
import type { DatabasePort } from '../../application/ports/database.port';
import type { WhiteboardExportRecord,WhiteboardExportRepository } from '../../application/whiteboard/import-service';

type ExportRow={id:string;board_id:string;actor_id:string;request_hash:string;epoch:number;seq:string;object_key:string;sha256:string;size_bytes:string;file_name:string;created_at:Date|string};
const select=`SELECT id,board_id,actor_id,request_hash,epoch,seq::text,object_key,sha256,size_bytes::text,file_name,created_at FROM whiteboard_exports`;
const iso=(value:Date|string)=>value instanceof Date?value.toISOString():new Date(value).toISOString();
const project=(row:ExportRow):WhiteboardExportRecord=>({exportId:row.id,boardId:row.board_id,actorId:row.actor_id,requestHash:row.request_hash,epoch:row.epoch,seq:Number(row.seq),objectKey:row.object_key,sha256:row.sha256,sizeBytes:Number(row.size_bytes),fileName:row.file_name,createdAt:iso(row.created_at)});

/** PostgreSQL contains export metadata only; canonical package bytes remain in ObjectStore. */
export class PgWhiteboardExportRepository implements WhiteboardExportRepository{
  constructor(private readonly db:DatabasePort){}
  async create(p:Principal,record:WhiteboardExportRecord){return this.db.withTenant(p.orgId,async session=>{await session.query(`INSERT INTO whiteboard_exports(org_id,board_id,id,actor_id,request_hash,epoch,seq,object_key,sha256,size_bytes,file_name,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(org_id,board_id,id) DO NOTHING`,[p.orgId,record.boardId,record.exportId,p.userId,record.requestHash,record.epoch,record.seq,record.objectKey,record.sha256,record.sizeBytes,record.fileName,record.createdAt]);const result=await session.query<ExportRow>(`${select} WHERE org_id=$1 AND board_id=$2 AND id=$3 FOR UPDATE`,[p.orgId,record.boardId,record.exportId]),row=result.rows[0];if(!row)throw new Error('WHITEBOARD_EXPORT_INSERT_FAILED');const existing=project(row),conflict=existing.actorId!==p.userId||existing.requestHash!==record.requestHash||existing.epoch!==record.epoch||existing.seq!==record.seq||existing.objectKey!==record.objectKey||existing.sha256!==record.sha256||existing.sizeBytes!==record.sizeBytes;return{record:existing,replayed:!conflict&&existing.createdAt!==record.createdAt,conflict};});}
  async get(p:Principal,boardId:string,exportId:string){return this.db.withTenant(p.orgId,async session=>{const result=await session.query<ExportRow>(`${select} WHERE org_id=$1 AND board_id=$2 AND id=$3`,[p.orgId,boardId,exportId]);return result.rows[0]?project(result.rows[0]):null;});}
}
