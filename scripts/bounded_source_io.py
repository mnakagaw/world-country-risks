"""Bound one existing source subprocess's transport writes; never relax admission.

Source objects are immutable, infrequently read inputs. External-enabled runs put
their private read objects and completed DTOs on the registered external volume.
DuckDB spill remains bounded on the active local volume. A resource limit aborts
the source stage rather than being reported as missing source data.
"""
from contextlib import contextmanager
from hashlib import sha256
from pathlib import Path
from threading import Lock
import json,os,re,shutil,uuid
from storage_placement import external_root

MIB=1024**2
GIB=1024**3
CHUNK=MIB
JSON_CHUNK=64*1024
C_RESERVE=20*GIB
OBJECT_LIMIT=256*MIB
OBJECT_RUN_LIMIT=16*GIB
DTO_LIMIT=32*MIB
DTO_RUN_LIMIT=16*DTO_LIMIT
SPILL_LIMIT=512*MIB
CONTROL_LIMIT=4*MIB

class StorageDeferred(RuntimeError):
    """Retryable resource refusal, deliberately outside artifact-error catches."""

def checked_size(path,limit):
    size=Path(path).stat().st_size
    if size<0 or size>limit:raise StorageDeferred('source IO file byte limit exceeded')
    return size

def digest_file(path,limit,expected_size=None):
    digest=sha256();size=0
    with Path(path).open('rb',buffering=0) as stream:
        while block:=stream.read(min(CHUNK,limit-size+1)):
            size+=len(block)
            if size>limit:raise StorageDeferred('source IO file byte limit exceeded')
            digest.update(block)
    if expected_size is not None and size!=expected_size:raise ValueError('Source byte length changed')
    return digest.hexdigest(),size

class WriteLedger:
    """Reserve concurrent pending bytes and enforce each write before issuing it."""
    def __init__(self,root,total_limit,reserve,identity=None):
        self.root=Path(root);self.total_limit=total_limit;self.reserve=reserve;self.identity=identity
        self.lock=Lock();self.pending=0;self.written=0;self.buckets={}
    def _capacity(self,additional):
        try:
            if self.identity:
                observed=Path(self.identity(additional))
                if observed!=self.root:raise StorageDeferred('source IO external root changed')
            if shutil.disk_usage(self.root).free-additional<self.reserve:
                raise StorageDeferred('source IO capacity deferred')
        except OSError as error:raise StorageDeferred('source IO storage identity/capacity deferred') from error
    @contextmanager
    def reservation(self,limit,bucket=None,bucket_limit=None):
        with self.lock:
            if limit<0 or self.written+self.pending+limit>self.total_limit:
                raise StorageDeferred('source IO run write budget exceeded')
            if bucket is not None and self.buckets.get(bucket,0)+limit>bucket_limit:
                raise StorageDeferred('source IO category write budget exceeded')
            self._capacity(self.pending+limit)
            if bucket is not None:self.buckets[bucket]=self.buckets.get(bucket,0)+limit
            self.pending+=limit
        used=0
        def write(stream,block):
            nonlocal used
            with self.lock:
                if used+len(block)>limit:raise StorageDeferred('source IO output byte limit exceeded')
                self._capacity(self.pending)
                view=memoryview(block)
                while view:
                    count=stream.write(view)
                    if not count:raise StorageDeferred('source IO short write')
                    used+=count;self.pending-=count;self.written+=count;view=view[count:]
        try:yield write
        finally:
            with self.lock:
                self.pending-=limit-used
                if bucket is not None:self.buckets[bucket]-=limit-used

def json_byte_chunks(value):
    """Coalesce encoder fragments; guards run once per bounded byte chunk."""
    encoder=json.JSONEncoder(ensure_ascii=False);pending=bytearray()
    def text_parts():
        yield from encoder.iterencode(value)
        yield '\n'
    for text in text_parts():
        # At most16Ki Unicode characters become at most64KiB of UTF-8.
        # This also bounds encoding of a single oversized encoder fragment.
        for start in range(0,len(text),JSON_CHUNK//4):
            raw=memoryview(text[start:start+JSON_CHUNK//4].encode('utf-8'))
            while raw:
                count=min(JSON_CHUNK-len(pending),len(raw))
                pending.extend(raw[:count]);raw=raw[count:]
                if len(pending)==JSON_CHUNK:
                    yield bytes(pending);pending.clear()
    if pending:yield bytes(pending)

class SourceIO:
    def __init__(self,repo,policy=None,series=None,external_guard=None):
        self.repo=Path(repo).resolve();self.policy=policy or {};self.series=Path(series or self.repo/'.local').resolve()
        self.external=self.policy.get('external_storage') is True
        self.external_guard=external_guard or external_root
        self._lock=Lock();self._locks={};self._spill=None
        self.counts={'source_hash_only_bytes':0,'source_copy_bytes':0,'source_full_sha_reads':0,
          'private_readback_bytes':0,'private_objects_written':0,'private_objects_reused':0,
          'hash_only_verified_objects':0,'dto_bytes_written':0}
        self.local=WriteLedger(self.repo.anchor,C_RESERVE,C_RESERVE)
        if self.external:
            # The entire enforced source write ceiling is checked up front; each
            # actual write rechecks identity and all concurrent reservations too.
            root=Path(self.external_guard(OBJECT_RUN_LIMIT+2*DTO_RUN_LIMIT))
            self.project=root/'world-country-risks'
            self.objects=self.project/'immutable/source-objects'
            namespace=sha256(str(self.series).encode()).hexdigest()[:16]
            self.dto_folder=self.project/'immutable/source-dtos'/namespace/'baseline-sources'
            self.cold=WriteLedger(root,OBJECT_RUN_LIMIT+2*DTO_RUN_LIMIT,50*GIB,self.external_guard)
        else:
            self.project=None;self.objects=self.repo/'work/archive-objects';self.dto_folder=self.series/'baseline-sources'
            self.cold=self.local
        options=self.policy.get('source_io',{})
        self.history_path=self.output_path(options.get('history_path',self.series/'v2-history.json'))
        self.report_path=self.output_path(options.get('report_path',self.series/'baseline-reconstruction.json'))
    def output_path(self,path):
        path=Path(path).resolve()
        if path.is_relative_to(self.repo):return path
        if self.external and path.is_relative_to(self.project):return path
        raise ValueError('Source output outside scoped local/external project')
    def ledger(self,path):
        path=self.output_path(path)
        return self.cold if self.external and path.is_relative_to(self.project) else self.local
    def _path_lock(self,key):
        with self._lock:return self._locks.setdefault(key,Lock())
    def _count(self,**values):
        with self._lock:
            for key,value in values.items():self.counts[key]+=value
    def read_json(self,path,limit=DTO_LIMIT):
        path=Path(path);size=checked_size(path,limit)
        # A cloud placeholder can allocate its whole logical size when read.
        if path.resolve().anchor.casefold()==self.repo.anchor.casefold():
            with self.local.lock:self.local._capacity(self.local.pending+size)
        with path.open('rb') as stream:raw=stream.read(limit+1)
        if len(raw)>limit:raise StorageDeferred('source IO JSON byte limit exceeded')
        if len(raw)!=size:raise ValueError('Source JSON byte length changed')
        return json.loads(raw)
    def atomic_chunks(self,path,chunks,limit,expected=None):
        path=self.output_path(path);ledger=self.ledger(path)
        bucket,bucket_limit=('objects',OBJECT_RUN_LIMIT) if path.is_relative_to(self.objects) else ('dtos',DTO_RUN_LIMIT) if path.is_relative_to(self.dto_folder) else ('other',DTO_RUN_LIMIT)
        pending=path.with_name(path.name+'.'+uuid.uuid4().hex+'.pending')
        size=0;digest=sha256()
        try:
            with ledger.reservation(limit,bucket,bucket_limit) as write:
                path.parent.mkdir(parents=True,exist_ok=True)
                with pending.open('xb',buffering=0) as stream:
                    for block in chunks:
                        if not isinstance(block,bytes):raise TypeError('Byte chunks required')
                        write(stream,block);size+=len(block);digest.update(block)
                if expected is not None and digest.hexdigest()!=expected:raise ValueError('Transport copy SHA mismatch')
                # Full destination readback is required on exFAT too; a filename
                # or successful rename alone is never an object identity proof.
                observed,observed_size=digest_file(pending,limit,size)
                if observed!=digest.hexdigest():raise ValueError('Transport readback SHA mismatch')
                pending.replace(path)
            return digest.hexdigest(),observed_size
        except OSError as error:raise StorageDeferred('source IO transport write deferred') from error
        finally:
            if pending.exists():pending.unlink()
    def atomic_json(self,path,value,limit=DTO_LIMIT):
        result=self.atomic_chunks(path,json_byte_chunks(value),limit)
        if self.external and Path(path).resolve().is_relative_to(self.dto_folder):self._count(dto_bytes_written=result[1])
        return result
    def copy(self,source,target,limit=DTO_LIMIT):
        source=Path(source);size=checked_size(source,limit)
        expected,_=digest_file(source,limit,size)
        def chunks():
            with source.open('rb',buffering=0) as stream:
                while block:=stream.read(CHUNK):yield block
        result=self.atomic_chunks(target,chunks(),size,expected)
        if self.external and Path(target).resolve().is_relative_to(self.dto_folder):self._count(dto_bytes_written=result[1])
        return result
    def verify(self,path,expected,verified,materialize=True,expected_bytes=None):
        path=Path(path)
        if not re.fullmatch(r'[0-9a-f]{64}',expected):raise ValueError('Invalid normalized SHA')
        signature=(str(path),expected)
        with self._path_lock(signature):
            previous=verified.get(signature)
            if signature in verified and (previous is not None or not materialize):return previous
            size=checked_size(path,OBJECT_LIMIT)
            if expected_bytes is not None and (type(expected_bytes) is not int or expected_bytes!=size):raise ValueError('Normalized byte length mismatch')
            target=self.objects/(expected+'.parquet')
            if not materialize or target.exists():
                digest,read=digest_file(path,OBJECT_LIMIT,size)
                self._count(source_hash_only_bytes=read,source_full_sha_reads=1)
                if digest!=expected:raise ValueError('Normalized SHA mismatch')
                if not materialize:
                    verified[signature]=None;self._count(hash_only_verified_objects=1);return None
                digest,read=digest_file(target,OBJECT_LIMIT,size)
                self._count(private_readback_bytes=read)
                if digest!=expected:raise ValueError('Private read cache SHA mismatch')
                self._count(private_objects_reused=1)
            else:
                def chunks():
                    with path.open('rb',buffering=0) as stream:
                        while block:=stream.read(CHUNK):yield block
                digest,read=self.atomic_chunks(target,chunks(),size,expected)
                self._count(source_copy_bytes=read,source_full_sha_reads=1,private_readback_bytes=read,private_objects_written=1)
            verified[signature]=str(target);return str(target)
    def materialize_rows(self,rows,verified,archive):
        root=(Path(archive)/'normalized').resolve();result=[]
        for row in rows:
            if row['status']=='available':
                path=Path(row['path']).resolve()
                if not path.is_relative_to(root):raise ValueError('Unexpected normalized path')
                if not row.get('read_path'):row={**row,'read_path':self.verify(path,row['sha256'],verified,True,row.get('bytes'))}
            result.append(row)
        return result
    def duckdb_settings(self):
        # DuckDB's random-I/O spill remains local. The hard limit is enforced by
        # DuckDB itself, while this preflight preserves the C reserve if it fills.
        with self.local.lock:self.local._capacity(self.local.pending+SPILL_LIMIT+DTO_LIMIT+CONTROL_LIMIT)
        if self._spill is None:
            base=self.repo/'work/source-spill';base.mkdir(parents=True,exist_ok=True)
            self._spill=base/uuid.uuid4().hex;self._spill.mkdir()
        return {'temp_directory':str(self._spill),'max_temp_directory_size':f'{SPILL_LIMIT}B'}
    def summary(self):
        with self._lock:return {**self.counts,'objects_root':str(self.objects),'dto_root':str(self.dto_folder),
          'duckdb_spill_limit_bytes':SPILL_LIMIT,'object_limit_bytes':OBJECT_LIMIT,'object_run_write_limit_bytes':OBJECT_RUN_LIMIT,
          'dto_limit_bytes':DTO_LIMIT,'external_storage':self.external,'c_admission_guard_reduced':False}
    def close(self):
        if self._spill is None:return
        base=(self.repo/'work/source-spill').resolve();target=self._spill.resolve()
        if target.parent!=base or target.is_symlink() or target.is_junction():raise ValueError('Unsafe source spill cleanup')
        for item in target.iterdir():
            if item.is_symlink() or item.is_junction() or not item.is_file():raise ValueError('Unexpected source spill member')
            item.unlink()
        target.rmdir();self._spill=None
