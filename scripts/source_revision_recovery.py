"""One explicitly reviewed gate repair, through the existing queue writer only."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,sys
CODE_ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(CODE_ROOT/'scripts'))
import source_revision_queue as queue
from execbrief_sync import canonical

def recover(root,policy,original_id,expected_state_sha,prior_gate_sha,evidence_path,evidence_sha,now=None):
    """Caller holds native run.lock and publication.lock; originals stay immutable."""
    now=now or datetime.now(timezone.utc);root=Path(root);old=queue.queue_root(root)/queue.identifier(original_id)
    request_raw,request=queue.control(old/'request.json');state_raw,state=queue.control(old/'state.json');old_sha=sha256(request_raw).hexdigest()
    queue.validate(request,policy,now);queue.digest(prior_gate_sha)
    if sha256(state_raw).hexdigest()!=expected_state_sha or state.get('request_sha256')!=old_sha:raise queue.InvalidRequest('recovery_original_identity_mismatch')
    reason=state.get('wait_reason')
    if state.get('status')!='blocked' or state.get('source_accepted') is not False or reason not in ('unreviewed_source_supplement_validator','invalid_original_reference','english_priority_original_binding_mismatch'):raise queue.InvalidRequest('recovery_reason_not_reviewed')
    attempts=state.get('attempts')
    if type(attempts) is not int or not 1<=attempts<queue.MAX_ATTEMPTS:raise queue.InvalidRequest('recovery_attempt_budget_exhausted')
    raw,evidence=queue.control(evidence_path)
    if sha256(raw).hexdigest()!=evidence_sha:raise queue.InvalidRequest('recovery_review_SHA_mismatch')
    graph={name:sha256((CODE_ROOT/'scripts'/name).read_bytes()).hexdigest() for name in ['source_supplement_gate.py','source_revision_cycle.py','sync_article_context.py']}
    reviewed_reason={'invalid_original_reference':'frozen_daily_decorated_original_reference','english_priority_original_binding_mismatch':'frozen_original_raw_identity_without_recent_transfer'}
    if reason in reviewed_reason and (prior_gate_sha!='90c2bde626c4aeba5ceba3ed865407979d0f381ecff78feda4da0b852d816f51'
        or graph['source_supplement_gate.py']==prior_gate_sha or evidence.get('repair_reason')!=reviewed_reason[reason]
        or evidence.get('prior_gate_sha256')!=prior_gate_sha):raise queue.InvalidRequest('recovery_reason_not_reviewed')
    if (evidence.get('kind')!='real-formal-source-and-bounded-F-context-validation-v1' or evidence.get('code_sha256')!=graph['source_supplement_gate.py']
        or evidence.get('code_graph')!=graph or evidence.get('request_sha256')!=old_sha or evidence.get('receipt_sha256')!=request['source_revision_receipt']['sha256']
        or evidence.get('persist') is not False or evidence.get('Google_projection_and_article_interpretations_unchanged') is not True):raise queue.InvalidRequest('recovery_review_binding_mismatch')
    new_id=queue.identifier(original_id+'-r'+graph['source_supplement_gate.py'][:12]);new_request={**request,'id':new_id};new_raw=canonical(new_request)+b'\n';new_sha=sha256(new_raw).hexdigest();destination=queue.queue_root(root)/new_id
    proof_dir=root/'.local/source-revision-recovery'/new_id;proof_path=proof_dir/'proof.json'
    proof={'kind':'wcr-reviewed-gate-repair-v1','recovery_operator_sha256':sha256(Path(__file__).read_bytes()).hexdigest(),'old_id':original_id,'old_request_sha256':old_sha,'old_state_sha256':expected_state_sha,'old_reject_reason':state['wait_reason'],
        'old_gate_sha256':prior_gate_sha,'new_code_graph':graph,'source_receipt_sha256':request['source_revision_receipt']['sha256'],'parent':request['parent'],
        'original_requested_at_utc':request['requested_at_utc'],'original_expires_at_utc':request['expires_at_utc'],'inherited_attempts':attempts,'max_attempts':queue.MAX_ATTEMPTS,
        'review_evidence':{'path':str(evidence_path),'sha256':evidence_sha},'new_id':new_id,'new_request_sha256':new_sha,'old_record_rewritten':False,'manual_consumer_started':False}
    seeded={'status':'pending','request_sha256':new_sha,'attempts':attempts,'source_accepted':False,'wait_reason':'reviewed_gate_epoch_recovery'}
    if proof_path.exists():
        stored=queue.control(proof_path)[1];operator=stored.get('recovery_operator_sha256')
        expected={k:v for k,v in proof.items() if k!='recovery_operator_sha256'}
        if ({k:v for k,v in stored.items() if k!='recovery_operator_sha256'}!=expected
            or operator not in {'1deaa21f252f193c826fe54a56beae0510c786a2e5e4e58a69981d1251615ac5',proof['recovery_operator_sha256']}):raise queue.InvalidRequest('recovery_epoch_already_bound_differently')
        proof=stored
        if (destination/'request.json').exists():
            if (destination/'request.json').read_bytes()!=new_raw:raise queue.InvalidRequest('recovery_request_conflict')
            _,existing=queue.control(destination/'state.json')
            if existing.get('request_sha256')!=new_sha:raise queue.InvalidRequest('recovery_state_request_mismatch')
            status=existing.get('status');terminal=False
            if (status not in ('pending','running','completed','blocked') or type(existing.get('attempts')) is not int
                or not attempts<=existing['attempts']<=queue.MAX_ATTEMPTS or status in ('pending','running') and existing.get('source_accepted') is not False):raise queue.InvalidRequest('recovery_progress_state_invalid')
            if status=='completed':
                from source_revision_adapter import completed_proof
                completed_proof(root,new_request,existing.get('completion_proof',{}));terminal=True
            elif status=='blocked':
                if existing.get('source_accepted') is not False or not isinstance(existing.get('wait_reason'),str) or not existing['wait_reason']:raise queue.InvalidRequest('recovery_terminal_state_invalid')
                terminal=True
            index=queue.control(queue.queue_root(root)/'pending.json')[1] if (queue.queue_root(root)/'pending.json').exists() else {'items':[]}
            if (not isinstance(index.get('items'),list) or len(index['items'])>queue.MAX_ITEMS
                or any(not isinstance(row,dict) or set(row)!={'id','request_sha256'} for row in index['items'])):raise queue.InvalidRequest('recovery_pending_index_invalid')
            matches=[row for row in index['items'] if row.get('id')==new_id]
            if len(matches)>1 or matches and matches[0].get('request_sha256')!=new_sha:raise queue.InvalidRequest('recovery_pending_index_conflict')
            if terminal or matches:
                return {'status':'already_registered_recovery','id':new_id,'request_sha256':new_sha,'proof':str(proof_path),'registered':False,'existing_state':status,'source_accepted':existing.get('source_accepted') is True}
            # request.write succeeded but pending.json did not: finish registration
            # only if the inherited seed has never progressed. Never reset it.
            if existing!=seeded:raise queue.InvalidRequest('recovery_state_progressed_without_index')
    queue.parent_binding(root,policy,request)
    current=queue.control(root/'public/data/v2/manifest.json')[1].get(request['date'],{})
    if current.get('snapshot_id')!=request['parent']['snapshot_id'] or current.get('sha256')!=request['parent']['snapshot_sha256']:raise queue.InvalidRequest('recovery_current_parent_changed')
    # Re-run only the formal read-only gate. Never run source/generate/publish here.
    from source_supplement_gate import freeze
    freeze(policy,request,root,persist=False)
    if sha256((old/'state.json').read_bytes()).hexdigest()!=expected_state_sha or (old/'request.json').read_bytes()!=request_raw:raise queue.InvalidRequest('recovery_original_changed')
    proof_dir.mkdir(parents=True,exist_ok=True)
    if not proof_path.exists():queue.atomic(proof_path,proof)
    # Seed inherited credit before a request/index can become visible to the tick.
    # A crash here leaves no request to execute, rather than resetting attempts0.
    destination.mkdir(parents=True,exist_ok=True);state_path=destination/'state.json'
    if state_path.exists():
        if queue.control(state_path)[1]!=seeded:raise queue.InvalidRequest('recovery_seed_state_changed')
    else:queue.atomic(state_path,seeded)
    result=queue.register(root,policy,new_request,now,coalesce_by_date=True)
    if sha256((old/'state.json').read_bytes()).hexdigest()!=expected_state_sha:raise queue.InvalidRequest('recovery_original_state_changed')
    queue.atomic(proof_dir/'registration.json',{'at_utc':now.isoformat(),'result':result,'proof_sha256':sha256(proof_path.read_bytes()).hexdigest()})
    return {**result,'status':'registered_reviewed_recovery' if result.get('registered') else 'coalesced_existing_work','proof':str(proof_path),'inherited_attempts':attempts,'original_expires_at_utc':request['expires_at_utc'],'source_accepted':False,'new_publication':False}

if __name__=='__main__':
    import argparse
    from cycle_lock import publication_lock
    parser=argparse.ArgumentParser();parser.add_argument('--id',required=True);parser.add_argument('--old-state-sha256',required=True);parser.add_argument('--prior-gate-sha256',required=True);parser.add_argument('--review',type=Path,required=True);parser.add_argument('--review-sha256',required=True);args=parser.parse_args()
    root=CODE_ROOT;policy=json.loads((root/'.local/controller.json').read_bytes())
    with publication_lock(Path(r'C:\Users\madok\Documents\ExecBrief-Periodic\state\countryrisks-daily\run.lock')) as a:
        if not a:print('deferred_live_native_owner');sys.exit(0)
        with publication_lock(root/'.local/publication.lock') as b:
            if not b:print('deferred_live_publication_owner');sys.exit(0)
            result=recover(root,policy,args.id,args.old_state_sha256,args.prior_gate_sha256,args.review,args.review_sha256)
            (root/'outputs/composite-sync-20261020/recovery-registration.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result))
