"""One-shot producer push into the existing job's queue; never a watcher."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import argparse,json
from source_revision_queue import (register,validate,control,queue_root,identifier,digest,InvalidRequest)
from source_revision_adapter import artifact,json_artifact,source_receipt_bytes
from execbrief_sync import Waiting

ROOT=Path(__file__).resolve().parents[1]

def register_hint(root,policy,day,parent_publication_sha,receipt_path,receipt_sha,now=None,validity_hours=24):
    now=now or datetime.now(timezone.utc);root=Path(root)
    digest(parent_publication_sha);digest(receipt_sha)
    if type(validity_hours) is not int or not 1<=validity_hours<=168:raise InvalidRequest('invalid_request_validity')
    if not isinstance(day,str) or len(day)!=10:raise InvalidRequest('invalid_date')
    try:datetime.strptime(day,'%Y-%m-%d')
    except ValueError as error:raise InvalidRequest('invalid_date') from error
    if Path(receipt_path).name=='latest.json':raise InvalidRequest('immutable_receipt_required_not_latest_pointer')
    request_id=identifier(day.replace('-','')+'-source-'+receipt_sha)
    folder=queue_root(root)/request_id
    if (folder/'request.json').is_file():
        raw,request=control(folder/'request.json');validate(request,policy,now)
        incoming={**request,'source_revision_receipt':{'path':str(Path(receipt_path)),'sha256':receipt_sha}}
        validate(incoming,policy,now)
        if (request.get('date')!=day or request.get('id')!=request_id
            or request['source_revision_receipt']['sha256']!=receipt_sha
            or request['parent']['publication_receipt_sha256']!=parent_publication_sha):raise InvalidRequest('existing_hint_parent_mismatch')
        checksum=sha256(raw).hexdigest();_,state=control(folder/'state.json')
        if state.get('request_sha256')!=checksum:raise InvalidRequest('state_request_identity_mismatch')
        # Keep the original creation/expiry/parent/path. Never reset a completed,
        # blocked or pending request because the next capture repeats its SHA.
        return {'status':'already_known','registered':False,'id':request_id,'request_sha256':checksum,
            'existing_state':state.get('status'),'source_accepted':False,'new_publication':False}
    records=json_artifact(artifact(root/'public/data/v2/manifest.json'))
    record=records.get(day,{})
    snapshot_id=digest(record.get('snapshot_id'));checksum=digest(record.get('sha256'))
    if record.get('path')!=snapshot_id+'.json':raise InvalidRequest('invalid_parent_payload_path')
    raw=artifact(root/'public/data/v2'/record['path'],128*1024*1024)
    if sha256(raw).hexdigest()!=checksum:raise InvalidRequest('parent_snapshot_SHA_mismatch')
    snapshot=json_artifact(raw);binding=snapshot.get('upstream_sync',{})
    if snapshot.get('date')!=day or binding.get('publication_receipt_sha256')!=parent_publication_sha:raise InvalidRequest('expected_parent_publication_mismatch')
    request={'schema':'wcr-source-revision-request-v1','id':request_id,'date':day,
        'requested_at_utc':now.isoformat(),'expires_at_utc':(now+timedelta(hours=validity_hours)).isoformat(),
        'parent':{'snapshot_id':snapshot_id,'snapshot_sha256':checksum,'upstream_bundle_id':binding.get('bundle_id'),'publication_receipt_sha256':parent_publication_sha},
        'source_revision_receipt':{'path':str(Path(receipt_path)),'sha256':receipt_sha}}
    validate(request,policy,now)
    # Byte availability/identity only, never the producer's semantic acceptance.
    # A mutable latest pointer must be resolved by the existing producer first.
    source_receipt_bytes(policy,request)
    result=register(root,policy,request,now,coalesce_by_date=True)
    return {**result,'status':'registered' if result['registered'] else 'coalesced_pending','new_publication':False}

def main():
    p=argparse.ArgumentParser();p.add_argument('--date',required=True)
    p.add_argument('--expected-parent-publication-sha256',required=True)
    p.add_argument('--receipt-path',type=Path,required=True);p.add_argument('--receipt-sha256',required=True)
    p.add_argument('--validity-hours',type=int,default=24);a=p.parse_args()
    policy=json.loads((ROOT/'.local/controller.json').read_bytes())
    try:
        if policy.get('enabled') is not True:raise InvalidRequest('consumer_disabled')
        result=register_hint(ROOT,policy,a.date,a.expected_parent_publication_sha256,a.receipt_path,a.receipt_sha256,validity_hours=a.validity_hours)
    except (Waiting,OSError) as error:
        result={'status':'deferred_receipt_unavailable','registered':False,'source_accepted':False,'new_publication':False,'reason':str(error) if isinstance(error,Waiting) else type(error).__name__}
    except InvalidRequest as error:
        print(json.dumps({'status':'rejected','registered':False,'source_accepted':False,'new_publication':False,'reason':str(error)}));raise SystemExit(2)
    print(json.dumps(result))

if __name__=='__main__':main()
