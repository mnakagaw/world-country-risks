"""Small daily NAS delta after verified publication; never restore or start workers."""
from hashlib import sha256
from pathlib import Path
import json,os,time,re
from handoff_objects import SCHEMA,FILE_LIMIT,PACKET_LIMIT,nas_guard,record_objects,load_manifest,verify,record_history,contained
from datetime import datetime,timezone
from cycle_lock import publication_lock

ROOT=Path(__file__).resolve().parents[1]

class PacketBindingConflict(OSError):
    """A sealed packet cannot certify a different current input set."""

def file_sha(path,metrics=None,limit=FILE_LIMIT):
    digest=sha256()
    started=time.perf_counter();count=0
    with Path(path).open('rb',buffering=0) as stream:
        while block:=stream.read(min(1024*1024,limit-count+1)):
            count+=len(block)
            if count>limit:raise ValueError('NAS object byte limit')
            digest.update(block)
    if metrics is not None:
        metrics['NAS_read_bytes']+=count;metrics['NAS_read_seconds']+=time.perf_counter()-started;metrics['fullSHA_reads']+=1
    return digest.hexdigest()

def store(folder,name,raw,metrics=None):
    """Resume only this snapshot's fully hashed pending file; keep final immutable."""
    if len(raw)>FILE_LIMIT:raise ValueError('NAS member byte limit')
    file=Path(folder)/name;digest=sha256(raw).hexdigest();pending=file.with_suffix('.pending');started=time.perf_counter()
    if file.exists():
        if file_sha(file,metrics,len(raw))!=digest:raise ValueError('Immutable NAS delta conflict')
        if metrics is not None:metrics['reused_objects']+=1;metrics['reused_bytes']+=len(raw)
        return digest
    if not pending.is_file() or file_sha(pending,metrics,len(raw))!=digest:
        writing=time.perf_counter()
        with pending.open('wb',buffering=0) as stream:
            for offset in range(0,len(raw),1024*1024):
                block=memoryview(raw)[offset:offset+1024*1024]
                while block:
                    count=stream.write(block)
                    if not count:raise OSError('NAS pending short write')
                    block=block[count:]
        if metrics is not None:metrics['NAS_write_bytes']+=len(raw);metrics['NAS_write_seconds']+=time.perf_counter()-writing;metrics['written_objects']+=1
    if file_sha(pending,metrics,len(raw))!=digest:raise ValueError('NAS pending SHA mismatch')
    for attempt in range(3):
        try:os.replace(pending,file);break
        except OSError:
            if file.is_file() and file_sha(file,metrics,len(raw))==digest:break
            if attempt==2:raise
            time.sleep(.2*(attempt+1))
    if file_sha(file,metrics,len(raw))!=digest:raise ValueError('NAS SHA mismatch')
    return digest


def _save(policy,source,publication,upstream_bundle=None,snapshot_path=None,audit_path=None):
    started=time.perf_counter();nas=Path(policy['handoff_root']);nas_guard(nas,2*PACKET_LIMIT)
    snapshot=Path(snapshot_path or ROOT/'public/data/v2/latest.json')
    if snapshot.stat().st_size>64*1024**2:raise ValueError('Snapshot byte limit')
    with snapshot.open('rb') as stream:snapshot_raw=stream.read(64*1024**2+1)
    if len(snapshot_raw)>64*1024**2:raise ValueError('Snapshot byte limit')
    metadata=json.loads(snapshot_raw);latest={'date':metadata['date'],'snapshot_id':metadata['snapshot_id']};del metadata
    if not isinstance(latest['date'],str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',latest['date']) or not isinstance(latest['snapshot_id'],str) or not re.fullmatch('[a-f0-9]{64}',latest['snapshot_id']):raise ValueError('Invalid NAS snapshot locator')
    datetime.strptime(latest['date'],'%Y-%m-%d')
    folder=contained(nas/'daily'/latest['date']/latest['snapshot_id'],nas);folder.mkdir(parents=True,exist_ok=True)
    metrics={'started_at_utc':datetime.now(timezone.utc).isoformat(),'schema':SCHEMA,'NAS_read_bytes':0,'NAS_read_seconds':0.0,'NAS_write_bytes':0,'NAS_write_seconds':0.0,'fullSHA_reads':0,'reused_objects':0,'reused_bytes':0,'written_objects':0,'files':{}}
    files={'source.private.json':Path(source),'snapshot.json':snapshot_raw,'history.private.json':Path(policy.get('series_root',ROOT/'.local'))/'v2-history.json','publication.json':(json.dumps(publication,indent=2)+'\n').encode()}
    bundle_files=None
    if upstream_bundle:
        control=Path(upstream_bundle)/'manifest.json'
        if control.stat().st_size>4*1024**2:raise ValueError('Upstream manifest byte limit')
        with control.open('rb') as stream:control_raw=stream.read(4*1024**2+1)
        if len(control_raw)>4*1024**2:raise ValueError('Upstream manifest byte limit')
        bundle_files=json.loads(control_raw)['files']
        if not isinstance(bundle_files,dict):raise ValueError('Invalid upstream frozen inventory')
        for file in Path(upstream_bundle).iterdir():
            if file.is_file():files['upstream-'+file.name]=file
    audit=Path(audit_path) if audit_path is not None else ROOT/'.local/comparison-audits'/(latest['snapshot_id']+'.json')
    if audit.exists():files['comparison-audit.private.json']=audit
    for name in ['baseline-reconstruction.json','baseline-sources/rebuild-receipt.json','baseline-dto-index.json']:
        file=Path(policy.get('series_root',ROOT/'.local'))/name
        if file.exists():files[Path(name).name]=file
    if (folder/'manifest.json').exists():
        old=load_manifest(folder)
        if old.get('snapshot_id')!=latest['snapshot_id'] or set(old['files'])!=set(files):raise PacketBindingConflict('Existing NAS packet current member set differs')
        binding_started=time.perf_counter();binding_bytes=0
        for name,value in files.items():
            if isinstance(value,Path):
                limit=FILE_LIMIT if name=='history.private.json' else 64*1024**2
                observed=file_sha(value,limit=limit);length=value.stat().st_size
            else:observed=sha256(value).hexdigest();length=len(value)
            row=old['files'][name];binding_bytes+=length
            if observed!=row['sha256'] or length!=row['bytes']:raise PacketBindingConflict('Existing NAS packet current member differs: '+name)
        metrics['current_input_binding']={'bytes':binding_bytes,'seconds':time.perf_counter()-binding_started,'all_members_equal':True}
        checked=verify(folder);digest=file_sha(folder/'manifest.json',metrics,4*1024**2)
        metrics['existing_packet_verification']=checked
        metrics['NAS_read_counter_scope']='store() fullSHA reads only; existing_packet_verification bytes/seconds are additional'
        if snapshot_path is None:latest_pointer(nas,folder,latest['snapshot_id'],digest,old.get('schema','legacy-flat-v1'))
        metrics.update(status='verified',reused_complete_packet=True,elapsed_seconds=time.perf_counter()-started)
        (Path(source).parent/'handoff-performance.json').write_text(json.dumps(metrics,indent=2)+'\n',encoding='utf-8')
        return {'status':'verified','snapshot_id':latest['snapshot_id'],'files':len(old['files']),'path':str(folder),'manifest_sha256':digest,'performance':metrics}
    entries={};total=0
    try:
        for name,value in files.items():
            t=time.perf_counter();read_started=t
            if name=='history.private.json':
                entry,input_seconds=record_history(nas,value,store,metrics);entries[name]=entry;total+=entry['bytes']
                if total>PACKET_LIMIT:raise ValueError('NAS expanded packet byte limit')
                metrics['files'][name]={'input_bytes':entry['bytes'],'local_input_read_seconds':input_seconds,'store_verify_seconds':time.perf_counter()-t-input_seconds,'elapsed_seconds':time.perf_counter()-t,'storage':'sha256-parts-v1'}
                continue
            if isinstance(value,Path):
                if value.stat().st_size>64*1024**2:raise ValueError('NAS input member byte limit')
                with value.open('rb') as stream:raw=stream.read(64*1024**2+1)
            else:raw=value
            total+=len(raw)
            if len(raw)>FILE_LIMIT or total>PACKET_LIMIT:raise ValueError('NAS expanded packet byte limit')
            if len(raw)>64*1024**2:raise ValueError('NAS input member byte limit')
            if name.startswith('upstream-') and name!='upstream-manifest.json':
                if bundle_files.get(name[len('upstream-'):])!=sha256(raw).hexdigest():raise ValueError('Frozen upstream member SHA changed')
            input_seconds=time.perf_counter()-read_started
            if name.startswith('upstream-'):
                entries[name]=record_objects(nas,raw,store,metrics)
            else:
                nas_guard(nas,len(raw)*2);checksum=store(folder,name,raw,metrics=metrics);entries[name]={'sha256':checksum,'bytes':len(raw)}
            metrics['files'][name]={'input_bytes':len(raw),'local_input_read_seconds':input_seconds,'store_verify_seconds':time.perf_counter()-t-input_seconds,'elapsed_seconds':time.perf_counter()-t,'storage':entries[name].get('storage',{}).get('kind','flat')}
        manifest={'schema':SCHEMA,'snapshot_id':latest['snapshot_id'],'date':latest['date'],'files':entries,'restore_jobs_enabled':False,'live_source_db_restored':False}
        raw=(json.dumps(manifest,indent=2)+'\n').encode()
        if len(raw)>4*1024**2:raise ValueError('NAS manifest byte limit')
        checksum=store(folder,'manifest.json',raw,metrics=metrics)
        if (folder/'manifest.json').read_bytes()!=raw:raise ValueError('NAS manifest readback mismatch')
        if snapshot_path is None:
            latest_pointer(nas,folder,latest['snapshot_id'],checksum,SCHEMA)
        metrics.update(status='verified',finished_at_utc=datetime.now(timezone.utc).isoformat(),elapsed_seconds=time.perf_counter()-started)
        (Path(source).parent/'handoff-performance.json').write_text(json.dumps(metrics,indent=2)+'\n',encoding='utf-8')
        return {'status':'verified','snapshot_id':latest['snapshot_id'],'files':len(entries),'path':str(folder),'manifest_sha256':checksum,'performance':metrics}
    except (OSError,ValueError) as error:
        metrics.update(status='failed',error_type=type(error).__name__,elapsed_seconds=time.perf_counter()-started)
        (Path(source).parent/'handoff-error.json').write_text(json.dumps({'at_utc':datetime.now(timezone.utc).isoformat(),'snapshot_id':latest['snapshot_id'],'target':str(folder),'error_type':type(error).__name__,'errno':getattr(error,'errno',None),'winerror':getattr(error,'winerror',None),'message':str(error),'performance':metrics},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        raise


def save(policy,source,publication,upstream_bundle=None,snapshot_path=None,audit_path=None):
    nas=Path(policy['handoff_root']);nas_guard(nas,2*PACKET_LIMIT)
    with publication_lock(nas/'objects-store.lock') as acquired:
        if not acquired:raise OSError('NAS object store owner busy')
        try:result=_save(policy,source,publication,upstream_bundle,snapshot_path,audit_path)
        except PacketBindingConflict as error:
            (Path(source).parent/'handoff-error.json').write_text(json.dumps({'at_utc':datetime.now(timezone.utc).isoformat(),'status':'deferred_immutable_input_conflict','error_type':type(error).__name__,'message':str(error),'old_manifest_unchanged':True})+'\n',encoding='utf-8')
            raise
        result['performance']['store_OS_lock']=True
        return result


def latest_pointer(nas,folder,snapshot,checksum,schema):
    target=nas/'daily-latest.json';before=target.read_bytes() if target.exists() else None
    raw=(json.dumps({'path':folder.relative_to(nas).as_posix(),'snapshot_id':snapshot,'manifest_sha256':checksum,'handoff_schema':schema})+'\n').encode()
    pending=nas/'daily-latest.pending';pending.write_bytes(raw)
    if (target.read_bytes() if target.exists() else None)!=before:raise ValueError('NAS latest pointer changed concurrently')
    os.replace(pending,target)
    if target.read_bytes()!=raw:raise ValueError('NAS latest locator readback mismatch')
