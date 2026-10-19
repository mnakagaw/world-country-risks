"""Existing daily owner consumes one verified ExecBrief edition; no scheduler."""
from datetime import datetime,timedelta,timezone
from pathlib import Path
from hashlib import sha256
import argparse,json,subprocess,sys,time
from execbrief_sync import closed_edition,freeze_inputs,canonical,Waiting,JST
from cycle_lock import publication_lock
from local_cycle import dispose_read_cache
from storage_placement import daily_paths

ROOT=Path(__file__).resolve().parents[1]
def write(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);pending=path.with_suffix('.pending');pending.write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8');pending.replace(path)
def method_epoch():
    names=['scripts/synced_cycle.py','scripts/execbrief_sync.py','scripts/storage_placement.py','scripts/sync_article_context.py','scripts/rebuild_baselines.py','scripts/bootstrap_baseline.mjs','scripts/export_shared_gdelt.py','scripts/archive_catalog.py','scripts/run_metadata.py','scripts/aggregation_epoch.py','scripts/r_support.py','scripts/generate_v2.mjs','scripts/engine_v2.mjs','scripts/monitoring_v2.mjs','scripts/rindex_v2.mjs','scripts/r_bundles.mjs','config/scoring.json','config/r_definitions.json']
    return sha256('|'.join(sha256((ROOT/n).read_bytes()).hexdigest() for n in names).encode()).hexdigest()
def run(command,log,timeout):
    r=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=timeout)
    log.write_text(r.stdout+'\n'+r.stderr,encoding='utf-8')
    if r.returncode:raise RuntimeError('stage_command_failed')
def build_proof(base=None):
    import re
    base=Path(base or ROOT/'dist');html=(base/'index.html').read_text(encoding='utf-8')
    names=['index.html','data/v2/latest.json','data/v2/manifest.json']+re.findall(r'(?:src|href)=["\']\./(assets/[^"\']+)["\']',html)
    return {n:sha256((base/n).read_bytes()).hexdigest() for n in names}

def utc():return datetime.now(timezone.utc).isoformat()

def begin_stage(report,name):
    row={'started_at_utc':utc(),'status':'running'}
    report.setdefault('stage_attempts',{}).setdefault(name,[]).append(row)
    return row,time.perf_counter()

def end_stage(attempt,status,error=None):
    row,started=attempt;row.update(status=status,finished_at_utc=utc(),elapsed_seconds=time.perf_counter()-started)
    if error:row['error_type']=type(error).__name__
    return row

def note_reuse(report,name,started,clock):
    counts=report.setdefault('reuse_counts',{});counts[name]=counts.get(name,0)+1
    if name in report.get('stages',{}):report['stages'][name]['reuse_count']=counts[name]
    report.setdefault('reuse_events',[]).append({'stage':name,'validation_started_at_utc':started,'validation_finished_at_utc':utc(),'validation_seconds':time.perf_counter()-clock})

def source_performance(state,started):
    try:
        value=json.loads((state/'source-metrics.json').read_bytes())
        if datetime.fromisoformat(value['started_at_utc'])>=datetime.fromisoformat(started):return value
    except (OSError,ValueError,KeyError,TypeError):pass
    return None
def cycle(config,now=None,gate=freeze_inputs,runner=run,recovery=None):
    policy=json.loads(Path(config).read_bytes())
    if policy.get('enabled') is not True:return {'status':'disabled'}
    now=(now or datetime.now(timezone.utc)).astimezone(timezone.utc);day,cutoff=closed_edition(now)
    if recovery:
        recovered_day=recovery['date']
        if not policy['sync_effective_date']<=recovered_day<day:raise ValueError('Recovery must be a prior closed synchronized edition')
        day=recovered_day;cutoff=datetime.fromisoformat(day).replace(tzinfo=JST).astimezone(timezone.utc)+timedelta(hours=3)
    if day<policy['sync_effective_date']:return {'status':'awaiting_sync_effective_date','date':day,'effective_date':policy['sync_effective_date'],'previous_publication_retained':True}
    series=Path(policy['series_root']);request=series/('recovery-requests' if recovery else 'requests')/day/'receipt.json'
    deadline=datetime.fromisoformat(day).replace(hour=23,minute=55,tzinfo=JST).astimezone(timezone.utc)
    if now>deadline and not recovery:
        expired={'status':'expired_execbrief_daily','date':day,'previous_publication_retained':True};write(request,expired);return expired
    with publication_lock(ROOT/'.local/publication.lock') as acquired:
        if not acquired:return {'status':'busy','pending_retained':True}
        active_timing=None
        try:
            check={'status':'waiting_execbrief_daily','date':day,'cutoff_utc':cutoff.isoformat(),'previous_publication_retained':True}
            previous=json.loads(request.read_bytes()) if request.exists() else {};attempt=previous.get('checks',0)+1
            if attempt>policy.get('max_daily_checks',84):
                expired={'status':'expired_execbrief_daily','date':day,'checks':attempt,'previous_publication_retained':True};write(request,expired);return expired
            check={'status':'waiting_execbrief_daily','date':day,'cutoff_utc':cutoff.isoformat(),'checks':attempt,'deadline_utc':deadline.isoformat(),'previous_publication_retained':True}
            try:
                if recovery:bundle,binding=gate(policy,day,cutoff,series/'inputs',historical_latest_path=recovery['latest_edition_path'],historical_artifact_paths=recovery.get('artifact_paths'))
                else:bundle,binding=gate(policy,day,cutoff,series/'inputs')
            except (Waiting,OSError,KeyError,ValueError) as e:
                check['reason']=str(e) if isinstance(e,Waiting) else type(e).__name__;write(request,check);return check
            identity={'upstream_bundle_id':binding['bundle_id'],'calculation_epoch':method_epoch(),'cutoff_series':'execbrief-03-v1'};key=sha256(canonical(identity)).hexdigest();state=series/'cycles'/day/key;state.mkdir(parents=True,exist_ok=True);receipt=state/'receipt.json'
            report=json.loads(receipt.read_bytes()) if receipt.exists() else {'status':'running','date':day,'cutoff_utc':binding['cutoff_utc'],'owner':'countryrisks-daily','identity':identity,'upstream_binding':binding,'stages':{}}
            for stage in ['source','generate','build','publish','handoff','complete_cycle']:report.setdefault('reuse_counts',{}).setdefault(stage,0)
            if report.get('status')=='verified':
                reuse_started=utc();reuse_clock=time.perf_counter()
                proofs=[(state/'source.json',report['stages']['source']['source_sha256']),(state/'article-classification-context.json',report['stages']['source']['annotation_sha256']),(Path(report['stages']['publish']['publication_receipt']),report['stages']['publish']['publication_sha256'])]
                if any(not p.is_file() or sha256(p.read_bytes()).hexdigest()!=expected for p,expected in proofs):
                    waiting={**check,'status':'retry_sync_stage','reason':'completed_input_or_publication_receipt_SHA_mismatch','previous_publication_retained':True};write(request,waiting);return waiting
                note_reuse(report,'complete_cycle',reuse_started,reuse_clock);write(receipt,report)
                write(request,{**check,'status':'verified','identity':identity,'receipt':str(receipt)});return {**report,'reused':True}
            source=state/'source.json';verified=state/'verified-impacts.json';annotation=state/'article-classification-context.json';history=series/'v2-history.json'
            dist,release_root=daily_paths(ROOT,policy,day,key)
            report['output_paths']={'dist':str(dist),'publications':str(release_root),'external_storage':policy.get('external_storage') is True}
            commands={
              'source':[sys.executable,'-X','utf8','-B','scripts/rebuild_baselines.py','--config',str(config),'--cutoff',binding['cutoff_utc'],'--output',str(source),'--upstream-bundle',str(bundle)],
              'generate':[policy['node'],'scripts/generate_v2.mjs','--input',str(source),'--verified-impacts',str(verified),'--history',str(history)],
              'build':[policy['node'],'node_modules/vite/bin/vite.js','build','--outDir',str(dist)],
              'publish':[sys.executable,'-X','utf8','-B','scripts/deploy_v2.py','--credentials',policy['credential_file'],'--dist',str(dist),'--release-root',str(release_root)]}
            if recovery:commands['generate'].append('--historical')
            def generated_path():
                if not recovery:return ROOT/'public/data/v2/latest.json'
                records=json.loads((ROOT/'public/data/v2/manifest.json').read_bytes());return ROOT/'public/data/v2'/records[day]['path']
            current_sha=sha256((ROOT/'public/data/v2/latest.json').read_bytes()).hexdigest() if recovery else None
            for name,command in commands.items():
                reuse_started=utc();reuse_clock=time.perf_counter()
                saved=report['stages'].get(name,{})
                if saved.get('status')=='verified':
                    if name=='source' and source.is_file() and annotation.is_file() and sha256(source.read_bytes()).hexdigest()==saved['source_sha256'] and sha256(annotation.read_bytes()).hexdigest()==saved['annotation_sha256']:
                        note_reuse(report,name,reuse_started,reuse_clock);continue
                    if name=='generate' and generated_path().is_file() and sha256(generated_path().read_bytes()).hexdigest()==saved['snapshot_sha256']:
                        note_reuse(report,name,reuse_started,reuse_clock);continue
                    if name=='build':
                        try:
                            if build_proof(dist)==saved['outputs']:
                                note_reuse(report,name,reuse_started,reuse_clock);continue
                        except OSError:pass
                    if name=='publish':
                        note_reuse(report,name,reuse_started,reuse_clock);continue
                active_timing=begin_stage(report,name)
                report['active_stage']=name;report['status']='running';write(receipt,report)
                if name in ['build','publish']:daily_paths(ROOT,policy,day,key)
                source_timeout=min(5400,max(1800,int(policy.get('source_timeout_seconds',1800))))
                runner(command,state/(name+'.log'),source_timeout if name=='source' else 900)
                if recovery and sha256((ROOT/'public/data/v2/latest.json').read_bytes()).hexdigest()!=current_sha:raise ValueError('Historical recovery changed current edition')
                if name=='source':
                    obj=json.loads(source.read_bytes());obj['upstream_sync']=binding;obj['cutoff_series']='execbrief-03-v1';obj['baseline_semantics']='Retrospective same48h/03:00 English Event observations and current classification; not old05:00 or historical published forecasts';write(source,obj)
                    verified.write_text('[]\n',encoding='utf-8')
                    from sync_article_context import export
                    export(policy,bundle,annotation)
                    report['stages'][name]={'status':'verified','source_sha256':sha256(source.read_bytes()).hexdigest(),'annotation_sha256':sha256(annotation.read_bytes()).hexdigest()}
                    metrics=source_performance(state,active_timing[0]['started_at_utc'])
                    if metrics is not None:report['stages'][name]['performance']=metrics
                    else:report['stages'][name]['performance_status']='not_available_for_this_attempt'
                elif name=='generate':report['stages'][name]={'status':'verified','snapshot_id':json.loads(generated_path().read_bytes())['snapshot_id'],'snapshot_sha256':sha256(generated_path().read_bytes()).hexdigest()}
                elif name=='build':report['stages'][name]={'status':'verified','outputs':build_proof(dist)}
                else:
                    # Same OS lock as weekly, so this is this owner's release.
                    pubpath=sorted(release_root.glob('*/receipt.json'))[-1];publication=json.loads(pubpath.read_bytes())
                    if publication.get('status')!='verified':raise ValueError('Publication proof unavailable')
                    report['stages'][name]={'status':'verified','publication_receipt':str(pubpath),'publication_sha256':sha256(pubpath.read_bytes()).hexdigest()}
                report['stages'][name].update(end_stage(active_timing,'verified'));active_timing=None
                report['stages'][name]['reuse_count']=report['reuse_counts'][name]
                write(receipt,report)
            active_timing=begin_stage(report,'handoff');report['active_stage']='handoff';write(receipt,report)
            from handoff_v2 import save
            pubpath=Path(report['stages']['publish']['publication_receipt']);publication=json.loads(pubpath.read_bytes())
            if recovery:report['nas_handoff']=save(policy,source,publication,upstream_bundle=bundle,snapshot_path=generated_path())
            else:report['nas_handoff']=save(policy,source,publication,upstream_bundle=bundle)
            report['stages']['handoff']=dict(end_stage(active_timing,'verified'));active_timing=None
            report['stages']['handoff']['reuse_count']=report['reuse_counts']['handoff']
            report['status']='verified';report['finished_at_utc']=datetime.now(timezone.utc).isoformat();report.pop('active_stage',None);write(receipt,report);write(request,{**check,'status':'verified','identity':identity,'receipt':str(receipt)});return report
        except Exception as e:
            if 'report' not in locals():report={'date':day,'stages':{}}
            if active_timing:
                end_stage(active_timing,'failed',e)
                if report.get('active_stage')=='source':
                    metrics=source_performance(state,active_timing[0]['started_at_utc'])
                    if metrics is not None:active_timing[0]['performance']=metrics
                    else:active_timing[0]['performance_status']='not_available_for_this_attempt'
            report.update(status='retry_sync_stage',error_type=type(e).__name__,pending_retained=True)
            if 'receipt' in locals():write(receipt,report)
            write(request,{**check,'status':'retry_sync_stage','error_type':type(e).__name__});return report
        finally:dispose_read_cache(ROOT)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--config',type=Path,required=True);a=p.parse_args();print(json.dumps(cycle(a.config)))
