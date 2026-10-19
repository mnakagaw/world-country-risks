"""One source run's SHA-bound manifest/index epoch; never a persistent trust cache."""
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from threading import Lock
from concurrent.futures import ThreadPoolExecutor
import json,os

@dataclass(frozen=True)
class Document:
    raw:bytes
    sha256:str
    value:dict

class RunMetadata:
    def __init__(self,read=None):
        self.read=read or (lambda path:Path(path).read_bytes())
        self._guard=Lock();self._locks={};self._entries={};self._resolved={}
        self.counts={'files_read':0,'sha256_calculations':0,'json_parses':0,'cache_hits':0,'bytes_read':0,'end_recheck_reads':0,'end_recheck_sha256':0,'path_resolutions':0,'path_resolution_hits':0}
        self.verified=False
    def __enter__(self):return self
    def __exit__(self,kind,value,trace):
        if kind is None:self.verify_all()
    def resolve(self,path):
        """Pin a canonical path once per run; this never substitutes for SHA."""
        key=os.path.normcase(os.path.abspath(path))
        with self._guard:lock=self._locks.setdefault('resolve:'+key,Lock())
        with lock:
            with self._guard:
                if key in self._resolved:
                    self.counts['path_resolution_hits']+=1;return self._resolved[key]
            resolved=Path(path).resolve()
            with self._guard:
                self._resolved[key]=resolved;self.counts['path_resolutions']+=1
            return resolved
    def document(self,path,expected=None):
        key=os.path.normcase(os.path.abspath(path))
        with self._guard:lock=self._locks.setdefault(key,Lock())
        with lock:
            if key in self._entries:
                with self._guard:self.counts['cache_hits']+=1
                doc=self._entries[key][1]
            else:
                raw=self.read(Path(path));digest=sha256(raw).hexdigest()
                with self._guard:
                    self.counts['files_read']+=1;self.counts['sha256_calculations']+=1
                    self.counts['json_parses']+=1;self.counts['bytes_read']+=len(raw)
                value=json.loads(raw);doc=Document(raw,digest,value)
                with self._guard:self._entries[key]=(Path(path),doc)
            if expected is not None and doc.sha256!=expected:raise ValueError('Metadata expected SHA mismatch')
            return doc
    def verify_all(self):
        # Full NAS reads, not stat/mtime substitutes. A changed/missing producer
        # artifact blocks this entire source run before its bootstrap can commit.
        self.verified=False
        def check(entry):
            path,doc=entry
            raw=self.read(path);digest=sha256(raw).hexdigest()
            with self._guard:
                self.counts['end_recheck_reads']+=1;self.counts['end_recheck_sha256']+=1;self.counts['bytes_read']+=len(raw)
            return digest==doc.sha256 and raw==doc.raw
        with ThreadPoolExecutor(max_workers=4) as pool:
            for unchanged in pool.map(check,list(self._entries.values())):
                if not unchanged:raise ValueError('Metadata epoch changed during source run')
        self.verified=True
    def summary(self):
        with self._guard:return {**self.counts,'distinct_files':len(self._entries),'full_end_recheck_passed':self.verified,'scope':'one_source_run_only'}
