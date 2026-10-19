"""Read-only catalog of English Events across quarter and older batch manifests."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from hashlib import sha256
from pathlib import Path
import json,re,os
from run_metadata import RunMetadata


def read_bytes(path):
    with path.open('rb') as file:
        chunks=[]
        while part:=file.read(1024*1024):chunks.append(part)
    return b''.join(chunks)


def catalog(archive,start,end,metadata=None):
    # Folders are labelled by acquisition date in some historical runs. Filter
    # by the declared UTC window and each file ID, never by that date label.
    paths=[]
    # Inspect timestamp directory names before probing any manifest file. A
    # three-part glob stats the literal filename in every historical window on
    # SMB, including years outside this run. Acquisition labels remain ignored.
    with os.scandir(archive/'manifests') as parents:
        for parent in parents:
            # The actual read validates existence/type. Pre-statting each SMB
            # directory would add a separate round trip without a byte proof.
            try:windows=os.scandir(parent.path)
            except NotADirectoryError:continue
            with windows:
                for window in windows:
                    match=re.fullmatch(r'(\d{8}T\d{6}Z)_(\d{8}T\d{6}Z)',window.name)
                    if not match:continue
                    begin=datetime.strptime(match[1],'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
                    finish=datetime.strptime(match[2],'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
                    if finish>start and begin<end:
                        paths.append(Path(window.path)/'gdelt-bulk-manifest.json')
    own=metadata is None;metadata=metadata or RunMetadata(read_bytes)
    normalized_root=(archive/'normalized').resolve()
    def load(path):
        try:
            bulk_doc=metadata.document(path);raw=bulk_doc.raw;bulk=bulk_doc.value;bulk_sha=bulk_doc.sha256
            index_path=archive/'indexes'/('index-v2-'+bulk['dataset_hash'][:16]+'.json')
            index_doc=metadata.document(index_path);index_raw=index_doc.raw;index=index_doc.value
            if index['bulk_manifest_sha256']!=bulk_sha:return [],{'manifest':str(path),'reason':'index_epoch_mismatch'}
            indexed={r['source_file_id']:r for r in index['files']}
            result=[]
            for source in bulk['files']:
                fid=source['file_id']
                if not re.fullmatch(r'\d{14}\.export',fid):continue
                clock=datetime.strptime(fid[:14],'%Y%m%d%H%M%S').replace(tzinfo=timezone.utc)
                if not start<=clock<end:continue
                record=indexed.get(fid)
                if source.get('status') not in ('downloaded','reused') or not record or record.get('status')!='available':continue
                normalized=Path(record['parquet_path']).resolve()
                if not normalized.is_relative_to(normalized_root):raise ValueError('Normalized path outside producer')
                result.append({'slot':clock.isoformat(),'status':'candidate','path':str(normalized),'sha256':record['parquet_sha256'],
                  'bulk_manifest_path':str(path),'bulk_manifest_sha256':bulk_sha,'index_path':str(index_path),
                  'index_sha256':index_doc.sha256,'rows_rejected':record.get('rows_rejected',0),
                  'source_file_id':fid,'source_sha256':source['sha256'],'source_generated_at':bulk.get('generated_at'),
                  'source_window':bulk.get('window')})
            return result,None
        except (OSError,ValueError,KeyError,json.JSONDecodeError) as error:
            return [],{'manifest':str(path),'reason':type(error).__name__}
    records={};failures=[]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for result,error in pool.map(load,paths):
            if error:failures.append(error)
            for row in result:records.setdefault(row['slot'],[]).append(row)
    if own:metadata.verify_all()
    return records,failures
