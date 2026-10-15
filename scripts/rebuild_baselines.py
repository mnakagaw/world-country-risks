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

def utc():return datetime.now(timezone.utc).isoformat()

@contextmanager
def phase(metrics,name):
    row={'started_at_utc':utc(),'status':'running'};metrics['phases'][name]=row;started=time.perf_counter()
    try:
        yield row;row['status']='completed'
    except Exception as error:
        row.update(status='failed',error_type=type(error).__name__);raise
    finally:row.update(finished_at_utc=utc(),elapsed_seconds=time.perf_counter()-started)

def rebuild(policy,cutoff,output,upstream_bundle=None):
    cutoff=datetime.fromisoformat(cutoff.replace('Z','+00:00')).astimezone(timezone.utc)
    archive=Path(policy['archive_root'])
    series=Path(policy.get('series_root',ROOT/'.local'))
    folder=series/'baseline-sources';folder.mkdir(parents=True,exist_ok=True)
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
                    from execbrief_sync import selected_raw_sources
                    selected=selected_raw_sources(upstream_bundle,archive,metadata=metadata)
                    selection={slot:[r for r in options if selected.get(r['source_file_id'])==r['source_sha256']] for slot,options in rows.items()}
                    # Never enter the general fallback for an unselected raw SHA.
                    selection={slot:options for slot,options in selection.items() if options}
                strict=bool(offset==0 and upstream_bundle)
                candidates=artifacts(archive,end-timedelta(hours=48),end,candidates=selection,verified=verified,strict_candidates=strict,metadata=metadata)
                epoch=sha256((method+json.dumps([{k:v for k,v in r.items() if k!='read_path'} for r in candidates],sort_keys=True)).encode()).hexdigest()
                if path.exists() and stamp.exists() and json.loads(stamp.read_bytes()).get('epoch')==epoch:
                    result=json.loads(path.read_bytes());reused=True;metrics['reuse_counts']['baseline_dto_existing_cache']+=1
                else:
                    result=export(archive,end,path,policy.get('execbrief_root'),candidates=selection,verified=verified,quiet=True,strict_candidates=strict,artifact_rows=candidates,metadata=metadata);reused=False
                    metrics['reuse_counts']['prepared_artifacts_for_aggregation']+=1
                    stamp.write_text(json.dumps({'epoch':epoch,'method_sha256':method})+'\n')
                report.append({'date':day,'available_slots':result['coverage']['available_slots'],'status':result['source_status'],'reused':reused,'input_sha256':sha256(path.read_bytes()).hexdigest()})
                if offset==0:
                    target=Path(output);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(path.read_bytes())
        with phase(metrics,'metadata_end_recheck'):metadata.verify_all()
        edition=(cutoff+timedelta(hours=9)).date().isoformat()
        with phase(metrics,'bootstrap'):
            subprocess.run([policy['node'],'scripts/bootstrap_baseline.mjs','--sources',str(folder),'--date',edition,'--history',str(series/'v2-history.json'),'--cutoff-hour',str(cutoff.hour),'--report',str(series/'baseline-reconstruction.json')],cwd=ROOT,check=True,timeout=120)
        metrics.update(status='verified',finished_at_utc=utc(),elapsed_seconds=time.perf_counter()-started,metadata=metadata.summary(),normalized_private_cache_entries=len(verified))
        receipt={'edition':edition,'method_sha256':method,'calculation_signature_sha256':calculation_signature(ROOT),'days':report,'catalog_failures':failures,'shared_archive_written':False,'performance':metrics}
        (folder/'rebuild-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8');return receipt
    finally:
        if metrics['status']!='verified':metrics.update(status='failed',finished_at_utc=utc(),elapsed_seconds=time.perf_counter()-started,metadata=metadata.summary())
        target=Path(output).parent/'source-metrics.json';target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps(metrics,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--cutoff',required=True);p.add_argument('--output',required=True);p.add_argument('--upstream-bundle');a=p.parse_args()
    print(json.dumps(rebuild(json.loads(Path(a.config).read_bytes()),a.cutoff,a.output,a.upstream_bundle)))
