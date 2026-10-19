"""Small daily NAS delta after verified publication; never restore or start workers."""
from hashlib import sha256
from pathlib import Path
import json,os,time
from datetime import datetime,timezone

ROOT=Path(__file__).resolve().parents[1]

def file_sha(path):
    digest=sha256()
    with Path(path).open('rb',buffering=0) as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()

def store(folder,name,raw):
    """Resume only this snapshot's fully hashed pending file; keep final immutable."""
    file=Path(folder)/name;digest=sha256(raw).hexdigest();pending=file.with_suffix('.pending')
    if file.exists():
        if file_sha(file)!=digest:raise ValueError('Immutable NAS delta conflict')
        return digest
    if not pending.is_file() or file_sha(pending)!=digest:
        with pending.open('wb',buffering=0) as stream:
            for offset in range(0,len(raw),1024*1024):
                block=memoryview(raw)[offset:offset+1024*1024]
                while block:
                    count=stream.write(block)
                    if not count:raise OSError('NAS pending short write')
                    block=block[count:]
    if file_sha(pending)!=digest:raise ValueError('NAS pending SHA mismatch')
    for attempt in range(3):
        try:os.replace(pending,file);break
        except OSError:
            if file.is_file() and file_sha(file)==digest:break
            if attempt==2:raise
            time.sleep(.2*(attempt+1))
    if file_sha(file)!=digest:raise ValueError('NAS SHA mismatch')
    return digest


def save(policy,source,publication,upstream_bundle=None,snapshot_path=None):
    nas=Path(policy['handoff_root']);nas.mkdir(parents=True,exist_ok=True)
    snapshot=Path(snapshot_path or ROOT/'public/data/v2/latest.json');latest=json.loads(snapshot.read_bytes())
    folder=nas/'daily'/latest['date']/latest['snapshot_id'];folder.mkdir(parents=True,exist_ok=True)
    files={
      'source.private.json':Path(source).read_bytes(),
      'snapshot.json':snapshot.read_bytes(),
      'history.private.json':(Path(policy.get('series_root',ROOT/'.local'))/'v2-history.json').read_bytes(),
      'publication.json':(json.dumps(publication,indent=2)+'\n').encode()}
    if upstream_bundle:
        for file in Path(upstream_bundle).iterdir():
            if file.is_file():files['upstream-'+file.name]=file.read_bytes()
    audit=ROOT/'.local/comparison-audits'/(latest['snapshot_id']+'.json')
    if audit.exists():files['comparison-audit.private.json']=audit.read_bytes()
    for name in ['baseline-reconstruction.json','baseline-sources/rebuild-receipt.json']:
        file=Path(policy.get('series_root',ROOT/'.local'))/name
        if file.exists():files[Path(name).name]=file.read_bytes()
    entries={}
    for name,raw in files.items():
        try:digest=store(folder,name,raw)
        except (OSError,ValueError) as error:
            (Path(source).parent/'handoff-error.json').write_text(json.dumps({'at_utc':datetime.now(timezone.utc).isoformat(),'snapshot_id':latest['snapshot_id'],'target':str(folder/name),'error_type':type(error).__name__,'errno':getattr(error,'errno',None),'winerror':getattr(error,'winerror',None),'message':str(error)},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
            raise
        entries[name]={'sha256':digest,'bytes':len(raw)}
    manifest={'snapshot_id':latest['snapshot_id'],'date':latest['date'],'files':entries,
      'restore_jobs_enabled':False,'live_source_db_restored':False}
    raw=(json.dumps(manifest,indent=2)+'\n').encode();store(folder,'manifest.json',raw)
    if (folder/'manifest.json').read_bytes()!=raw:raise ValueError('NAS manifest readback mismatch')
    if snapshot_path is None:
        pending=nas/'daily-latest.pending';pending.write_text(json.dumps({'path':str(folder.relative_to(nas)),'snapshot_id':latest['snapshot_id']}),encoding='utf-8');os.replace(pending,nas/'daily-latest.json')
    return {'status':'verified','snapshot_id':latest['snapshot_id'],'files':len(entries),'path':str(folder),'manifest_sha256':sha256(raw).hexdigest()}
