"""Bounded continuation hints, never producer acceptance or a second scheduler."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import json,re
from cycle_lock import publication_lock
from execbrief_sync import canonical,closed_edition,moment

LIMIT=65536
MAX_ITEMS=32
MAX_ATTEMPTS=84
class InvalidRequest(ValueError):pass

def control(path):
    with Path(path).open('rb') as stream:raw=stream.read(LIMIT+1)
    if len(raw)>LIMIT:raise InvalidRequest('oversized_control')
    try:value=json.loads(raw)
    except (ValueError,UnicodeError) as error:raise InvalidRequest('invalid_control_JSON') from error
    if not isinstance(value,dict):raise InvalidRequest('control_must_be_object')
    return raw,value

def atomic(path,value):
    raw=canonical(value)+b'\n'
    if len(raw)>LIMIT:raise InvalidRequest('oversized_control')
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    pending=path.with_suffix('.pending');pending.write_bytes(raw);pending.replace(path)

def identifier(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,96}',value):raise InvalidRequest('invalid_id')
    return value

def digest(value):
    if not isinstance(value,str) or not re.fullmatch(r'[a-f0-9]{64}',value):raise InvalidRequest('invalid_SHA')
    return value

def queue_root(root):
    path=Path(root)/'.daily-work/source-revisions'
    if not path.resolve().is_relative_to(Path(root).resolve()/'.daily-work'):raise InvalidRequest('queue_outside_consumer')
    return path

def utc(value):
    try:
        if not isinstance(value,str) or not value.endswith(('Z','+00:00')):raise ValueError()
        return moment(value)
    except (ValueError,TypeError,OverflowError) as error:raise InvalidRequest('explicit_UTC_timestamp_required') from error

def validate(request,policy,now):
    fields={'schema','id','date','requested_at_utc','expires_at_utc','parent','source_revision_receipt'}
    if set(request)!=fields or request['schema']!='wcr-source-revision-request-v1':raise InvalidRequest('unsupported_request_contract')
    identifier(request['id'])
    day=request['date']
    if not isinstance(day,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day):raise InvalidRequest('invalid_date')
    try:datetime.fromisoformat(day)
    except ValueError as error:raise InvalidRequest('invalid_date') from error
    if not policy['sync_effective_date']<=day<=closed_edition(now)[0]:raise InvalidRequest('revision_date_outside_closed_series')
    created=utc(request['requested_at_utc']);expires=utc(request['expires_at_utc'])
    if created>now or not created<expires<=created+timedelta(days=7):raise InvalidRequest('invalid_request_validity')
    parent=request['parent']
    if not isinstance(parent,dict) or set(parent)!={'snapshot_id','snapshot_sha256','upstream_bundle_id','publication_receipt_sha256'}:raise InvalidRequest('invalid_parent_binding')
    for value in parent.values():digest(value)
    ref=request['source_revision_receipt']
    if not isinstance(ref,dict) or set(ref)!={'path','sha256'}:raise InvalidRequest('invalid_source_receipt_reference')
    digest(ref['sha256'])
    if not isinstance(ref['path'],str) or not ref['path']:raise InvalidRequest('invalid_source_receipt_reference')
    roots=[Path(policy['execbrief_root']).resolve()]
    if policy.get('execbrief_handoff_root'):roots.append(Path(policy['execbrief_handoff_root']).resolve())
    path=Path(ref['path'])
    if not path.is_absolute() or not any(path.resolve().is_relative_to(root) for root in roots):raise InvalidRequest('source_receipt_outside_producer')
    return request

def parent_binding(root,policy,request):
    """Pin existing immutable WCR and its original frozen producer receipt."""
    root=Path(root);parent=request['parent'];folder=root/'public/data/v2'
    raw=(folder/(parent['snapshot_id']+'.json')).read_bytes()
    if sha256(raw).hexdigest()!=parent['snapshot_sha256']:raise InvalidRequest('parent_snapshot_SHA_mismatch')
    snapshot=json.loads(raw)
    if snapshot.get('date')!=request['date'] or snapshot.get('snapshot_id')!=parent['snapshot_id']:raise InvalidRequest('parent_snapshot_identity_mismatch')
    binding=snapshot.get('upstream_sync',{})
    cutoff=(datetime.fromisoformat(request['date']).replace(tzinfo=timezone.utc)-timedelta(hours=6)).isoformat().replace('+00:00','Z')
    if snapshot.get('cutoff_series')!='execbrief-03-v1' or snapshot.get('cutoff_utc')!=cutoff or binding.get('cutoff_utc')!=cutoff:raise InvalidRequest('parent_cutoff_series_mismatch')
    if binding.get('bundle_id')!=parent['upstream_bundle_id'] or binding.get('publication_receipt_sha256')!=parent['publication_receipt_sha256']:raise InvalidRequest('parent_upstream_binding_mismatch')
    bundle=Path(policy['series_root'])/'inputs'/parent['upstream_bundle_id']
    _,manifest=control(bundle/'manifest.json')
    if manifest.get('binding')!=binding:raise InvalidRequest('parent_frozen_bundle_binding_mismatch')
    expected=manifest.get('files',{}).get('publication-receipt.json')
    if expected!=parent['publication_receipt_sha256'] or sha256((bundle/'publication-receipt.json').read_bytes()).hexdigest()!=expected:raise InvalidRequest('parent_publication_receipt_SHA_mismatch')
    records=json.loads((folder/'manifest.json').read_bytes());current=records.get(request['date'],{})
    if current.get('snapshot_id')!=parent['snapshot_id'] or current.get('sha256')!=parent['snapshot_sha256']:raise InvalidRequest('request_parent_already_superseded')
    return snapshot

def register(root,policy,request,now=None,coalesce_by_date=False):
    """Register only a SHA-pinned hint. This makes no claim of source acceptance."""
    now=now or datetime.now(timezone.utc);validate(request,policy,now)
    queue=queue_root(root);raw=canonical(request)+b'\n'
    if len(raw)>LIMIT:raise InvalidRequest('oversized_control')
    checksum=sha256(raw).hexdigest();folder=queue/request['id']
    with publication_lock(queue/'register.lock') as acquired:
        if not acquired:raise InvalidRequest('registration_busy')
        index=control(queue/'pending.json')[1] if (queue/'pending.json').exists() else {'items':[]}
        if set(index)!={'items'} or not isinstance(index.get('items'),list) or len(index['items'])>MAX_ITEMS:raise InvalidRequest('invalid_queue')
        seen=set();live=[]
        for row in index['items']:
            if not isinstance(row,dict) or set(row)!={'id','request_sha256'}:raise InvalidRequest('invalid_queue')
            identifier(row['id']);digest(row['request_sha256'])
            if row['id'] in seen:raise InvalidRequest('duplicate_queue_id')
            seen.add(row['id'])
            old=control(queue/row['id']/'state.json')[1]
            if old.get('request_sha256')!=row['request_sha256']:raise InvalidRequest('state_request_identity_mismatch')
            if old.get('status') not in ('completed','blocked'):live.append(row)
        matches=[r for r in index['items'] if r.get('id')==request['id']]
        if len(matches)>1 or matches and matches[0].get('request_sha256')!=checksum:raise InvalidRequest('immutable_request_conflict')
        path=folder/'request.json'
        if path.exists() and path.read_bytes()!=raw:raise InvalidRequest('immutable_request_conflict')
        state_path=folder/'state.json'
        if state_path.exists():
            state=control(state_path)[1]
            if state.get('request_sha256')!=checksum:raise InvalidRequest('state_request_identity_mismatch')
            if state.get('status') in ('completed','blocked'):
                return {'id':request['id'],'request_sha256':checksum,'registered':True,'source_accepted':False,'existing_terminal_hint':True}
        if coalesce_by_date and not matches:
            for row in live:
                previous_raw,previous=control(queue/row['id']/'request.json')
                if sha256(previous_raw).hexdigest()!=row['request_sha256']:raise InvalidRequest('request_SHA_mismatch')
                if previous.get('date')==request['date']:
                    return {'registered':False,'coalesced':True,'pending_id':row['id'],'pending_request_sha256':row['request_sha256'],
                        'latest_receipt_sha256':request['source_revision_receipt']['sha256'],'source_accepted':False}
        if not matches and len(live)>=MAX_ITEMS:raise InvalidRequest('queue_full')
        if moment(request['expires_at_utc'])<=now:raise InvalidRequest('request_expired')
        parent_binding(root,policy,request)
        folder.mkdir(parents=True,exist_ok=True)
        if not path.exists():path.write_bytes(raw)
        if not state_path.exists():atomic(state_path,{'status':'pending','request_sha256':checksum,'attempts':0,'source_accepted':False,'wait_reason':'producer_contract_and_acceptance_required'})
        if not any(r['id']==request['id'] for r in live):live.append({'id':request['id'],'request_sha256':checksum})
        atomic(queue/'pending.json',{'items':live})
    return {'id':request['id'],'request_sha256':checksum,'registered':True,'source_accepted':False}

def load(root,policy,request_id,checksum,now):
    identifier(request_id);digest(checksum);folder=queue_root(root)/request_id
    raw,request=control(folder/'request.json')
    if sha256(raw).hexdigest()!=checksum:raise InvalidRequest('request_SHA_mismatch')
    validate(request,policy,now)
    if request['id']!=request_id:raise InvalidRequest('request_identity_mismatch')
    _,state=control(folder/'state.json')
    if state.get('request_sha256')!=checksum:raise InvalidRequest('state_request_identity_mismatch')
    return folder,request,state
