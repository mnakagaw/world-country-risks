"""Read-only acceptance/publication gate and immutable downstream input bundle.

Never collect, classify, open the live producer DB, or change producer artifacts.
"""
from pathlib import Path
from datetime import datetime,timedelta,timezone
from hashlib import sha256
from urllib.request import Request,urlopen
import json,gzip,zipfile,re
import sys

JST=timezone(timedelta(hours=9))
class Waiting(Exception):
    pass
def digest(raw):return sha256(raw).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def moment(value):return datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(timezone.utc)
def closed_edition(now):
    end=now.astimezone(timezone.utc).replace(hour=18,minute=0,second=0,microsecond=0)
    if end>now:end-=timedelta(days=1)
    return (end+timedelta(hours=9)).date().isoformat(),end
def checked_json(raw,expected=None):
    if expected and digest(raw)!=expected:raise Waiting('input_SHA_mismatch')
    return json.loads(raw)
def producer_bytes(policy,path,expected,day):
    """Resolve a bound artifact after producer cleanup, without restoring files."""
    root=Path(policy['execbrief_root']).resolve();path=Path(path).resolve()
    if not (path.is_relative_to(root) or path.is_relative_to(root.parent/'deployment-records')):raise Waiting('producer_path_outside_root')
    if path.is_file():
        raw=path.read_bytes()
        if not expected or digest(raw)==expected:return raw
    if not expected:raise Waiting('producer_artifact_unavailable')
    nas=Path(policy['execbrief_handoff_root'])
    obj=nas/'completed-objects-v1/objects'/expected[:2]/(expected+'.gz')
    if obj.is_file():
        with gzip.open(obj,'rb') as f:raw=f.read()
        if digest(raw)==expected:return raw
    archive=nas/'updates'/(day.replace('-','')+'-daily')/'daily-evidence.zip'
    if archive.is_file():
        with zipfile.ZipFile(archive) as z:
            member='objects/'+expected
            if member in z.namelist():
                raw=z.read(member)
                if digest(raw)==expected:return raw
    raise Waiting('producer_bound_artifact_unavailable')
def public_bytes(relative):
    if not relative.startswith('/') or '..' in relative.split('/') or '?' in relative:raise Waiting('invalid_public_artifact_path')
    with urlopen(Request('https://execbrief.net'+relative,headers={'Cache-Control':'no-cache'}),timeout=25) as response:
        raw=response.read(12*1024*1024+1)
    if len(raw)>12*1024*1024:raise Waiting('public_artifact_too_large')
    return raw
def source_selection(policy,day):
    root=Path(policy['execbrief_root']);ed=root/'content/daily-editorial'/(day+'.json')
    if not ed.exists():return None
    edition=json.loads(ed.read_bytes());expected=edition.get('gkg_manifest_sha256')
    if not expected:return None
    try:raw=producer_bytes(policy,root/'.daily-work'/day/'gkg-run-manifest-v1.json',expected,day)
    except Waiting:return None
    record=checked_json(raw,expected)
    if record.get('run_date')!=day or moment(record['cutoff_utc']).hour!=18:return None
    return raw
def freeze_inputs(policy,day,cutoff,root,fetch=None):
    if fetch is None:
        # Producer's existing boundary transport: public pointer over HTTPS,
        # protected accepted editorial/stress bytes over certificate-checked FTPS.
        producer_root=str(Path(policy['execbrief_root']))
        if producer_root not in sys.path:sys.path.insert(0,producer_root)
        from engine.artifact_access import read_site_bytes
        fetch=lambda relative:read_site_bytes('https://execbrief.net'+relative)
    producer=Path(policy['execbrief_root']);work=producer/'.daily-work'/day
    receipt_raw=producer_bytes(policy,work/'publication-receipt.json',None,day);receipt=checked_json(receipt_raw)
    if receipt.get('verified') is not True or receipt.get('exit_code')!=0:raise Waiting('execbrief_publication_not_verified')
    manifest_raw=producer_bytes(policy,receipt['manifest_path'],receipt['manifest_sha256'],day);manifest=checked_json(manifest_raw,receipt['manifest_sha256'])
    if manifest.get('verified') is not True or manifest.get('release')!=receipt.get('release') or manifest.get('destination')!='https://execbrief.net':raise Waiting('execbrief_publication_binding_mismatch')
    gate=receipt['local_gate'];checks_raw=producer_bytes(policy,gate['checks_receipt'],gate['checks_receipt_sha256'],day);checks=checked_json(checks_raw,gate['checks_receipt_sha256'])
    if checks.get('passed') is not True or checks.get('inputs_unchanged') is not True or checks.get('editorial_acceptance_unchanged') is not True:raise Waiting('execbrief_acceptance_not_complete')
    acceptance=checks['editorial_acceptance']
    if acceptance.get('run_date')!=day:raise Waiting('execbrief_acceptance_date_mismatch')
    final_raw=producer_bytes(policy,acceptance['final_receipt'],acceptance['final_receipt_sha256'],day);final=checked_json(final_raw,acceptance['final_receipt_sha256'])
    if final.get('run_date')!=day or final.get('content_check_complete') is not True or final.get('unapplied_findings'):raise Waiting('execbrief_final_review_not_accepted')
    latest_raw=fetch('/data/latest-edition.json');latest=checked_json(latest_raw)
    local_latest=checked_json((producer/'dist/data/latest-edition.json').read_bytes())
    if latest!=local_latest or latest.get('date')!=day or moment(latest['information_cutoff_utc'])!=cutoff:raise Waiting('execbrief_latest_date_cutoff_or_local_mismatch')
    files=manifest['files']
    if digest(latest_raw)!=files.get('data/latest-edition.json'):raise Waiting('execbrief_latest_release_SHA_mismatch')
    blobs={'publication-receipt.json':receipt_raw,'publication-manifest.json':manifest_raw,'checks-receipt.json':checks_raw,'acceptance.json':final_raw,'latest-edition.json':latest_raw}
    for kind in ['editorial','system_stress']:
        ref=latest[kind];raw=fetch(ref['path']);obj=checked_json(raw,ref['sha256'])
        if files.get(ref['path'].lstrip('/'))!=digest(raw) or obj.get('date')!=day:raise Waiting('execbrief_public_artifact_release_mismatch')
        local=(producer/'dist'/ref['path'].lstrip('/')).read_bytes()
        if digest(local)!=digest(raw):raise Waiting('execbrief_public_local_artifact_SHA_mismatch')
        if kind=='editorial':
            if moment(obj['information_cutoff_utc'])!=cutoff or digest(raw)!=acceptance['edition_sha256'] or digest(raw)!=final['accepted_final_editorial_snapshot']['sha256']:raise Waiting('execbrief_editorial_acceptance_binding_mismatch')
        blobs[kind+'.json']=raw
    # Recheck both producer and public identity across the read, before sealing.
    if checked_json(fetch('/data/latest-edition.json'))!=latest or (work/'publication-receipt.json').read_bytes()!=receipt_raw:raise Waiting('execbrief_epoch_changed_during_read')
    editorial=checked_json(blobs['editorial.json']);gkg_raw=producer_bytes(policy,work/'gkg-run-manifest-v1.json',editorial['gkg_manifest_sha256'],day);gkg=checked_json(gkg_raw,editorial['gkg_manifest_sha256'])
    if gkg.get('run_date')!=day or moment(gkg['cutoff_utc'])!=cutoff or gkg.get('dataset_hash')!=editorial.get('gdelt_dataset_hash'):raise Waiting('execbrief_selected_input_cutoff_mismatch')
    blobs['selected-input.json']=gkg_raw
    previous=(cutoff-timedelta(days=1)+timedelta(hours=9)).date().isoformat();past=source_selection(policy,previous)
    if past:blobs['previous-selected-input.json']=past
    seal_path=Path(policy['interest_root'])/'sealed'/(cutoff.strftime('%Y%m%dT%H%M%SZ')+'.json')
    if not seal_path.is_file():raise Waiting('search_interest_0300_seal_unavailable')
    seal_raw=seal_path.read_bytes();seal=checked_json(seal_raw)
    if moment(seal['window']['end_utc'])!=cutoff or moment(seal['window']['start_utc'])!=cutoff-timedelta(days=1) or seal['window']['semantics']!='[start,end)':raise Waiting('search_interest_seal_cutoff_mismatch')
    blobs['search-interest-seal.json']=seal_raw
    binding={'schema':'execbrief-countryrisks-sync-v1','date':day,'cutoff_utc':cutoff.isoformat().replace('+00:00','Z'),'execbrief_edition':latest['edition'],'execbrief_release':receipt['release'],'publication_receipt_sha256':digest(receipt_raw),'publication_manifest_sha256':digest(manifest_raw),'acceptance_receipt_sha256':digest(final_raw),'accepted_editorial_sha256':digest(blobs['editorial.json']),'selected_input_manifest_sha256':digest(gkg_raw),'previous_selected_input_manifest_sha256':digest(past) if past else None,'search_interest_snapshot_id':seal['snapshot_id'],'search_interest_seal_sha256':digest(seal_raw),'information_confirmed_at_utc':final.get('checked_at_utc'),'execbrief_publication_verified_at_utc':receipt.get('verified_at_utc'),'R_semantics_manifest_status':'not_supplied_by_accepted_edition; do not substitute generic desk/topic classifications'}
    binding['bundle_id']=digest(canonical(binding));folder=Path(root)/binding['bundle_id'];folder.mkdir(parents=True,exist_ok=True)
    for name,raw in blobs.items():
        p=folder/name
        if p.exists() and p.read_bytes()!=raw:raise Waiting('immutable_upstream_bundle_conflict')
        if not p.exists():p.write_bytes(raw)
        if p.read_bytes()!=raw:raise Waiting('upstream_bundle_readback_mismatch')
    meta={'binding':binding,'files':{n:digest(r) for n,r in blobs.items()}};raw=canonical(meta);p=folder/'manifest.json'
    if p.exists() and p.read_bytes()!=raw:raise Waiting('immutable_upstream_bundle_manifest_conflict')
    if not p.exists():p.write_bytes(raw)
    return folder,binding

def selected_raw_sources(bundle,archive):
    """Same accepted raw Event IDs/SHA; missing upstream slots stay missing."""
    selected={};archive=Path(archive).resolve()
    for name in ['previous-selected-input.json','selected-input.json']:
        p=Path(bundle)/name
        if not p.exists():continue
        obj=json.loads(p.read_bytes())
        for ref in obj.get('retained_events_mentions',{}).get('manifest_references',[]):
            source=Path(ref['path']).resolve()
            if not source.is_relative_to(archive/'manifests'):raise Waiting('selected_original_outside_archive')
            raw=source.read_bytes();bulk=checked_json(raw,ref['sha256'])
            for r in bulk['files']:
                if re.fullmatch(r'\d{14}\.export',r['file_id']) and r.get('status') in ['downloaded','reused']:selected[r['file_id']]=r['sha256']
    return selected
