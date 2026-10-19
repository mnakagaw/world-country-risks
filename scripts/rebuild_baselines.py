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
def phase(metrics,name):
    row={'started_at_utc':utc(),'status':'running'};metrics['phases'][name]=row;started=time.perf_counter()
    try:
        yield row;row['status']='completed'
    except StorageDeferred as error:
        row.update(status='deferred_resource',error_type=type(error).__name__,wait_reason=str(error));raise
    except Exception as error:
        row.update(status='failed',error_type=type(error).__name__);raise
    finally:row.update(finished_at_utc=utc(),elapsed_seconds=time.perf_counter()-started)

def rebuild(policy,cutoff,output,upstream_bundle=None):
    cutoff=datetime.fromisoformat(cutoff.replace('Z','+00:00')).astimezone(timezone.utc)
    archive=Path(policy['archive_root'])
    series=Path(policy.get('series_root',ROOT/'.local'))
    source_io=SourceIO(ROOT,policy,series)
    folder=source_io.dto_folder;legacy_folder=series/'baseline-sources';folder.mkdir(parents=True,exist_ok=True)
    verified={};report=[];metadata=RunMetadata();started=time.perf_counter()
    metrics={'started_at_utc':utc(),'status':'running','phases':{},'reuse_counts':{'baseline_dto_existing_cache':0,'prepared_artifacts_for_aggregation':0}}
    method=aggregation_method(ROOT)
    try:
        with phase(metrics,'catalog'):
            rows,failures=catalog(archive,cutoff-timedelta(days=16),cutoff,metadata=metadata)
        for offset in range(14,-1,-1):
            end=cutoff-timedelta(days=offset);day=(end+timedelta(hours=9)).date().isoformat()
            with phase(metrics,'day_'+day):
                path=folder/(day+'.json');stamp=folder/(day+'.epoch.json');selection=rows
                if offset==0 and upstream_bundle:
                    from execbrief_sync import select_current_candidates
                    selection=select_current_candidates(upstream_bundle,archive,rows,metadata=metadata)
                strict=bool(offset==0 and upstream_bundle)
                candidates=artifacts(archive,end-timedelta(hours=48),end,candidates=selection,verified=verified,strict_candidates=strict,metadata=metadata,source_io=source_io,materialize=False)
                epoch=sha256((method+json.dumps([{k:v for k,v in r.items() if k!='read_path'} for r in candidates],sort_keys=True)).encode()).hexdigest()
                cached=next((candidate for candidate in dict.fromkeys([path,legacy_folder/path.name])
                  if candidate.is_file() and candidate.with_suffix('.epoch.json').is_file()
                  and source_io.read_json(candidate.with_suffix('.epoch.json'),CONTROL_LIMIT).get('epoch')==epoch),None)
                if cached is not None:
                    result=source_io.read_json(cached);reused=True;metrics['reuse_counts']['baseline_dto_existing_cache']+=1
                    if cached!=path:
                        source_io.copy(cached,path);source_io.atomic_json(stamp,{'epoch':epoch,'method_sha256':method},CONTROL_LIMIT)
                else:
                    result=export(archive,end,path,policy.get('execbrief_root'),candidates=selection,verified=verified,quiet=True,strict_candidates=strict,artifact_rows=candidates,metadata=metadata,source_io=source_io);reused=False
                    metrics['reuse_counts']['prepared_artifacts_for_aggregation']+=1
                    source_io.atomic_json(stamp,{'epoch':epoch,'method_sha256':method},CONTROL_LIMIT)
                report.append({'date':day,'available_slots':result['coverage']['available_slots'],'status':result['source_status'],'reused':reused,'input_sha256':digest_file(path,DTO_LIMIT)[0]})
                if offset==0:
                    source_io.copy(path,output)
        with phase(metrics,'metadata_end_recheck'):metadata.verify_all()
        edition=(cutoff+timedelta(hours=9)).date().isoformat()
        with phase(metrics,'bootstrap'):
            subprocess.run([policy['node'],'scripts/bootstrap_baseline.mjs','--sources',str(folder),'--date',edition,'--history',str(source_io.history_path),'--cutoff-hour',str(cutoff.hour),'--report',str(source_io.report_path)],cwd=ROOT,check=True,timeout=120)
        metrics.update(status='verified',finished_at_utc=utc(),elapsed_seconds=time.perf_counter()-started,metadata=metadata.summary(),normalized_private_cache_entries=len(verified),source_io=source_io.summary())
        receipt={'edition':edition,'method_sha256':method,'calculation_signature_sha256':calculation_signature(ROOT),'days':report,'catalog_failures':failures,'shared_archive_written':False,'performance':metrics}
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
