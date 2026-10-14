"""Existing daily owner consumes one verified ExecBrief edition; no scheduler."""
from datetime import datetime,timezone
from pathlib import Path
from hashlib import sha256
import argparse,json,subprocess,sys
from execbrief_sync import closed_edition,freeze_inputs,canonical,Waiting,JST
from cycle_lock import publication_lock
from local_cycle import dispose_read_cache

ROOT=Path(__file__).resolve().parents[1]
def write(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);pending=path.with_suffix('.pending');pending.write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8');pending.replace(path)
def method_epoch():
    names=['scripts/synced_cycle.py','scripts/execbrief_sync.py','scripts/sync_article_context.py','scripts/rebuild_baselines.py','scripts/bootstrap_baseline.mjs','scripts/export_shared_gdelt.py','scripts/archive_catalog.py','scripts/r_support.py','scripts/generate_v2.mjs','scripts/engine_v2.mjs','scripts/monitoring_v2.mjs','scripts/rindex_v2.mjs','scripts/r_bundles.mjs','config/scoring.json','config/r_definitions.json']
    return sha256('|'.join(sha256((ROOT/n).read_bytes()).hexdigest() for n in names).encode()).hexdigest()
def run(command,log,timeout):
    r=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=timeout)
    log.write_text(r.stdout+'\n'+r.stderr,encoding='utf-8')
    if r.returncode:raise RuntimeError('stage_command_failed')
def build_proof():
    import re
    base=ROOT/'dist';html=(base/'index.html').read_text(encoding='utf-8')
    names=['index.html','data/v2/latest.json','data/v2/manifest.json']+re.findall(r'(?:src|href)=["\']\./(assets/[^"\']+)["\']',html)
    return {n:sha256((base/n).read_bytes()).hexdigest() for n in names}
def cycle(config,now=None,gate=freeze_inputs,runner=run):
    policy=json.loads(Path(config).read_bytes())
    if policy.get('enabled') is not True:return {'status':'disabled'}
    now=(now or datetime.now(timezone.utc)).astimezone(timezone.utc);day,cutoff=closed_edition(now)
    if day<policy['sync_effective_date']:return {'status':'awaiting_sync_effective_date','date':day,'effective_date':policy['sync_effective_date'],'previous_publication_retained':True}
    series=Path(policy['series_root']);request=series/'requests'/day/'receipt.json'
    deadline=datetime.fromisoformat(day).replace(hour=23,minute=55,tzinfo=JST).astimezone(timezone.utc)
    if now>deadline:
        expired={'status':'expired_execbrief_daily','date':day,'previous_publication_retained':True};write(request,expired);return expired
    with publication_lock(ROOT/'.local/publication.lock') as acquired:
        if not acquired:return {'status':'busy','pending_retained':True}
        try:
            check={'status':'waiting_execbrief_daily','date':day,'cutoff_utc':cutoff.isoformat(),'previous_publication_retained':True}
            previous=json.loads(request.read_bytes()) if request.exists() else {};attempt=previous.get('checks',0)+1
            if attempt>policy.get('max_daily_checks',84):
                expired={'status':'expired_execbrief_daily','date':day,'checks':attempt,'previous_publication_retained':True};write(request,expired);return expired
            check={'status':'waiting_execbrief_daily','date':day,'cutoff_utc':cutoff.isoformat(),'checks':attempt,'deadline_utc':deadline.isoformat(),'previous_publication_retained':True}
            try:bundle,binding=gate(policy,day,cutoff,series/'inputs')
            except (Waiting,OSError,KeyError,ValueError) as e:
                check['reason']=str(e) if isinstance(e,Waiting) else type(e).__name__;write(request,check);return check
            identity={'upstream_bundle_id':binding['bundle_id'],'calculation_epoch':method_epoch(),'cutoff_series':'execbrief-03-v1'};key=sha256(canonical(identity)).hexdigest();state=series/'cycles'/day/key;state.mkdir(parents=True,exist_ok=True);receipt=state/'receipt.json'
            report=json.loads(receipt.read_bytes()) if receipt.exists() else {'status':'running','date':day,'cutoff_utc':binding['cutoff_utc'],'owner':'countryrisks-daily','identity':identity,'upstream_binding':binding,'stages':{}}
            if report.get('status')=='verified':
                proofs=[(state/'source.json',report['stages']['source']['source_sha256']),(state/'article-classification-context.json',report['stages']['source']['annotation_sha256']),(Path(report['stages']['publish']['publication_receipt']),report['stages']['publish']['publication_sha256'])]
                if any(not p.is_file() or sha256(p.read_bytes()).hexdigest()!=expected for p,expected in proofs):
                    waiting={**check,'status':'retry_sync_stage','reason':'completed_input_or_publication_receipt_SHA_mismatch','previous_publication_retained':True};write(request,waiting);return waiting
                write(request,{**check,'status':'verified','identity':identity,'receipt':str(receipt)});return {**report,'reused':True}
            source=state/'source.json';verified=state/'verified-impacts.json';annotation=state/'article-classification-context.json';history=series/'v2-history.json'
            commands={
              'source':[sys.executable,'-X','utf8','-B','scripts/rebuild_baselines.py','--config',str(config),'--cutoff',binding['cutoff_utc'],'--output',str(source),'--upstream-bundle',str(bundle)],
              'generate':[policy['node'],'scripts/generate_v2.mjs','--input',str(source),'--verified-impacts',str(verified),'--history',str(history)],
              'build':[policy['node'],'node_modules/vite/bin/vite.js','build'],
              'publish':[sys.executable,'-X','utf8','-B','scripts/deploy_v2.py','--credentials',policy['credential_file']]}
            for name,command in commands.items():
                saved=report['stages'].get(name,{})
                if saved.get('status')=='verified':
                    if name=='source' and source.is_file() and annotation.is_file() and sha256(source.read_bytes()).hexdigest()==saved['source_sha256'] and sha256(annotation.read_bytes()).hexdigest()==saved['annotation_sha256']:continue
                    if name=='generate' and (ROOT/'public/data/v2/latest.json').is_file() and sha256((ROOT/'public/data/v2/latest.json').read_bytes()).hexdigest()==saved['snapshot_sha256']:continue
                    if name=='build':
                        try:
                            if build_proof()==saved['outputs']:continue
                        except OSError:pass
                    if name=='publish':continue
                report['active_stage']=name;report['status']='running';write(receipt,report)
                runner(command,state/(name+'.log'),1800 if name=='source' else 900)
                if name=='source':
                    obj=json.loads(source.read_bytes());obj['upstream_sync']=binding;obj['cutoff_series']='execbrief-03-v1';obj['baseline_semantics']='Retrospective same48h/03:00 English Event observations and current classification; not old05:00 or historical published forecasts';write(source,obj)
                    verified.write_text('[]\n',encoding='utf-8')
                    from sync_article_context import export
                    export(policy,bundle,annotation)
                    report['stages'][name]={'status':'verified','source_sha256':sha256(source.read_bytes()).hexdigest(),'annotation_sha256':sha256(annotation.read_bytes()).hexdigest()}
                elif name=='generate':report['stages'][name]={'status':'verified','snapshot_id':json.loads((ROOT/'public/data/v2/latest.json').read_bytes())['snapshot_id'],'snapshot_sha256':sha256((ROOT/'public/data/v2/latest.json').read_bytes()).hexdigest()}
                elif name=='build':report['stages'][name]={'status':'verified','outputs':build_proof()}
                else:
                    # Same OS lock as weekly, so this is this owner's release.
                    pubpath=sorted((ROOT/'.local/releases').glob('*/receipt.json'))[-1];publication=json.loads(pubpath.read_bytes())
                    if publication.get('status')!='verified':raise ValueError('Publication proof unavailable')
                    report['stages'][name]={'status':'verified','publication_receipt':str(pubpath),'publication_sha256':sha256(pubpath.read_bytes()).hexdigest()}
                write(receipt,report)
            report['active_stage']='handoff';write(receipt,report)
            from handoff_v2 import save
            pubpath=Path(report['stages']['publish']['publication_receipt']);publication=json.loads(pubpath.read_bytes());report['nas_handoff']=save(policy,source,publication,upstream_bundle=bundle)
            report['status']='verified';report['finished_at_utc']=datetime.now(timezone.utc).isoformat();report.pop('active_stage',None);write(receipt,report);write(request,{**check,'status':'verified','identity':identity,'receipt':str(receipt)});return report
        except Exception as e:
            if 'report' not in locals():report={'date':day,'stages':{}}
            report.update(status='retry_sync_stage',error_type=type(e).__name__,pending_retained=True)
            if 'receipt' in locals():write(receipt,report)
            write(request,{**check,'status':'retry_sync_stage','error_type':type(e).__name__});return report
        finally:dispose_read_cache(ROOT)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--config',type=Path,required=True);a=p.parse_args();print(json.dumps(cycle(a.config)))
