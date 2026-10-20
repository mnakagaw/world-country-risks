"""Exact input/code/cutoff DTO reuse, never incremental Event aggregation."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime
import json,re,sys
import duckdb,_duckdb
from bounded_source_io import DTO_LIMIT,CONTROL_LIMIT,digest_file

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()

def contract(root,policy,method,calculation,cutoff_hour,series_kind):
    root=Path(root)
    names=['export_shared_gdelt.py','aggregation_epoch.py','r_support.py','bounded_source_io.py','source_dto_cache.py','rebuild_baselines.py','bootstrap_baseline.mjs']
    value={'schema':'wcr-source-dto-contract-v1','archive':str(Path(policy['archive_root']).resolve()),'method_sha256':method,'calculation_signature_sha256':calculation,'cutoff_hour_utc':cutoff_hour,'series_kind':series_kind,
      'writer_code':{n:sha256((root/'scripts'/n).read_bytes()).hexdigest() for n in names},'r_definitions_sha256':sha256((root/'config/r_definitions.json').read_bytes()).hexdigest(),
      'runtime':{'python':sys.version,'duckdb_version':duckdb.__version__,'duckdb_binary_sha256':digest_file(Path(_duckdb.__file__),256*1024**2)[0],'node_binary_sha256':digest_file(Path(policy['node']),256*1024**2)[0]},
      'producer_canonicalization_code_sha256':sha256((Path(policy['execbrief_root'])/'engine/gdelt.py').read_bytes()).hexdigest()}
    return value

class DTOCache:
    def __init__(self,io,contract):
        if not io.external:raise ValueError('Stable DTO objects require registered external storage')
        self.io=io;self.contract=contract;self.identity=sha256(canonical(contract)).hexdigest()
        self.root=io.project/'immutable/dto-epochs'/self.identity[:16]
        self.metrics={'contract_sha256':self.identity,'hits':0,'objects_written':0,'objects_reused':0,'bytes_written':0,'bytes_reused':0}
    def index(self,day,epoch):
        datetime.strptime(day,'%Y-%m-%d')
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day):raise ValueError('Invalid DTO date')
        if not re.fullmatch('[a-f0-9]{64}',epoch):raise ValueError('Invalid DTO input epoch')
        key=sha256(canonical({'date':day,'input_epoch_sha256':epoch})).hexdigest()
        path=self.root/(key+'.json')
        if not path.resolve().is_relative_to(self.io.project.resolve()):raise ValueError('DTO epoch path escaped')
        for node in [path,*path.parents]:
            if node.is_symlink() or node.is_junction():raise ValueError('DTO epoch reparse path')
            if node==self.io.project:break
        return path
    def object(self,digest):
        if not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('Invalid DTO object SHA')
        path=self.io.project/'immutable/dto-objects'/digest[:2]/(digest+'.json')
        if not path.resolve().is_relative_to(self.io.project.resolve()):raise ValueError('DTO cache path escaped')
        for node in [path,*path.parents]:
            if node.is_symlink() or node.is_junction():raise ValueError('DTO cache reparse path')
            if node==self.io.project:break
        return path
    def get(self,day,epoch):
        index=self.index(day,epoch)
        if not index.exists():return None
        value=self.io.read_json(index,CONTROL_LIMIT)
        if (value.get('kind')!='wcr-source-dto-epoch-v1' or value.get('contract_sha256')!=self.identity or value.get('date')!=day or value.get('input_epoch_sha256')!=epoch):raise ValueError('DTO epoch reference mismatch')
        if type(value.get('bytes')) is not int or not 0<=value['bytes']<=DTO_LIMIT:raise ValueError('DTO byte reference invalid')
        path=self.object(value['sha256'])
        with path.open('rb') as stream:raw=stream.read(DTO_LIMIT+1)
        size=len(raw)
        if size>DTO_LIMIT or sha256(raw).hexdigest()!=value['sha256'] or size!=value['bytes']:raise ValueError('DTO object integrity mismatch')
        result=json.loads(raw)
        self.metrics['hits']+=1;self.metrics['bytes_reused']+=size
        return path,result
    def put(self,day,epoch,source):
        source=Path(source);digest,size=digest_file(source,DTO_LIMIT);target=self.object(digest)
        if target.exists():
            observed,observed_size=digest_file(target,DTO_LIMIT)
            if observed!=digest or observed_size!=size:raise ValueError('Immutable DTO object conflict')
            self.metrics['objects_reused']+=1
        else:
            self.io.copy(source,target,DTO_LIMIT);self.metrics['objects_written']+=1;self.metrics['bytes_written']+=size
        observed,observed_size=digest_file(target,DTO_LIMIT)
        if observed!=digest or observed_size!=size:raise ValueError('DTO object changed during cache promotion')
        value={'kind':'wcr-source-dto-epoch-v1','contract_sha256':self.identity,'date':day,'input_epoch_sha256':epoch,'sha256':digest,'bytes':size}
        index=self.index(day,epoch)
        if index.exists():
            if self.io.read_json(index,CONTROL_LIMIT)!=value:raise ValueError('Immutable DTO epoch conflict')
        else:self.io.atomic_json(index,value,CONTROL_LIMIT)
        return target
