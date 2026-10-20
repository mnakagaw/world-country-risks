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
    try:value=json.loads(raw)
    except (ValueError,TypeError,UnicodeError) as error:raise Waiting('input_JSON_invalid') from error
    if not isinstance(value,dict):raise Waiting('input_JSON_object_required')
    return value
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

ROOT_RELEASE_REMAINING='Root full required checks, scoped commit/push, allowlist FTPS and HTTPS verification; publication not yet claimed'

def root_checks_complete(checks):
    if (not isinstance(checks,dict) or checks.get('schema_version')!='release-checks-v1' or checks.get('scope')!='daily-excluding-live-search'
        or not isinstance(checks.get('checks'),dict) or set(checks['checks'])!={'validate','python_tests','syntax'}
        or any(not isinstance(row,dict) or row.get('returncode')!=0 for row in checks['checks'].values())):
        raise Waiting('execbrief_root_release_checks_not_complete')

def accepted_projection(final,acceptance,checks,day,producer):
    """Producer acceptance contracts; publication/checks close only root work.

    The exact-source receipt is intentionally recorded before root release checks.
    Its content acceptance is immutable; later SHA-bound checks and publication
    complete the remaining root stages without rewriting that producer receipt.
    """
    if final.get('run_date')!=day:raise Waiting('execbrief_final_review_not_accepted')
    expected=acceptance['edition_sha256']
    projection=final.get('projection',{})
    if final.get('schema')=='execbrief-final-incremental-acceptance-v1' or final.get('schema_version')=='execbrief-final-incremental-acceptance-v1':
        root_checks_complete(checks)
        summary=final.get('summary_review',{});bounded=final.get('bounded_verification',{})
        if (final.get('accepted') is not True or type(summary.get('pending_apply')) is not int
            or summary['pending_apply']!=0 or summary.get('material_findings') or final.get('findings')
            or bounded.get('built_final_SHA_verified') is not True):
            raise Waiting('execbrief_final_review_not_accepted')
        hashes={}
        for kind,folder in [('editorial','daily-editorial'),('system_stress','world-stress')]:
            rows=[r for r in final.get('current_files',[]) if Path(r.get('path','')).resolve()==(producer/'content'/folder/(day+'.json')).resolve()]
            if len(rows)!=1 or not re.fullmatch(r'[a-f0-9]{64}',rows[0].get('sha256','')):raise Waiting('execbrief_projection_binding_mismatch')
            hashes[kind]=rows[0]['sha256']
        if (hashes['editorial']!=expected or projection.get('edition_sha256')!=expected
            or bounded.get('dist_dated_editorial',{}).get('sha256')!=expected):
            raise Waiting('execbrief_editorial_acceptance_binding_mismatch')
        return hashes
    # release_checks.editorial_acceptance binds the checker's projection, not
    # the former accepted_final_editorial_snapshot field.  Match that contract
    # while retaining both canonical-path and editorial/stress byte bindings.
    if (final.get('content_check_complete') is True
        and 'accepted_final_editorial_snapshot' not in final
        and final.get('status')!='accepted_exact_source_awaiting_root_release_checks'):
        summary=final.get('summary_review',{})
        if (type(summary.get('pending_apply')) is not int or summary['pending_apply']!=0
            or final.get('unapplied_findings') or summary.get('remaining_required_corrections')
            or summary.get('new_unresolved_material_findings',0)!=0):
            raise Waiting('execbrief_final_review_not_accepted')
        root_checks_complete(checks)
        stress=projection.get('world_stress',{})
        hashes={'editorial':projection.get('edition_sha256'),'system_stress':projection.get('stress_sha256') or stress.get('sha256')}
        paths={'editorial':projection.get('edition_path'),'system_stress':projection.get('stress_path') or stress.get('path')}
        if hashes['editorial']!=expected:raise Waiting('execbrief_editorial_acceptance_binding_mismatch')
        for kind,folder in [('editorial','daily-editorial'),('system_stress','world-stress')]:
            if (not re.fullmatch(r'[a-f0-9]{64}',hashes[kind] or '') or not paths[kind]
                or Path(paths[kind]).resolve()!=(producer/'content'/folder/(day+'.json')).resolve()):
                raise Waiting('execbrief_projection_binding_mismatch')
        return hashes
    if final.get('status')!='accepted_exact_source_awaiting_root_release_checks':
        if final.get('content_check_complete') is not True or final.get('unapplied_findings'):
            raise Waiting('execbrief_final_review_not_accepted')
        if final.get('accepted_final_editorial_snapshot',{}).get('sha256')!=expected:
            raise Waiting('execbrief_editorial_acceptance_binding_mismatch')
        return {'editorial':expected}
    root_checks_complete(checks)
    pending=final.get('summary_review',{}).get('pending_apply')
    if (type(pending) is not int or pending!=0 or final.get('unapplied_findings')
        or final.get('remaining')!=[ROOT_RELEASE_REMAINING]
        or ('content_check_complete' in final and final['content_check_complete'] is not True)):
        raise Waiting('execbrief_final_review_not_accepted')
    projection=final.get('projection',{})
    if projection.get('edition_sha256')!=expected:
        raise Waiting('execbrief_editorial_acceptance_binding_mismatch')
    hashes={'editorial':expected,'system_stress':projection.get('world_stress_sha256')}
    required={'edition_schema','stress_schema_and_recalculation','world_and_16_overviews_exact_adoption','JP_DO_accepted_items_and_priority_exact'}
    if (any(final.get('checks',{}).get(key)!='passed' for key in required)
        or final.get('checks',{}).get('country_author_world_independence_preserved') is not True):
        raise Waiting('execbrief_exact_source_review_not_complete')
    rows=final.get('exact_read_boundary',{}).get('rows',[])
    for kind,folder in [('editorial','daily-editorial'),('system_stress','world-stress')]:
        expected_path=(producer/'content'/folder/(day+'.json')).resolve()
        matches=[row for row in rows if Path(row.get('canonical_path','')).resolve()==expected_path]
        if (not re.fullmatch(r'[a-f0-9]{64}',hashes[kind] or '') or len(matches)!=1
            or matches[0].get('sha256')!=hashes[kind]):
            raise Waiting('execbrief_exact_read_boundary_mismatch')
    return hashes
def bound_reference(policy,ref,day,blobs,name):
    if not isinstance(ref,dict) or not isinstance(ref.get('path'),str) or not isinstance(ref.get('sha256'),str) or not re.fullmatch(r'[a-f0-9]{64}',ref['sha256']):
        raise Waiting('execbrief_invalid_bound_reference')
    raw=producer_bytes(policy,ref['path'],ref['sha256'],day)
    if len(raw)>4*1024**2:raise Waiting('execbrief_control_size_limit')
    value=checked_json(raw,ref['sha256']);blobs[name]=raw
    return value


def composite_projection(policy,checks,day,producer,blobs,prefix='',depth=0):
    """Known changed-only acceptance, with immutable semantic/source bindings."""
    root_checks_complete(checks)
    if depth>1 or checks.get('execution_kind') not in ('changed-only-composite-v1','same-date-focus-correction-changed-only-v1'):
        raise Waiting('execbrief_unknown_composite_acceptance')
    if any(checks.get(k) is not True for k in ['passed','inputs_unchanged','editorial_acceptance_unchanged']):raise Waiting('execbrief_acceptance_not_complete')
    composite=checks.get('composite_acceptance')
    if not isinstance(composite,dict) or composite.get('current_snapshot_sha256')!=checks.get('snapshot_sha256'):
        raise Waiting('execbrief_composite_snapshot_mismatch')
    final=bound_reference(policy,composite.get('semantic_acceptance'),day,blobs,prefix+'acceptance.json')
    contracts={'changed-only-composite-v1':('independent-overall-semantic-source-acceptance-v2','accepted_content_for_parent_remaining_release_gates'),
        'same-date-focus-correction-changed-only-v1':('independent-semantic-focus-correction-acceptance-v1','accepted_for_corrective_publication')}
    kind,status=contracts[checks['execution_kind']]
    if (final.get('kind')!=kind or final.get('status')!=status or final.get('run_date')!=day or final.get('content_check_complete') is not True
        or final.get('blocking_errors')!=[] or final.get('unresolved_semantic_findings')!=[]):raise Waiting('execbrief_composite_semantic_not_accepted')
    if final.get('authoritative_receipt')!=composite.get('authoritative_production'):raise Waiting('execbrief_authoritative_reference_mismatch')
    authoritative=bound_reference(policy,final['authoritative_receipt'],day,blobs,prefix+'authoritative-production.json')
    rows=final.get('authoritative_production_sources')
    if not isinstance(rows,list) or not 2<=len(rows)<=32 or rows!=authoritative.get('authoritative_production_sources'):
        raise Waiting('execbrief_authoritative_sources_mismatch')
    hashes={}
    for key,folder in [('editorial','daily-editorial'),('system_stress','world-stress')]:
        path=(producer/'content'/folder/(day+'.json')).resolve()
        matches=[r for r in rows if isinstance(r,dict) and isinstance(r.get('path'),str) and Path(r['path']).resolve()==path]
        if len(matches)!=1 or not isinstance(matches[0].get('sha256'),str) or not re.fullmatch(r'[a-f0-9]{64}',matches[0]['sha256']):raise Waiting('execbrief_composite_projection_mismatch')
        hashes[key]=matches[0]['sha256']
    if checks['execution_kind']=='same-date-focus-correction-changed-only-v1':
        if composite.get('baseline_successful_results_reused') is not True or composite.get('unchanged_source_raw_body_clock_country_assessments_and_stress_values') is not True:
            raise Waiting('execbrief_correction_preservation_unverified')
        baseline=bound_reference(policy,composite.get('baseline'),day,blobs,prefix+'baseline-checks.json')
        before,_=composite_projection(policy,baseline,day,producer,blobs,prefix+'baseline-',depth+1)
        for key,folder in [('editorial','daily-editorial'),('system_stress','world-stress')]:
            relative='content/'+folder+'/'+day+'.json';built='dist/data/'+folder+'/'+day+'.json'
            if (not isinstance(composite.get('before_SHA'),dict) or not isinstance(composite.get('after_SHA'),dict)
                or composite['before_SHA'].get(relative)!=before[key] or composite['after_SHA'].get(relative)!=hashes[key]
                or composite['after_SHA'].get(built)!=hashes[key]):raise Waiting('execbrief_correction_before_after_mismatch')
    return hashes,final


def select_publication(policy,work,day,pointer_raw,historical=False):
    """Finite same-day selection by actual pointer SHA, never by filename recency."""
    canonical_path=work/'publication-receipt.json';canonical_raw=producer_bytes(policy,canonical_path,None,day)
    canonical_receipt=checked_json(canonical_raw)
    if historical:return canonical_path,canonical_raw,canonical_receipt,canonical_raw
    paths=[canonical_path]
    for path in work.glob('publication-receipt-*.json'):
        paths.append(path)
        if len(paths)>16:raise Waiting('execbrief_publication_candidate_limit')
    matches=[]
    for path in paths:
        raw=canonical_raw if path==canonical_path else producer_bytes(policy,path,None,day)
        if len(raw)>4*1024**2:raise Waiting('execbrief_publication_control_size_limit')
        receipt=checked_json(raw)
        if receipt.get('verified') is not True or receipt.get('exit_code')!=0:continue
        ref={'path':receipt.get('manifest_path'),'sha256':receipt.get('manifest_sha256')}
        manifest=bound_reference(policy,ref,day,{},'manifest.json')
        if not isinstance(manifest.get('files'),dict):raise Waiting('execbrief_publication_files_invalid')
        if manifest['files'].get('data/latest-edition.json')==digest(pointer_raw):matches.append((path,raw,receipt))
    if len(matches)!=1:raise Waiting('execbrief_latest_publication_unavailable_or_ambiguous')
    return (*matches[0],canonical_raw)


def effective_publication(policy,receipt,manifest,canonical_raw,work,day,blobs):
    """Reconstruct the exact full manifest from verified initial plus correction."""
    initial=bound_reference(policy,receipt.get('initial_publication_receipt'),day,blobs,'initial-publication-receipt.json')
    if (Path(receipt['initial_publication_receipt']['path']).resolve()!=(work/'publication-receipt.json').resolve()
        or digest(canonical_raw)!=receipt['initial_publication_receipt']['sha256'] or initial.get('verified') is not True or initial.get('exit_code')!=0):
        raise Waiting('execbrief_correction_initial_publication_mismatch')
    first_ref={'path':initial.get('manifest_path'),'sha256':initial.get('manifest_sha256')}
    if manifest.get('initial_publication_manifest')!=first_ref or manifest.get('selected_correction_manifest')!=receipt.get('selected_manifest'):
        raise Waiting('execbrief_effective_manifest_reference_mismatch')
    first=bound_reference(policy,first_ref,day,blobs,'initial-publication-manifest.json')
    correction=bound_reference(policy,receipt.get('selected_manifest'),day,blobs,'correction-publication-manifest.json')
    for obj,release in [(first,initial.get('release')),(correction,receipt.get('release'))]:
        if obj.get('verified') is not True or obj.get('release')!=release or obj.get('destination')!='https://execbrief.net' or not isinstance(obj.get('files'),dict):
            raise Waiting('execbrief_correction_manifest_not_verified')
    union={**first['files'],**correction['files']}
    if (union!=manifest['files'] or len(union)!=receipt.get('effective_manifest_file_count')
        or len(correction['files'])!=receipt.get('file_count')):raise Waiting('execbrief_effective_manifest_union_mismatch')


def freeze_inputs(policy,day,cutoff,root,fetch=None,historical_latest_path=None,historical_artifact_paths=None):
    if fetch is None:
        # Producer's existing boundary transport: public pointer over HTTPS,
        # protected accepted editorial/stress bytes over certificate-checked FTPS.
        producer_root=str(Path(policy['execbrief_root']))
        if producer_root not in sys.path:sys.path.insert(0,producer_root)
        from engine.artifact_access import read_site_bytes
        fetch=lambda relative:read_site_bytes('https://execbrief.net'+relative)
    producer=Path(policy['execbrief_root']);work=producer/'.daily-work'/day
    current_pointer_raw=fetch('/data/latest-edition.json')
    receipt_path,receipt_raw,receipt,canonical_raw=select_publication(policy,work,day,current_pointer_raw,bool(historical_latest_path))
    if receipt.get('verified') is not True or receipt.get('exit_code')!=0:raise Waiting('execbrief_publication_not_verified')
    manifest_raw=producer_bytes(policy,receipt['manifest_path'],receipt['manifest_sha256'],day);manifest=checked_json(manifest_raw,receipt['manifest_sha256'])
    if manifest.get('verified') is not True or manifest.get('release')!=receipt.get('release') or manifest.get('destination')!='https://execbrief.net':raise Waiting('execbrief_publication_binding_mismatch')
    extra={};gate=receipt.get('local_gate')
    if isinstance(gate,dict):checks_ref={'path':gate.get('checks_receipt'),'sha256':gate.get('checks_receipt_sha256')}
    else:checks_ref=receipt.get('checks_receipt')
    checks=bound_reference(policy,checks_ref,day,extra,'checks-receipt.json');checks_raw=extra.pop('checks-receipt.json')
    if any(checks.get(k) is not True for k in ['passed','inputs_unchanged','editorial_acceptance_unchanged']):raise Waiting('execbrief_acceptance_not_complete')
    acceptance=checks.get('editorial_acceptance')
    if isinstance(acceptance,dict):
        if acceptance.get('run_date')!=day:raise Waiting('execbrief_acceptance_date_mismatch')
        final=bound_reference(policy,{'path':acceptance.get('final_receipt'),'sha256':acceptance.get('final_receipt_sha256')},day,extra,'acceptance.json')
        final_raw=extra.pop('acceptance.json');accepted_hashes=accepted_projection(final,acceptance,checks,day,producer)
    else:
        accepted_hashes,final=composite_projection(policy,checks,day,producer,extra);final_raw=extra.pop('acceptance.json')
    if not isinstance(gate,dict):
        if receipt.get('run_date')!=day or checks.get('execution_kind')!='same-date-focus-correction-changed-only-v1':raise Waiting('execbrief_unknown_correction_publication')
        effective_publication(policy,receipt,manifest,canonical_raw,work,day,extra)
        if checks['composite_acceptance']['after_SHA'].get('dist/data/latest-edition.json')!=digest(current_pointer_raw):raise Waiting('execbrief_correction_pointer_binding_mismatch')
    files=manifest['files']
    if historical_latest_path:
        # Recovery is a present-day reconstruction of a contemporaneously
        # accepted/published edition. It never claims WCR published then.
        verified_at=moment(receipt['verified_at_utc'])
        deadline=datetime.fromisoformat(day).replace(tzinfo=JST)+timedelta(days=1)
        if not cutoff<=verified_at<deadline:raise Waiting('historical_publication_not_contemporaneous')
        latest_raw=producer_bytes(policy,historical_latest_path,files['data/latest-edition.json'],day)
        local_latest=checked_json(latest_raw)
    else:
        latest_raw=current_pointer_raw
        local_latest=checked_json((producer/'dist/data/latest-edition.json').read_bytes())
    latest=checked_json(latest_raw)
    if latest!=local_latest or latest.get('date')!=day or moment(latest['information_cutoff_utc'])!=cutoff:raise Waiting('execbrief_latest_date_cutoff_or_local_mismatch')
    if digest(latest_raw)!=files.get('data/latest-edition.json'):raise Waiting('execbrief_latest_release_SHA_mismatch')
    blobs={'publication-receipt.json':receipt_raw,'publication-manifest.json':manifest_raw,'checks-receipt.json':checks_raw,'acceptance.json':final_raw,'latest-edition.json':latest_raw,**extra}
    live_historical_hashes={}
    for kind in ['editorial','system_stress']:
        ref=latest[kind];live_raw=fetch(ref['path'])
        original_path=(historical_artifact_paths or {}).get(kind) if historical_latest_path else None
        raw=producer_bytes(policy,original_path,ref['sha256'],day) if original_path else live_raw
        if original_path:live_historical_hashes[kind]=digest(live_raw)
        obj=checked_json(raw,ref['sha256'])
        if files.get(ref['path'].lstrip('/'))!=digest(raw) or obj.get('date')!=day:raise Waiting('execbrief_public_artifact_release_mismatch')
        local=producer_bytes(policy,original_path or producer/'dist'/ref['path'].lstrip('/'),ref['sha256'],day)
        if digest(local)!=digest(raw):raise Waiting('execbrief_public_local_artifact_SHA_mismatch')
        if kind=='editorial':
            if moment(obj['information_cutoff_utc'])!=cutoff or digest(raw)!=accepted_hashes['editorial']:raise Waiting('execbrief_editorial_acceptance_binding_mismatch')
        elif accepted_hashes.get(kind) and digest(raw)!=accepted_hashes[kind]:raise Waiting('execbrief_stress_acceptance_binding_mismatch')
        blobs[kind+'.json']=raw
    # Recheck both producer and public identity across the read, before sealing.
    if fetch('/data/latest-edition.json')!=current_pointer_raw or receipt_path.read_bytes()!=receipt_raw or (work/'publication-receipt.json').read_bytes()!=canonical_raw:raise Waiting('execbrief_epoch_changed_during_read')
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
    binding={'schema':'execbrief-countryrisks-sync-v1','date':day,'cutoff_utc':cutoff.isoformat().replace('+00:00','Z'),'execbrief_edition':latest['edition'],'execbrief_release':receipt['release'],'publication_receipt_sha256':digest(receipt_raw),'publication_manifest_sha256':digest(manifest_raw),'acceptance_receipt_sha256':digest(final_raw),'accepted_editorial_sha256':digest(blobs['editorial.json']),'selected_input_manifest_sha256':digest(gkg_raw),'previous_selected_input_manifest_sha256':digest(past) if past else None,'search_interest_snapshot_id':seal['snapshot_id'],'search_interest_seal_sha256':digest(seal_raw),'information_confirmed_at_utc':final.get('checked_at_utc') or final.get('recorded_at_utc') or final.get('completed_at_utc'),'execbrief_publication_verified_at_utc':receipt.get('verified_at_utc') or receipt.get('ended_at_utc'),'R_semantics_manifest_status':'not_supplied_by_accepted_edition; do not substitute generic desk/topic classifications'}
    if historical_latest_path:binding['historical_recovery']={'kind':'accepted_original_edition_recovery','reconstructed_after_publication':True,'original_upstream_publication_verified_at_utc':receipt['verified_at_utc'],'countryrisks_published_at_original_date':False,'later_live_artifact_sha256':live_historical_hashes}
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

def selected_raw_sources(bundle,archive,metadata=None):
    """Same accepted raw Event IDs/SHA; missing upstream slots stay missing."""
    selected={};archive=Path(archive).resolve()
    for name in ['previous-selected-input.json','selected-input.json']:
        p=Path(bundle)/name
        if not p.exists():continue
        obj=json.loads(p.read_bytes())
        for ref in obj.get('retained_events_mentions',{}).get('manifest_references',[]):
            source=Path(ref['path']).resolve()
            if not source.is_relative_to(archive/'manifests'):raise Waiting('selected_original_outside_archive')
            if metadata:bulk=metadata.document(source,ref['sha256']).value
            else:bulk=checked_json(source.read_bytes(),ref['sha256'])
            for r in bulk['files']:
                if re.fullmatch(r'\d{14}\.export',r['file_id']) and r.get('status') in ['downloaded','reused']:selected[r['file_id']]=r['sha256']
    supplemental=Path(bundle)/'source-revision-catalog.json'
    if supplemental.exists():
        meta=checked_json((Path(bundle)/'manifest.json').read_bytes())
        raw=supplemental.read_bytes();obj=checked_json(raw,meta['files']['source-revision-catalog.json'])
        revision=meta['binding'].get('source_revision',{})
        if obj.get('kind')!='execbrief-em-source-catalog-v1' or digest(raw)!=revision.get('catalog_sha256'):raise Waiting('invalid_frozen_supplement_catalog')
        start=moment(obj['window_start_utc']);end=moment(obj['information_cutoff_utc'])
        if end-start!=timedelta(hours=48) or end!=moment(meta['binding']['cutoff_utc']):raise Waiting('supplement_cutoff_mismatch')
        for row in obj['sources']:
            fid=row['file_id'];checksum=row['raw']['sha256']
            if not re.fullmatch(r'\d{14}\.export',fid) or not start<=datetime.strptime(fid[:14],'%Y%m%d%H%M%S').replace(tzinfo=timezone.utc)<end:raise Waiting('supplement_ID_outside_cutoff')
            if fid in selected and selected[fid]!=checksum:raise Waiting('supplement_raw_ID_SHA_conflict')
            selected[fid]=checksum
    return selected

def select_current_candidates(bundle,archive,rows,metadata=None):
    """Original raw strict union, with accepted supplemental normalized versions pinned."""
    selected=selected_raw_sources(bundle,archive,metadata=metadata);supplemental=Path(bundle)/'source-revision-catalog.json';constraints={}
    if supplemental.exists():
        catalog=checked_json(supplemental.read_bytes());constraints={r['file_id']:r for r in catalog['sources']}
    result={}
    for slot,options in rows.items():
        qualified=[]
        for row in options:
            fid=row['source_file_id']
            if selected.get(fid)!=row['source_sha256']:continue
            accepted=constraints.get(fid)
            if accepted:
                normalized=accepted['normalized_parquet']
                if (Path(row['path']).resolve()!=Path(normalized['path']).resolve() or row['sha256']!=normalized['sha256']
                    or row['bulk_manifest_sha256']!=accepted['bulk_manifest']['sha256'] or row['index_sha256']!=accepted['normalized_index']['sha256']):continue
            qualified.append(row)
        if qualified:result[slot]=qualified
    # English-priority normalization uses a producer-owned immutable subset
    # manifest outside the general NAS catalog. Add its exact accepted candidate
    # even when that catalog has no corresponding quarter. No alternate version.
    for fid,row in constraints.items():
        def document(ref):
            return metadata.document(ref['path'],ref['sha256']).value if metadata else checked_json(Path(ref['path']).read_bytes(),ref['sha256'])
        bulk=document(row['bulk_manifest']);index=document(row['normalized_index'])
        if index.get('bulk_manifest_sha256')!=row['bulk_manifest']['sha256']:raise Waiting('supplement_normalized_index_epoch_mismatch')
        clock=datetime.strptime(fid[:14],'%Y%m%d%H%M%S').replace(tzinfo=timezone.utc);slot=clock.isoformat();normalized=row['normalized_parquet']
        candidate={'slot':slot,'status':'candidate','path':normalized['path'],'sha256':normalized['sha256'],'bytes':normalized['bytes'],
            'bulk_manifest_path':row['bulk_manifest']['path'],'bulk_manifest_sha256':row['bulk_manifest']['sha256'],
            'index_path':row['normalized_index']['path'],'index_sha256':row['normalized_index']['sha256'],
            'rows_rejected':row['rows_rejected'],'source_file_id':fid,'source_sha256':row['raw']['sha256'],
            'source_generated_at':bulk.get('generated_at'),'source_window':bulk.get('window')}
        result[slot]=[candidate]
    return result
