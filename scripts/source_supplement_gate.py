"""Strict read-only gate for the existing producer's accepted English Events supplement."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import json,re
from execbrief_sync import canonical,checked_json,selected_raw_sources,Waiting
from source_revision_queue import digest,utc,parent_binding,InvalidRequest
from source_revision_adapter import artifact,json_artifact,source_receipt_bytes

APPROVED_VALIDATORS={'f21011d02064be61410193ef912b329e978220c953bc6811477b9ebd3c7a74b4'}

def require(value,reason):
    if not value:raise InvalidRequest(reason)

class Reader:
    def __init__(self,policy):
        self.producer=Path(policy['execbrief_root']).resolve();self.archive=Path(policy['archive_root']).resolve();self.entries={}
    def reference(self,ref,root,read=True):
        require(isinstance(ref,dict) and set(ref)=={'path','sha256','bytes'},'invalid_supplement_reference')
        digest(ref['sha256']);require(type(ref['bytes']) is int and 0<=ref['bytes']<=256*1024**2,'invalid_supplement_byte_length')
        p=Path(ref['path']);require(p.is_absolute() and p.resolve().is_relative_to(Path(root).resolve()),'supplement_path_outside_owner')
        if not read:return p
        key=(str(p),ref['sha256'])
        if key not in self.entries:
            self.admit_control(p,ref['bytes'])
            raw=artifact(p);require(len(raw)==ref['bytes'] and sha256(raw).hexdigest()==ref['sha256'],'supplement_reference_SHA_or_size_mismatch')
            self.entries[key]=raw
        return json_artifact(self.entries[key])
    def recheck(self):
        for (p,checksum),raw in self.entries.items():require(artifact(p)==raw,'supplement_changed_during_read')
    def bound(self,ref,root):
        require(isinstance(ref,dict) and set(ref)=={'path','sha256'},'invalid_original_reference')
        digest(ref['sha256']);p=Path(ref['path']);require(p.is_absolute() and p.resolve().is_relative_to(Path(root).resolve()),'original_reference_outside_owner')
        key=(str(p),ref['sha256'])
        if key not in self.entries:
            self.admit_control(p,p.stat().st_size)
            raw=artifact(p);require(sha256(raw).hexdigest()==ref['sha256'],'original_reference_SHA_mismatch');self.entries[key]=raw
        return json_artifact(self.entries[key])
    def admit_control(self,path,size):
        if Path(path).anchor==self.producer.anchor:
            total=sum(len(raw) for (p,_),raw in self.entries.items() if Path(p).anchor==self.producer.anchor)
            if total+size>24*1024**2:raise Waiting('supplement_C_control_hydration_limit')

def read_bulk(reader,reference):
    path=Path(reference['path']).resolve();priority=reader.producer/'.daily-work/rolling-search/em-english-priority'
    if not path.is_relative_to(priority):return reader.reference(reference,reader.archive/'manifests')
    bulk=reader.reference(reference,priority)
    require(path.name=='gdelt-bulk-manifest.json' and path.parent.parent==priority and path.parent.name==bulk.get('dataset_hash')
        and re.fullmatch(r'[a-f0-9]{64}',path.parent.name) and bulk.get('kind')=='gdelt_bulk_manifest' and bulk.get('schema_version')==1
        and bulk.get('source_series')==['english'] and bulk.get('coverage_status')=='partial'
        and bulk.get('source_scope')=='Retained English export subset only; original four-file quarter coverage and daily cutoff remain unchanged','invalid_english_priority_subset_manifest')
    rows=bulk.get('files');origins=bulk.get('source_manifest_references');receipts=bulk.get('source_raw_priority_receipts')
    require(isinstance(rows,list) and 0<len(rows)<=12 and isinstance(origins,list) and 0<len(origins)<=12 and isinstance(receipts,list) and 0<len(receipts)<=33,'invalid_english_priority_source_bounds')
    original={}
    for ref in origins:
        obj=reader.bound(ref,reader.archive/'manifests')
        for r in obj.get('files',[]):
            if r.get('status') in ('downloaded','reused'):original.setdefault(r.get('file_id'),[]).append(r)
    transferred=[]
    for ref in receipts:
        obj=reader.bound(ref,reader.producer/'.daily-work/rolling-search/em-raw-priority')
        require(obj.get('kind')=='em-raw-priority-stage-v1' and obj.get('no_new_queue_or_worker') is True,'invalid_english_priority_acquisition_receipt')
        transferred.extend(f for i in obj.get('intervals',[]) for f in i.get('files',[]))
    ids=set()
    for row in rows:
        fid=row.get('file_id','');require(re.fullmatch(r'\d{14}\.export',fid) and fid not in ids and row.get('status') in ('downloaded','reused'),'invalid_english_priority_source');ids.add(fid)
        require(any(r.get('sha256')==row.get('sha256') and Path(r.get('storage_path','')).resolve()==Path(row.get('storage_path','')).resolve() for r in original.get(fid,[]))
            and any(r.get('file_id')==fid and r.get('sha256')==row.get('sha256') and r.get('status') in ('downloaded','reused') for r in transferred),'english_priority_original_binding_mismatch')
    return bulk

def freeze(policy,request,root,history_only=False,persist=True):
    try:return _freeze(policy,request,root,history_only,persist)
    except InvalidRequest:raise
    except (KeyError,TypeError,ValueError) as error:raise InvalidRequest('malformed_source_supplement_contract:'+type(error).__name__) from error

def _freeze(policy,request,root,history_only=False,persist=True):
    """Return a new immutable bundle; never modify a producer or original bundle."""
    snapshot=parent_binding(root,policy,request);parent=request['parent'];binding=snapshot['upstream_sync']
    receipt_raw=source_receipt_bytes(policy,request);accepted=json_artifact(receipt_raw)
    if accepted.get('kind')!='execbrief-em-source-supplement-acceptance-v1':raise Waiting('accepted_source_supplement_required')
    require(accepted.get('accepted') is True and accepted.get('run_date')==request['date']
        and accepted.get('parent_publication_sha256')==parent['publication_receipt_sha256']
        and accepted.get('availability_status')=='partial'
        and accepted.get('consumer_must_strict_union_ID_SHA_and_retain_quality_gate') is True,'source_supplement_acceptance_mismatch')
    validator=accepted.get('validator_sha256');require(validator in APPROVED_VALIDATORS,'unreviewed_source_supplement_validator')
    cutoff=utc(binding['cutoff_utc']);at=utc(accepted.get('at_utc'))
    require(cutoff<at<=utc(request['requested_at_utc']),'source_supplement_acceptance_time_mismatch')
    reader=Reader(policy);catalog=reader.reference(accepted['catalog'],reader.producer/'.daily-work/source-supplements')
    checks=reader.reference(accepted['checks'],reader.producer/'.daily-work/source-supplements')
    require(checks.get('kind')=='execbrief-em-source-checks-v1' and checks.get('passed') is True
        and checks.get('catalog')==accepted['catalog'] and checks.get('parent_chain_verified') is True
        and checks.get('validator_sha256')==validator and checks.get('daily_edition_rebuilt_or_republished') is False
        and cutoff<utc(checks.get('at_utc'))<=at,'source_supplement_checks_mismatch')
    require(catalog.get('kind')=='execbrief-em-source-catalog-v1' and catalog.get('schema_version')==1
        and catalog.get('run_date')==request['date'] and catalog.get('parent_release')==accepted.get('parent_release')==binding['execbrief_release']
        and catalog.get('parent_edition_sha256')==binding['accepted_editorial_sha256']
        and utc(catalog.get('information_cutoff_utc'))==cutoff and utc(catalog.get('window_start_utc'))==cutoff-timedelta(hours=48)
        and catalog.get('availability_epoch')=='explicit-post-original-seal-supplement' and catalog.get('availability_status')=='partial','source_supplement_catalog_mismatch')
    series=Path(policy['series_root']);origin=binding.get('source_revision',{}).get('origin_upstream_bundle_id',parent['upstream_bundle_id']);digest(origin)
    original=series/'inputs'/origin;manifest=json_artifact(artifact(original/'manifest.json'));origin_binding=manifest['binding']
    require(origin_binding.get('bundle_id')==origin and origin_binding.get('source_revision') is None,'invalid_original_source_bundle')
    blobs={}
    for name,checksum in manifest['files'].items():
        require(Path(name).name==name,'invalid_original_bundle_member');raw=artifact(original/name)
        require(sha256(raw).hexdigest()==checksum,'original_source_bundle_SHA_mismatch');blobs[name]=raw
        if sum(map(len,blobs.values()))>16*1024**2:raise Waiting('original_bundle_hydration_limit')
    for key in ['publication_receipt_sha256','acceptance_receipt_sha256','accepted_editorial_sha256','selected_input_manifest_sha256','previous_selected_input_manifest_sha256','search_interest_seal_sha256','search_interest_snapshot_id','execbrief_release','date','cutoff_utc']:
        require(origin_binding.get(key)==binding.get(key),'source_revision_original_binding_changed')
    parents=catalog.get('parents',{});require(set(parents)=={'publication_receipt','release_checks','editorial_acceptance','selected_input','previous_selected_input','input_seal','previous_input_seal'},'invalid_supplement_parent_chain')
    for label,name in [('publication_receipt','publication-receipt.json'),('release_checks','checks-receipt.json'),('editorial_acceptance','acceptance.json'),('selected_input','selected-input.json'),('previous_selected_input','previous-selected-input.json')]:
        obj=reader.reference(parents[label],reader.producer)
        require(parents[label]['sha256']==sha256(blobs[name]).hexdigest(),'supplement_parent_SHA_mismatch')
    for prefix,day,name in [('',request['date'],'selected-input.json'),('previous_', (datetime.fromisoformat(request['date'])-timedelta(days=1)).date().isoformat(),'previous-selected-input.json')]:
        seal=reader.reference(parents[prefix+'input_seal'],reader.producer/'operations/daily-inputs'/day)
        selection=json_artifact(blobs[name]);require(seal.get('run_date')==selection.get('run_date')==day
            and seal.get('gkg_run_manifest_sha256')==sha256(blobs[name]).hexdigest()
            and utc(seal.get('information_cutoff_utc'))==utc(selection.get('cutoff_utc')),'supplement_original_input_seal_mismatch')
    baseline=selected_raw_sources(original,reader.archive)
    current=selected_raw_sources(series/'inputs'/parent['upstream_bundle_id'],reader.archive)
    sources=catalog.get('sources');require(isinstance(sources,list) and 0<len(sources)<=192,'invalid_supplement_source_count')
    seen=set();union=dict(baseline)
    for row in sources:
        fid=row.get('file_id','');require(re.fullmatch(r'\d{14}\.export',fid) and fid not in seen and row.get('kind')=='english-export','invalid_supplement_source_id');seen.add(fid)
        clock=datetime.strptime(fid[:14],'%Y%m%d%H%M%S').replace(tzinfo=timezone.utc)
        require(cutoff-timedelta(hours=48)<=clock<cutoff and clock.minute%15==0 and clock.second==0,'supplement_source_outside_original_window')
        reader.reference(row['raw'],reader.archive,read=False);reader.reference(row['normalized_parquet'],reader.archive/'normalized',read=False)
        bulk=read_bulk(reader,row['bulk_manifest']);index=reader.reference(row['normalized_index'],reader.archive/'indexes')
        require(index.get('bulk_manifest_sha256')==row['bulk_manifest']['sha256'] and index.get('dataset_version')==bulk.get('dataset_hash'),'supplement_normalized_index_epoch_mismatch')
        raw_rows=[r for r in bulk.get('files',[]) if r.get('file_id')==fid];norm_rows=[r for r in index.get('files',[]) if r.get('source_file_id')==fid]
        require(len(raw_rows)==len(norm_rows)==1,'supplement_ambiguous_source_identity');raw_row=raw_rows[0];norm=norm_rows[0]
        require(raw_row.get('status') in ('downloaded','reused') and raw_row.get('sha256')==row['raw']['sha256'] and Path(raw_row.get('storage_path','')).resolve()==Path(row['raw']['path']).resolve(),'supplement_raw_binding_mismatch')
        require(norm.get('status')=='available' and norm.get('parquet_sha256')==row['normalized_parquet']['sha256'] and Path(norm.get('parquet_path','')).resolve()==Path(row['normalized_parquet']['path']).resolve()
            and all(type(row.get(k)) is int and row[k]>=0 and row[k]==norm.get(k) for k in ['rows_loaded','rows_rejected']),'supplement_normalized_binding_mismatch')
        require(fid not in union or union[fid]==row['raw']['sha256'],'supplement_raw_ID_SHA_conflict');union[fid]=row['raw']['sha256']
        evidence=row.get('acquisition_evidence',{});kind=evidence.get('kind');require(evidence.get('exact_file_download_time_utc') is None,'unsupported_exact_acquisition_time_claim')
        if kind=='raw_already_in_frozen_parent':require(baseline.get(fid)==row['raw']['sha256'] and evidence.get('normalization_became_available_after_original_seal') is True,'invalid_parent_raw_acquisition')
        elif kind=='existing-collector-raw-priority':
            acquisition=reader.reference(evidence['receipt'],reader.producer)
            matches=[i for i in acquisition.get('intervals',[]) if i.get('role')==evidence.get('role') and i.get('acquisition_window_utc')==evidence.get('acquisition_window_utc') and any(f.get('file_id')==fid and f.get('sha256')==row['raw']['sha256'] and f.get('status')==evidence.get('file_transfer_status') for f in i.get('files',[]))]
            require(len(matches)==1,'supplement_acquisition_receipt_mismatch')
            window=evidence['acquisition_window_utc'];require(isinstance(window,list) and len(window)==2 and utc(window[0])<=utc(window[1])<=at,'supplement_acquisition_time_mismatch')
        elif kind=='immutable-bulk-acquisition':
            prior=reader.reference(evidence['manifest'],reader.archive/'manifests')
            require(utc(prior['generated_at'])==utc(evidence['acquisition_completed_by_utc'])<=at and any(r.get('file_id')==fid and r.get('sha256')==row['raw']['sha256'] and r.get('status')=='downloaded' for r in prior.get('files',[])),'supplement_acquisition_manifest_mismatch')
        else:raise InvalidRequest('unsupported_supplement_acquisition_evidence')
    require(all(union.get(fid)==checksum for fid,checksum in current.items()),'supplement_drops_previous_accepted_source')
    require(type(checks.get('added_sources_full_SHA_ZIP_CRC_and_normalized_SHA_verified')) is int and type(checks.get('prior_accepted_sources_reused')) is int
        and checks['added_sources_full_SHA_ZIP_CRC_and_normalized_SHA_verified']>0 and checks['prior_accepted_sources_reused']>=0
        and checks['added_sources_full_SHA_ZIP_CRC_and_normalized_SHA_verified']+checks['prior_accepted_sources_reused']==len(sources),'supplement_verification_count_mismatch')
    reader.recheck()
    revision={'schema':'wcr-late-source-revision-v1','parent_snapshot_id':parent['snapshot_id'],'origin_upstream_bundle_id':origin,
        'accepted_receipt_sha256':request['source_revision_receipt']['sha256'],'catalog_sha256':accepted['catalog']['sha256'],'accepted_at_utc':accepted['at_utc'],
        'known_after_original_cutoff':True,'availability_epoch':catalog['availability_epoch'],'history_only':history_only,'supplement_sources':len(sources),
        'label':'Post-cutoff source availability revision; original fixed cutoff and missingness retained'}
    new_binding={**origin_binding,'source_revision':revision};new_binding.pop('bundle_id',None);new_binding['bundle_id']=sha256(canonical(new_binding)).hexdigest()
    blobs.update({'source-revision-acceptance.json':receipt_raw,'source-revision-catalog.json':reader.entries[(str(Path(accepted['catalog']['path'])),accepted['catalog']['sha256'])],
        'source-revision-checks.json':reader.entries[(str(Path(accepted['checks']['path'])),accepted['checks']['sha256'])]})
    folder=series/'inputs'/new_binding['bundle_id']
    blobs['manifest.json']=canonical({'binding':new_binding,'files':{n:sha256(raw).hexdigest() for n,raw in blobs.items()}})
    if not persist:return folder,new_binding,blobs
    write_bundle(folder,blobs)
    return folder,new_binding

def write_bundle(folder,blobs,writer=None):
    folder.mkdir(parents=True,exist_ok=True)
    for name,raw in blobs.items():
        p=folder/name
        if len(raw)>4*1024**2:raise Waiting('source_revision_bundle_member_limit')
        if p.exists():require(p.read_bytes()==raw,'immutable_source_revision_bundle_conflict')
        elif writer:writer(p,raw,4*1024**2)
        else:
            with p.open('xb') as stream:stream.write(raw)
        require(p.read_bytes()==raw,'source_revision_bundle_readback_mismatch')
