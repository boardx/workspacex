"""Offline semantic audit + reproducible whole apps/packages runtime symbol scan.
Only frozen Git objects are read; no source snippets, object values or network.
"""
import hashlib
import io
import json
import re
import subprocess
from pathlib import Path
from inventory import SOURCE_SHA
from source_audit import git_read

RULES = {
    'object_store_write': r'\bputOnce\s*\(|\bputObject\s*\(|\buploadObject\s*\(',
    'object_store_delete': r'\bpurgeExact\s*\(|\bdeleteObject\s*\(',
    'object_reference': r'\b(?:objectKey|object_key|object_storage_key|storageKey|storage_ref|storageRef|extracted_ref|extractedRef)\b',
    'indirect_json_manifest': r'\b(?:model_output_files|capture|manifest|sourceHistory|receipt)\b',
    'url_reference': r'\b(?:download_url|downloadUrl|signedUrl|presignedUrl|storageUrl)\b',
}
SEMANTICS = [
 ('apps/api/src/application/files/export-artifacts.ts', 'export_url_and_manifest', ['manifestSha256 =', 'const downloadUrl =', 'manifestBytes'],
  'downloadUrl is an API export-jobs content route, not an additional bucket object; object_key is ZIP authority. manifestSha256 hashes manifestBytes, not ZIP stream. Current producer deliberately requires independent ZIP stream SHA/size.'),
 ('apps/api/src/application/chat/upload-attachment.ts', 'chat_upload', ['storageRef =', 'putOnce(storageRef', 'insertAttachment('],
  'storage_ref is raw object key chat-attachments/{org}/{id}; bytes persisted, no persisted content SHA. Stream establishes independent initial content fact.'),
 ('apps/api/src/application/chat/attachment-extraction-worker.ts', 'extracted_markdown', ['extractedObjectKey(', 'putOnce(extractedRef', 'recordExtracted('],
  'extracted_ref is another real object chat-attachments-extracted/{org}/{attachment}.md; not an artifact-version alias. Publication persists key without content SHA/size.'),
 ('apps/api/src/infrastructure/chat/pg-attachment-extraction-repository.ts', 'extraction_publication_and_cancel', ['completeCancelled(', 'UPDATE chat_message_attachments SET extracted_ref'],
  'publication and extracted_ref update share tenant transaction; cancelled cleanup can physically purge before deleting attachment row. A cancelled in-flight row may point at already-removed objects; not yet filtered by producer.'),
 ('apps/api/src/application/chat/pending-attachment-cleanup.ts', 'cancelled_attachment_generation', ['purgeExact(', 'completeCancelled('],
  'both deterministic original/extracted keys are HEADed and exact version purged; cleanup races require lifecycle barrier and version snapshot.'),
 ('apps/api/src/application/agent-run/collect-native-outputs.ts', 'native_output_orphans', ['unreferenced immutable', 'const key =', 'files.push('],
  'writes content-addressed agent-run-outputs keys; failed batch may retain unreferenced objects. Returned files contain objectKey/sizeBytes, not a durable SHA field.'),
 ('apps/api/src/application/agent-run/run-skill-script.ts', 'skill_output_keys', ['objectKeyFor', 'putOnce(key', 'files.push('],
  'caller-supplied objectKeyFor or default run key used for output files; complete caller/wiring namespace closure not yet proved.'),
 ('apps/api/src/infrastructure/agent-run/pg-agent-run-repository.ts', 'pending_output_json', ['model_output_files=$5::jsonb', 'file.objectKey'],
  'agent_runs.model_output_files stores JSON refs before attachment landing; success landing copies key to chat_message_attachments. JSON-only pending states omitted by current producer.'),
 ('apps/api/src/infrastructure/agent-run/standard-image-service.ts', 'image_generation_durable_objects', ['const prefix=', '/intent.json', '/result.json', '/image`'],
  'image-generation/{hash(org)}/{hash(run)}/{hash(idempotency)} stores intent/image/result.json; intent precedes billable submission, including failed/unknown outcome. No direct key-column projection covers all three.'),
 ('apps/api/src/infrastructure/agent-run/standard-audio-service.ts', 'audio_generation_durable_objects', ['prefix=', '/intent.json', '/transcript.json', '/receipt.json'],
  'audio service stores intent/transcript/receipt deterministic objects. Receipt JSON contains content digest; retries read object facts. Prefix/key discovery needs runtime inputs or bucket listing.'),
 ('apps/api/src/application/whiteboard/board-backup.ts', 'secondary_backup_store', ['private archiveKey(', 'private manifestKey(', 'this.secondary'],
  'secondary store uses board-backups/{tenantHash}/{backupId}/blobs/{hash} and manifest.json, derived from captured JSON. Primary key inventory cannot cover this second namespace or its partial failures.'),
 ('apps/api/src/infrastructure/whiteboard/pg-board-backup.ts', 'backup_capture_and_pins', ['INSERT INTO whiteboard_backups', 'INSERT INTO whiteboard_backup_pins', 'manifest.sourceHistory'],
  'capture JSON contains snapshot/image/comment/sourceHistory refs; durable pins project primary refs. Secondary archive keys are not the pin keys.'),
 ('apps/api/src/infrastructure/whiteboard/pg-object-retention.ts', 'gc_history', ['swept_at IS NOT NULL', "status='purging'", "'deleted':'failed'", 'INSERT INTO whiteboard_object_gc_audit'],
  'tombstones/receipts/audit describe generation lifecycle and deleted objects; do not require all history keys to exist in recovery snapshot. Producer classifies these columns as history and never scans them as live roots.'),
 ('apps/api/src/infrastructure/whiteboard/pg-backup-maintenance.ts', 'released_backup_pins', ['SET released_at=now()', 'released_at IS NULL'],
  'release changes reachability; historical pin rows persist. Producer requires released_at IS NULL.'),
 ('apps/api/src/domain/vfs/vfs-uri.ts', 'vfs_indirect_uri', ['model_output_files', 'vfs://', 'VFS_DOMAINS'],
  'vfs://attachment/id and vfs://artifact/id refer to authoritative DB identities, not object keys. Resolve through actual DB tables; parsing URI as bucket key is incorrect.'),
 ('apps/api/src/infrastructure/storage/oss-object-store.ts', 'physical_namespace', ['objectKey', 'putOnce(', 'this.client.put('],
  'logical keys are transformed by OSS adapter; bucket/root and actual object version identity require configuration binding, not application SHA alone.'),
]


def files_at_source():
    paths = [p for p in git_read('ls-tree','-r','--name-only',SOURCE_SHA,'apps','packages').splitlines()
             if re.search(r'\.(?:ts|tsx|js|jsx|mjs|cjs|py)$', p)]
    refs = ''.join(SOURCE_SHA+':'+p+'\n' for p in paths).encode()
    process = subprocess.run(['git','cat-file','--batch'],input=refs,capture_output=True,check=False)
    if process.returncode: raise RuntimeError('FROZEN_RUNTIME_READ_FAILED')
    stream = io.BytesIO(process.stdout)
    result = {}
    for path in paths:
        parts = stream.readline().split()
        if len(parts)!=3 or parts[1]!=b'blob': raise RuntimeError('FROZEN_RUNTIME_OBJECT_INVALID')
        size = int(parts[2]); content = stream.read(size)
        if len(content)!=size or stream.read(1)!=b'\n': raise RuntimeError('FROZEN_RUNTIME_OBJECT_TRUNCATED')
        result[path] = (parts[0].decode(),content)
    return result


def audit():
    files = files_at_source()
    corpus = [{'path':path,'gitBlob':blob,'sha256':hashlib.sha256(content).hexdigest()}
              for path,(blob,content) in sorted(files.items())]
    records = []
    for fact in corpus:
        text = files[fact['path']][1].decode('utf-8')
        hits = {name:[n for n,line in enumerate(text.splitlines(),1) if re.search(pattern,line)]
                for name,pattern in RULES.items()}
        if any(hits.values()): records.append({**fact,'symbolLines':{k:v for k,v in hits.items() if v}})
    semantics=[]
    for path,kind,anchors,meaning in SEMANTICS:
        blob, content = files[path]; lines=content.decode().splitlines()
        located={anchor:[n for n,line in enumerate(lines,1) if anchor in line] for anchor in anchors}
        if any(not value for value in located.values()):
            raise RuntimeError('SEMANTIC_AUDIT_ANCHOR_MISSING:'+kind)
        semantics.append({'path':path,'gitBlob':blob,'sha256':hashlib.sha256(content).hexdigest(),
                          'kind':kind,'anchorLines':located,'conclusion':meaning})
    return {'sourceSha':SOURCE_SHA,'ready':False,'complete':False,
            'coverage':{'scannedRoots':['apps','packages'],'extensions':['ts','tsx','js','jsx','mjs','cjs','py'],
                        'scannedFileCount':len(corpus),'matchedFileCount':len(records),
                        'corpusManifestSha256':hashlib.sha256(json.dumps(corpus,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
                        'method':'all frozen Git source blobs scanned; selected write/read/delete paths semantically inspected; symbol scan is not call-graph closure'},
            'semanticFindings':semantics,'referenceCandidates':records,
            'remainingGaps':['JSON-only pending agent_runs.model_output_files not produced',
                             'image/audio deterministic intent and receipt objects not produced',
                             'secondary backup namespace/manifests not produced',
                             'cancelled attachment and object-writer lifecycle snapshot barrier unproven',
                             'unreferenced immutable failed-write objects require full versioned bucket inventory',
                             'runtime wiring and all objectKeyFor callers not exhaustively resolved',
                             'logical-key to physical bucket/root/version binding not established',
                             'symbol matches outside reviewed paths are candidates, not semantically closed',
                             'actual production catalog/permissions/object streams not executed'],
            'missingMetadataRecovery':{'canObserveInitialSnapshotBytes':True,
                 'conditions':['actual full GET for exact bound bucket/key/version','capture independent sha256 and byte count',
                               'compare known database expectations','verify restored GET against captured observation',
                               'never overwrite DB expectations or fabricate original content hash'],
                 'implemented':'observe_stream independent streamObservation; no cloud adapter/version identity binding',
                 'ready':False}}

if __name__=='__main__':
    Path(__file__).with_name('runtime-reference-audit.json').write_text(json.dumps(audit(),indent=2)+'\n')
