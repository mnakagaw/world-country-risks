"""Versioned exact-byte NAS objects and a bounded, read-only restore resolver."""
from pathlib import Path
from hashlib import sha256
import json,os,re,shutil,time
from storage_placement import external_root

MIB=1024**2
OBJECT_LIMIT=4*MIB
FILE_LIMIT=512*MIB
PACKET_LIMIT=1024*MIB
MAX_PARTS=8192
SCHEMA='wcr-daily-handoff-objects-v2'

def digest(value):
    if not isinstance(value,str) or not re.fullmatch('[a-f0-9]{64}',value):raise ValueError('Invalid handoff SHA')
    return value

def size(value,limit):
    if type(value) is not int or not 0<=value<=limit:raise ValueError('Handoff byte limit')
    return value

def contained(path,anchor):
    path=Path(path).absolute();anchor=Path(anchor).absolute()
    if not path.is_relative_to(anchor) or not path.resolve().is_relative_to(anchor.resolve()):raise ValueError('Handoff path escaped')
    for node in [path,*path.parents]:
        if node.is_symlink() or node.is_junction():raise ValueError('Handoff reparse path')
        if node==anchor:break
    return path

def nas_guard(root,additional):
    size(additional,2*PACKET_LIMIT)
    if shutil.disk_usage(root).free-additional<20*1024**3:raise OSError('NAS20GiB plus peak capacity deferred')

def object_path(root,checksum):
    digest(checksum);return contained(Path(root)/'objects/v1'/checksum[:2]/(checksum+'.bin'),root)

def pieces(raw):
    size(len(raw),64*MIB)
    for offset in range(0,len(raw),OBJECT_LIMIT):yield memoryview(raw)[offset:offset+OBJECT_LIMIT]


def record_objects(root,raw,store,metrics):
    refs=[]
    for part in pieces(raw):
        checksum=sha256(part).hexdigest();path=object_path(root,checksum)
        nas_guard(root,len(part)*2);path.parent.mkdir(parents=True,exist_ok=True)
        store(path.parent,path.name,part,metrics=metrics)
        refs.append({'sha256':checksum,'bytes':len(part)})
    return {'sha256':sha256(raw).hexdigest(),'bytes':len(raw),'storage':{'kind':'sha256-parts-v1','parts':refs}}

def history_parts(path):
    """Bounded byte/line fragments; date boundaries reset alignment only."""
    buffer=bytearray();line_start=True;total=0
    with Path(path).open('rb',buffering=MIB) as stream:
        while line:=stream.readline(64*1024):
            total+=len(line)
            if total>FILE_LIMIT:raise ValueError('History input byte limit')
            if line_start and re.match(rb'  "\d{4}-\d{2}-\d{2}":',line) and buffer:
                yield bytes(buffer);buffer.clear()
            line_start=line.endswith(b'\n');view=memoryview(line)
            while view:
                count=min(OBJECT_LIMIT-len(buffer),len(view));buffer.extend(view[:count]);view=view[count:]
                if len(buffer)==OBJECT_LIMIT:yield bytes(buffer);buffer.clear()
    if buffer:yield bytes(buffer)

def record_history(root,path,store,metrics):
    refs=[];whole=sha256();total=0;read_seconds=0.0;parts=iter(history_parts(path))
    while True:
        started=time.perf_counter()
        try:part=next(parts)
        except StopIteration:break
        read_seconds+=time.perf_counter()-started
        whole.update(part);total+=len(part);checksum=sha256(part).hexdigest();target=object_path(root,checksum)
        if len(refs)>=MAX_PARTS:raise ValueError('History part count limit')
        nas_guard(root,len(part)*2);target.parent.mkdir(parents=True,exist_ok=True);store(target.parent,target.name,part,metrics=metrics)
        refs.append({'sha256':checksum,'bytes':len(part)})
    return {'sha256':whole.hexdigest(),'bytes':total,'storage':{'kind':'sha256-parts-v1','parts':refs}},read_seconds

def load_manifest(folder,expected=None):
    folder=Path(folder);path=contained(folder/'manifest.json',folder)
    with path.open('rb') as stream:raw=stream.read(4*MIB+1)
    if len(raw)>4*MIB or expected is not None and sha256(raw).hexdigest()!=expected:raise ValueError('Handoff manifest SHA/size mismatch')
    value=json.loads(raw)
    if value.get('schema') not in (None,SCHEMA):raise ValueError('Unknown handoff manifest schema')
    if value.get('schema')==SCHEMA and (folder.parent.parent.name!='daily' or value.get('date')!=folder.parent.name or value.get('snapshot_id')!=folder.name):raise ValueError('Handoff packet locator mismatch')
    files=value.get('files')
    if not isinstance(files,dict) or not 1<=len(files)<=4096:raise ValueError('Handoff file inventory invalid')
    total=0;parts=0
    for name,row in files.items():
        if not isinstance(name,str) or not re.fullmatch('[A-Za-z0-9_.-]{1,200}',name) or name in ('.','..'):raise ValueError('Handoff member name invalid')
        digest(row.get('sha256'));total+=size(row.get('bytes'),FILE_LIMIT)
        storage=row.get('storage')
        if storage is not None:
            if value.get('schema')!=SCHEMA or not isinstance(storage,dict) or set(storage)!={'kind','parts'} or storage['kind']!='sha256-parts-v1':raise ValueError('Unknown handoff storage contract')
            refs=storage['parts']
            if not isinstance(refs,list):raise ValueError('Invalid handoff parts')
            parts+=len(refs)
            if parts>MAX_PARTS:raise ValueError('Handoff part limit')
            subtotal=0
            for ref in refs:
                if set(ref)!={'sha256','bytes'}:raise ValueError('Invalid part fields')
                digest(ref['sha256']);subtotal+=size(ref['bytes'],OBJECT_LIMIT)
            if subtotal!=row['bytes']:raise ValueError('Handoff recipe length mismatch')
    if total>PACKET_LIMIT:raise ValueError('Handoff expanded byte limit')
    return value

def entry_chunks(folder,row):
    folder=Path(folder);storage=row.get('storage')
    refs=storage['parts'] if storage else [{'path':folder/row['_name'],'sha256':row['sha256'],'bytes':row['bytes']}]
    whole=sha256();total=0
    for ref in refs:
        path=object_path(folder.parents[2],ref['sha256']) if storage else contained(ref['path'],folder)
        part=sha256();read=0
        with path.open('rb',buffering=0) as stream:
            while block:=stream.read(min(MIB,ref['bytes']-read+1)):
                read+=len(block)
                if read>ref['bytes']:raise ValueError('Handoff part grew')
                part.update(block);whole.update(block);total+=len(block);yield block
        if read!=ref['bytes'] or part.hexdigest()!=ref['sha256']:raise ValueError('Handoff part missing/corrupt')
    if total!=row['bytes'] or whole.hexdigest()!=row['sha256']:raise ValueError('Handoff reconstructed SHA mismatch')

def verify(folder,expected=None):
    manifest=load_manifest(folder,expected);started=time.perf_counter();total=0
    for name,row in manifest['files'].items():
        for block in entry_chunks(folder,{**row,'_name':name}):total+=len(block)
    return {'status':'verified','schema':manifest.get('schema','legacy-flat-v1'),'files':len(manifest['files']),'bytes':total,'seconds':time.perf_counter()-started}

def restore(folder,destination,expected):
    """New registered F staging only; never overwrite live state or activate it."""
    manifest=load_manifest(folder,expected);total=sum(row['bytes'] for row in manifest['files'].values())
    external=external_root(total*2+4*MIB);destination=contained(destination,external/'world-country-risks/restores')
    if destination.exists():raise ValueError('Restore destination already exists')
    # Verify every recipe before creating a restore tree. A second read verifies
    # each exact byte again during output, including mid-restore NAS changes.
    verification=verify(folder,expected);destination.mkdir(parents=True)
    for name,row in manifest['files'].items():
        external_root(2*row['bytes']+4*MIB);target=destination/name;pending=target.with_suffix(target.suffix+'.pending')
        try:
            with pending.open('xb',buffering=0) as stream:
                for block in entry_chunks(folder,{**row,'_name':name}):
                    view=memoryview(block)
                    while view:
                        count=stream.write(view)
                        if not count:raise OSError('Restore short write')
                        view=view[count:]
            observed=sha256();read=0
            with pending.open('rb',buffering=0) as stream:
                while block:=stream.read(MIB):observed.update(block);read+=len(block)
            if observed.hexdigest()!=row['sha256'] or read!=row['bytes']:raise ValueError('Restore readback mismatch')
            os.replace(pending,target)
        except BaseException:
            if pending.exists():pending.unlink()
            raise
    (destination/'restore-disabled.json').write_text(json.dumps({'source_manifest_sha256':expected,'jobs_enabled':False,'live_db_restored':False})+'\n',encoding='utf-8')
    return {**verification,'restored_to':str(destination),'jobs_enabled':False,'live_db_restored':False}

def latest_locator(path,expected=None):
    path=Path(path)
    if path.name!='daily-latest.json':raise ValueError('Explicit daily-latest.json required')
    with path.open('rb') as stream:raw=stream.read(65537)
    if len(raw)>65536:raise ValueError('Latest locator byte limit')
    value=json.loads(raw);relative=value.get('path','').replace('\\','/')
    match=re.fullmatch(r'daily/(\d{4}-\d{2}-\d{2})/([a-f0-9]{64})',relative)
    if not match or value.get('snapshot_id')!=match[2]:raise ValueError('Latest locator path mismatch')
    checksum=digest(expected or value.get('manifest_sha256'))
    if expected and value.get('manifest_sha256') not in (None,expected):raise ValueError('Latest manifest SHA mismatch')
    return contained(path.parent/relative,path.parent),checksum,raw

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();selector=p.add_mutually_exclusive_group(required=True);selector.add_argument('--manifest',type=Path);selector.add_argument('--latest',type=Path);p.add_argument('--sha256');p.add_argument('--output',type=Path);a=p.parse_args()
    if a.latest:folder,checksum,before=latest_locator(a.latest,a.sha256)
    else:
        if a.manifest.name!='manifest.json':raise ValueError('Explicit manifest.json required')
        checksum=digest(a.sha256);folder=a.manifest.parent
    result=restore(folder,a.output,checksum) if a.output else verify(folder,checksum)
    if a.latest and a.latest.read_bytes()!=before:raise ValueError('Latest locator changed during read')
    print(json.dumps(result))
