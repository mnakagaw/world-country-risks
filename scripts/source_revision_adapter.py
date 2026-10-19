"""Existing native continuation entry. No producer contract is accepted yet."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import argparse,importlib.util,json,os
from cycle_lock import publication_lock
from execbrief_sync import Waiting,moment,producer_bytes
from source_revision_queue import control,atomic,load,parent_binding,InvalidRequest,MAX_ATTEMPTS,utc

ROOT=Path(__file__).resolve().parents[1]

def artifact(path,limit=4*1024*1024):
    with Path(path).open('rb') as stream:raw=stream.read(limit+1)
    if len(raw)>limit:raise InvalidRequest('oversized_revision_artifact')
    return raw

def json_artifact(raw):
    try:value=json.loads(raw)
    except (ValueError,UnicodeError) as error:raise InvalidRequest('invalid_artifact_JSON') from error
    if not isinstance(value,dict):raise InvalidRequest('artifact_must_be_object')
    return value

def source_receipt_bytes(policy,request):
    ref=request['source_revision_receipt'];path=Path(ref['path'])
    try:raw=artifact(path)
    except FileNotFoundError:
        if not policy.get('execbrief_handoff_root') or not path.resolve().is_relative_to(Path(policy['execbrief_root']).resolve()):raise Waiting('bound_source_receipt_unavailable')
        raw=producer_bytes(policy,path,ref['sha256'],request['date'])
        if len(raw)>4*1024*1024:raise InvalidRequest('oversized_revision_artifact')
    if sha256(raw).hexdigest()!=ref['sha256']:raise InvalidRequest('source_receipt_SHA_mismatch')
    return raw

def native_owner(job_root,runtime,request_id,checksum,parent_pid=None):
    """A direct CLI invocation cannot become a second publisher."""
    _,active=control(Path(job_root)/'active.json');parent_pid=parent_pid or os.getppid()
    if (active.get('job')!='countryrisks-daily' or active.get('kind')!='native_continuation'
        or active.get('id')!=request_id or active.get('request_sha256')!=checksum
        or active.get('process_id')!=parent_pid):raise InvalidRequest('existing_native_owner_required')
    spec=importlib.util.spec_from_file_location('wcr_existing_native_owner',runtime)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    if module.process_identity(parent_pid)!=active.get('process_identity'):raise InvalidRequest('native_parent_identity_mismatch')

def consume_revision(policy,request):
    if json_artifact(source_receipt_bytes(policy,request)).get('kind')!='execbrief-em-source-supplement-acceptance-v1':raise Waiting('accepted_source_supplement_required')
    from source_revision_cycle import consume
    return consume(policy,request)

consume_revision.supports_history_only=True

def completion_time(started):
    # The request clock is captured before potentially long source/publication
    # work. Record actual completion; retain monotonicity for injected test clocks.
    return max(started,datetime.now(timezone.utc)).isoformat()

def completed_proof(root,request,proof,snapshot_path=None):
    """Only concrete immutable snapshot + publication + NAS bytes close a hint."""
    if not isinstance(proof,dict) or set(proof)!={'snapshot_id','snapshot_sha256','publication_receipt','publication_sha256','nas_manifest','nas_manifest_sha256'}:raise InvalidRequest('invalid_completion_proof')
    from source_revision_queue import digest
    identifier=proof['snapshot_id'];digest(identifier);digest(proof['snapshot_sha256'])
    if identifier==request['parent']['snapshot_id']:raise InvalidRequest('unchanged_snapshot_is_not_source_revision')
    path=Path(snapshot_path) if snapshot_path is not None else Path(root)/'public/data/v2'/(identifier+'.json');raw=artifact(path,128*1024*1024)
    if sha256(raw).hexdigest()!=proof['snapshot_sha256']:raise InvalidRequest('revision_snapshot_SHA_mismatch')
    value=json_artifact(raw);binding=value.get('upstream_sync',{}).get('source_revision',{})
    cutoff=datetime.fromisoformat(request['date']).replace(tzinfo=timezone.utc)-timedelta(hours=6)
    if (value.get('date')!=request['date'] or value.get('snapshot_id')!=identifier
        or value.get('cutoff_series')!='execbrief-03-v1' or utc(value.get('cutoff_utc'))!=cutoff
        or binding.get('parent_snapshot_id')!=request['parent']['snapshot_id']
        or binding.get('accepted_receipt_sha256')!=request['source_revision_receipt']['sha256']
        or binding.get('known_after_original_cutoff') is not True):raise InvalidRequest('revision_snapshot_provenance_mismatch')
    if not cutoff<utc(binding.get('accepted_at_utc'))<=utc(request['requested_at_utc']):raise InvalidRequest('late_source_acceptance_time_mismatch')
    for name,hash_name in [('publication_receipt','publication_sha256'),('nas_manifest','nas_manifest_sha256')]:
        digest(proof[hash_name]);raw=artifact(proof[name]);record=json_artifact(raw)
        if sha256(raw).hexdigest()!=proof[hash_name]:raise InvalidRequest('completion_receipt_SHA_mismatch')
        if name=='publication_receipt':
            entry=record.get('files',{}).get('data/v2/'+identifier+'.json',{})
            if (record.get('status')!='verified' or entry.get('sha256')!=proof['snapshot_sha256']
                or entry.get('http_verified') is not True or any(row.get('http_verified') is not True for row in record.get('files',{}).values())):raise InvalidRequest('revision_publication_unverified')
        elif record.get('snapshot_id')!=identifier or record.get('files',{}).get('snapshot.json',{}).get('sha256')!=proof['snapshot_sha256']:raise InvalidRequest('revision_NAS_unverified')
    return proof

def execute(root,policy,request_id,checksum,now=None,consumer=consume_revision):
    now=now or datetime.now(timezone.utc)
    folder,request,state=load(root,policy,request_id,checksum,now)
    result={'id':request_id,'request_sha256':checksum,'ai_required':False,'source_accepted':False,'handoff_complete':False,'publication_verified':False}
    with publication_lock(folder/'run.lock') as acquired:
        if not acquired:return {**result,'status':'deferred','wait_reason':'revision_owner_busy'}
        # Reread under this request's OS lock; never reset completed/blocked hints.
        _,request,state=load(root,policy,request_id,checksum,now)
        if state.get('status')=='completed':
            completed_proof(root,request,state['completion_proof'])
            return {**result,'status':'completed','source_accepted':True,'handoff_complete':True,'publication_verified':True,'reused':True}
        if state.get('status')=='blocked':return {**result,'status':'blocked','wait_reason':state.get('wait_reason')}
        if state.get('retry_after') and moment(state['retry_after'])>now:return {**result,'status':'deferred','wait_reason':'revision_backoff'}
        try:
            if consumer is consume_revision:
                from source_revision_cycle import recover
                recovered=recover(root,policy,request)
                if recovered:
                    state.update(status='completed',source_accepted=True,completion_proof=recovered,completed_at_utc=completion_time(now))
                    state.pop('retry_after',None);state.pop('wait_reason',None);atomic(folder/'state.json',state)
                    return {**result,'status':'completed','source_accepted':True,'handoff_complete':True,'publication_verified':True,'recovered_completion':True}
            if moment(request['expires_at_utc'])<=now:raise InvalidRequest('request_expired')
            if type(state.get('attempts')) is not int or not 0<=state['attempts']<MAX_ATTEMPTS:raise InvalidRequest('revision_attempt_limit')
            parent_binding(root,policy,request)
            # Hash identity only. Its semantic acceptance belongs to the future
            # strict producer gate, not this request transport.
            source_receipt_bytes(policy,request)
            protected={}
            latest=Path(root)/'public/data/v2/latest.json'
            if latest.is_file() and json_artifact(artifact(latest,128*1024*1024)).get('date','')>request['date']:
                if getattr(consumer,'supports_history_only',False) is not True:raise Waiting('historical_revision_pipeline_not_ready')
                for name in ['latest.json','status.json']:
                    path=latest.parent/name
                    if path.is_file():protected[path]=sha256(path.read_bytes()).hexdigest()
            state['attempts']+=1
            state.update(status='running',source_accepted=False,started_at_utc=now.isoformat());atomic(folder/'state.json',state)
            proof=consumer(policy,request)
            if any(sha256(path.read_bytes()).hexdigest()!=checksum for path,checksum in protected.items()):raise InvalidRequest('historical_revision_changed_newer_current_pointer')
            completed_proof(root,request,proof)
            state.update(status='completed',source_accepted=True,completion_proof=proof,completed_at_utc=completion_time(now))
            state.pop('retry_after',None);state.pop('wait_reason',None);atomic(folder/'state.json',state)
            return {**result,'status':'completed','source_accepted':True,'handoff_complete':True,'publication_verified':True}
        except InvalidRequest as error:
            state.update(status='blocked',source_accepted=False,wait_reason=str(error));atomic(folder/'state.json',state)
            return {**result,'status':'blocked','wait_reason':str(error)}
        except (Waiting,OSError) as error:
            reason=str(error) if isinstance(error,Waiting) else type(error).__name__
            state.update(status='pending',source_accepted=False,wait_reason=reason,retry_after=(now+timedelta(seconds=900)).isoformat());atomic(folder/'state.json',state)
            return {**result,'status':'pending','wait_reason':reason}

def main():
    p=argparse.ArgumentParser();p.add_argument('--request',required=True);p.add_argument('--request-sha256',required=True)
    p.add_argument('--result',type=Path,required=True);p.add_argument('--native-job-root',type=Path,required=True);p.add_argument('--native-runtime',type=Path,required=True);a=p.parse_args()
    policy=json.loads((ROOT/'.local/controller.json').read_bytes())
    installed=Path.home()/'Documents/ExecBrief-Periodic'
    expected_job=Path(policy.get('native_job_root',installed/'state/countryrisks-daily')).resolve()
    expected_runtime=Path(policy.get('native_runtime',installed/'runtime/periodic_worker.py')).resolve()
    if a.native_job_root.resolve()!=expected_job or a.native_runtime.resolve()!=expected_runtime:raise InvalidRequest('unregistered_native_owner_paths')
    relative=a.result.resolve().relative_to(a.native_job_root.resolve())
    if len(relative.parts)!=3 or relative.parts[0]!='runs' or not relative.parts[1].startswith('native-') or relative.parts[2]!='result.json':raise InvalidRequest('result_outside_native_run')
    native_owner(a.native_job_root,a.native_runtime,a.request,a.request_sha256)
    if policy.get('enabled') is not True:raise InvalidRequest('consumer_disabled')
    result=execute(ROOT,policy,a.request,a.request_sha256);atomic(a.result,result)
    print(json.dumps({'id':a.request,'status':result['status'],'source_accepted':result['source_accepted']}))

if __name__=='__main__':main()
