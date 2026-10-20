"""Reconstruct same-method days on the existing daily job; shared archive is read-only."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import argparse,json,subprocess,sys,time
from contextlib import contextmanager
from export_shared_gdelt import export,artifacts,ROOT
from archive_catalog import catalog
from run_metadata import RunMetadata
from aggregation_epoch import aggregation_method,calculation_signature
from bounded_source_io import SourceIO,StorageDeferred,DTO_LIMIT,CONTROL_LIMIT,digest_file

def utc():return datetime.now(timezone.utc).isoformat()

@contextmanager
def phase(metrics,name,progress=None):
    row={'started_at_utc':utc(),'status':'running'};metrics['phases'][name]=row;started=time.perf_counter()
    try:
        if progress:progress(name)
        yield row;row['status']='completed'
    except StorageDeferred as error:
        row.update(status='deferred_resource',error_type=type(error).__name__,wait_reason=str(error));raise
    except Exception as error:
        row.update(status='failed',error_type=type(error).__name__);raise
    finally:
        row.update(finished_at_utc=utc(),elapsed_seconds=time.perf_counter()-started)
        if progress:progress(name+' : '+row['status'])

def rebuild(policy,cutoff,output,upstream_bundle=None):
    cutoff=datetime.fromisoformat(cutoff.replace('Z','+00:00')).astimezone(timezone.utc)
    archive=Path(policy['archive_root'])
    series=Path(policy.get('series_root',ROOT/'.local'))
    source_io=SourceIO(ROOT,policy,series)
    folder=source_io.dto_folder;legacy_folder=source_io.output_path(Path(policy.get('source_io',{}).get('legacy_dto_root',series/'baseline-sources')))
    if legacy_folder.name!='baseline-sources':raise ValueError('Unexpected read-only DTO source directory')
    folder.mkdir(parents=True,exist_ok=True)
    verified={};report=[];metadata=RunMetadata();started=time.perf_counter()
    metrics={'started_at_utc':utc(),'status':'running','phases':{},'reuse_counts':{'baseline_dto_existing_cache':0,'prepared_artifacts_for_aggregation':0}}
    def progress(detail):
        try:
            source_io.atomic_json(Path(output).parent/'source-progress.json',{'at_utc':utc(),'active_detail':detail,'elapsed_seconds':time.perf_counter()-started,'phases':{k:{x:v for x,v in row.items() if x in ['status','started_at_utc','finished_at_utc','elapsed_seconds']} for k,row in metrics['phases'].items()},'metadata':metadata.summary(),'source_io':source_io.summary()},65536)
        except (OSError,StorageDeferred) as error:
            # Optional progress can be locked by cloud sync. Never hide the real
            # source failure or waive mandatory data/output storage guards.
            metrics['optional_progress_write_failures']=metrics.get('optional_progress_write_failures',0)+1
            metrics['optional_progress_last_error']=type(error).__name__
    def step(name):return phase(metrics,name,progress)
    method=aggregation_method(ROOT);calculation=calculation_signature(ROOT);stable=None;dto_index={};pending_cache=[]
    if source_io.external:
        from source_dto_cache import DTOCache,contract
        stable=DTOCache(source_io,contract(ROOT,policy,method,calculation,cutoff.hour,'execbrief-03-v1' if upstream_bundle else 'unbound-archive-v1'))
    try:
        with step('catalog'):
            rows,failures=catalog(archive,cutoff-timedelta(days=16),cutoff,metadata=metadata)
        for offset in range(14,-1,-1):
            end=cutoff-timedelta(days=offset);day=(end+timedelta(hours=9)).date().isoformat()
            with step('day_'+day):
                progress('day_'+day+' : verify_original_and_normalized_SHA')
                path=folder/(day+'.json');stamp=folder/(day+'.epoch.json');selection=rows
                if offset==0 and upstream_bundle:
                    from execbrief_sync import select_current_candidates
                    selection=select_current_candidates(upstream_bundle,archive,rows,metadata=metadata)
                strict=bool(offset==0 and upstream_bundle)
                candidates=artifacts(archive,end-timedelta(hours=48),end,candidates=selection,verified=verified,strict_candidates=strict,metadata=metadata,source_io=source_io,materialize=False)
                epoch=sha256((method+json.dumps([{k:v for k,v in r.items() if k!='read_path'} for r in candidates],sort_keys=True)).encode()).hexdigest()
                progress('day_'+day+' : lookup_DTO_epoch')
                stable_hit=stable.get(day,epoch) if stable else None
                cached=next((candidate for candidate in dict.fromkeys([path,legacy_folder/path.name])
                  if candidate.is_file() and candidate.with_suffix('.epoch.json').is_file()
                  and source_io.read_json(candidate.with_suffix('.epoch.json'),CONTROL_LIMIT).get('epoch')==epoch),None)
                if stable_hit:
                    path,result=stable_hit;reused=True;metrics['reuse_counts']['baseline_dto_existing_cache']+=1
                elif cached is not None:
                    progress('day_'+day+' : read_legacy_DTO_view')
                    result=source_io.read_json(cached);reused=True;metrics['reuse_counts']['baseline_dto_existing_cache']+=1
                    if stable:path=cached
                    elif cached!=path:
                        source_io.copy(cached,path);source_io.atomic_json(stamp,{'epoch':epoch,'method_sha256':method},CONTROL_LIMIT)
                else:
                    progress('day_'+day+' : aggregate_exact_population')
                    result=export(archive,end,path,policy.get('execbrief_root'),candidates=selection,verified=verified,quiet=True,strict_candidates=strict,artifact_rows=candidates,metadata=metadata,source_io=source_io);reused=False
                    metrics['reuse_counts']['prepared_artifacts_for_aggregation']+=1
                    source_io.atomic_json(stamp,{'epoch':epoch,'method_sha256':method},CONTROL_LIMIT)
                if stable and not reused:pending_cache.append((day,epoch,path))
                dto_sha,dto_size=digest_file(path,DTO_LIMIT);dto_index[day]={'path':str(path),'sha256':dto_sha,'bytes':dto_size}
                report.append({'date':day,'available_slots':result['coverage']['available_slots'],'status':result['source_status'],'reused':reused,'input_sha256':dto_sha})
                if offset==0:
                    metrics['coverage_progress']={'definition':'Verified normalized15-minute slots used by this aggregate; not raw-file presence','raw_original_presence_slots':None,'raw_presence_checked_by_this_consumer':False,'normalized_verified_aggregated_slots':result['coverage']['available_slots'],'expected_slots':result['coverage'].get('expected_slots',192),'WCR_publication_reflected_slots':None}
                    if upstream_bundle:
                        metrics['coverage_progress']['formally_selected_normalized_candidate_slots']=sum(bool(selection.get(r['slot'])) for r in candidates)
                        manifest=Path(upstream_bundle)/'manifest.json'
                        if manifest.exists():metrics['coverage_progress']['formally_accepted_supplement_sources']=source_io.read_json(manifest,CONTROL_LIMIT).get('binding',{}).get('source_revision',{}).get('supplement_sources')
                    source_io.copy(path,output)
        with step('metadata_end_recheck'):metadata.verify_all()
        if stable:
            with step('seal_new_DTO_epochs_after_metadata_verification'):
                for day,epoch,path in pending_cache:
                    target=stable.put(day,epoch,path);dto_index[day]['path']=str(target)
        edition=(cutoff+timedelta(hours=9)).date().isoformat()
        with step('bootstrap'):
            source_args=['--sources',str(folder)]
            if stable:
                index_path=series/'baseline-dto-index.json';source_io.atomic_json(index_path,{'schema':'wcr-baseline-dto-index-v1','edition':edition,'cutoff_hour_utc':cutoff.hour,'contract_sha256':stable.identity,'files':dto_index},CONTROL_LIMIT);source_args=['--source-index',str(index_path)]
            source_io.ledger(source_io.history_path)._capacity(1024*1024**2+CONTROL_LIMIT)
            subprocess.run([policy['node'],'--max-old-space-size=1024','scripts/bootstrap_baseline.mjs',*source_args,'--date',edition,'--history',str(source_io.history_path),'--cutoff-hour',str(cutoff.hour),'--report',str(source_io.report_path)],cwd=ROOT,check=True,timeout=120)
        if stable:metrics['stable_dto_cache']=stable.metrics
        metrics.update(status='verified',finished_at_utc=utc(),elapsed_seconds=time.perf_counter()-started,metadata=metadata.summary(),normalized_private_cache_entries=len(verified),source_io=source_io.summary())
        receipt={'edition':edition,'method_sha256':method,'calculation_signature_sha256':calculation,'days':report,'catalog_failures':failures,'shared_archive_written':False,'performance':metrics}
        source_io.atomic_json(folder/'rebuild-receipt.json',receipt,CONTROL_LIMIT);return receipt
    except StorageDeferred as error:
        metrics.update(status='deferred_resource',error_type=type(error).__name__,wait_reason=str(error),ai_required=False,retryable=True);raise
    except Exception as error:
        metrics.update(status='failed',error_type=type(error).__name__);raise
    finally:
        try:
            if metrics['status']=='running':metrics['status']='failed'
            if metrics['status']!='verified':metrics.update(finished_at_utc=utc(),elapsed_seconds=time.perf_counter()-started,metadata=metadata.summary(),source_io=source_io.summary())
            source_io.atomic_json(Path(output).parent/'source-metrics.json',metrics,CONTROL_LIMIT)
        finally:source_io.close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--cutoff',required=True);p.add_argument('--output',required=True);p.add_argument('--upstream-bundle');a=p.parse_args()
    print(json.dumps(rebuild(json.loads(Path(a.config).read_bytes()),a.cutoff,a.output,a.upstream_bundle)))
