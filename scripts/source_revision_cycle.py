"""Existing native owner's staged late-source transaction. Large artifacts stay on F:."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone,timedelta
import json,subprocess,sys,os,stat
from cycle_lock import publication_lock
from execbrief_sync import canonical,Waiting
from source_revision_queue import queue_root,control,atomic,parent_binding,InvalidRequest
from source_revision_adapter import artifact as read_artifact,json_artifact,completed_proof
from source_supplement_gate import freeze,write_bundle,require
from storage_placement import daily_paths,external_root,REVIEWED_C_WRITE_CHAINS
from synced_cycle import method_epoch,build_proof
from handoff_v2 import file_sha

ROOT=Path(__file__).resolve().parents[1]
MIB=1024**2

def artifact(path,limit=4*MIB):
    try:return read_artifact(path,limit)
    except InvalidRequest as error:
        if str(error)=='oversized_revision_artifact':raise Waiting('revision_artifact_size_deferred') from error
        raise

def bounded_copy(source,target,limit):
    raw=artifact(source,limit);target=Path(target);target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists():require(target.read_bytes()==raw,'immutable_revision_work_conflict')
    else:
        pending=target.with_suffix('.revision-pending');pending.write_bytes(raw)
        require(sha256(pending.read_bytes()).digest()==sha256(raw).digest(),'revision_pending_readback_mismatch');pending.replace(target)
    require(sha256(target.read_bytes()).digest()==sha256(raw).digest(),'revision_copy_readback_mismatch')

def replace(path,raw,limit):
    if len(raw)>limit:raise Waiting('revision_control_output_limit')
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);pending=path.with_suffix('.revision-pending');pending.write_bytes(raw)
    require(sha256(pending.read_bytes()).digest()==sha256(raw).digest(),'revision_pending_readback_mismatch');pending.replace(path)
    require(path.read_bytes()==raw,'revision_promotion_readback_mismatch')

def checked_path(path,anchor):
    """Reject lexical escapes and every original reparse ancestor before resolve."""
    path=Path(path).absolute();anchor=Path(anchor).absolute()
    require('..' not in path.parts and path.is_relative_to(anchor),'revision_path_escape')
    for part in [path,*path.parents]:
        try:info=part.lstat()
        except FileNotFoundError:info=None
        if info is not None:require(not stat.S_ISLNK(info.st_mode) and not (getattr(info,'st_file_attributes',0)&1024),'revision_reparse_point')
        if part==anchor:break
    resolved=path.resolve()
    require(resolved.is_relative_to(anchor),'revision_path_escape')
    return resolved


def daily_public_files(public):
    """The existing non-weekly deploy allowlist; never enumerate old history."""
    public=Path(public).absolute();public=checked_path(public,public.parent);files=[]
    def include(path):
        checked_path(path,public);files.append(path)
        require(len(files)<=4096,'revision_daily_file_count_limit')
    for name in ['assets','country-interest','data/v2']:
        folder=public/name
        if not folder.exists():continue
        checked_path(folder,public)
        for directory,dirs,names in os.walk(folder,followlinks=False):
            for child in dirs:checked_path(Path(directory)/child,public)
            for child in names:include(Path(directory)/child)
    for name in ['country-interest.js','country-interest.css','country-interest-cards.js','country-interest-cards.css','country-interest-alerts.js','country-interest-alerts.css','geo/countries.overview.geojson','geo/countries.overview.metadata.json']:
        path=public/name
        if path.exists():include(path)
    total=sum(p.stat().st_size for p in files)
    require(total<=1024*MIB and all(p.stat().st_size<=64*MIB for p in files),'revision_daily_public_size_limit')
    return sorted(files),total


def stage_daily_public(public,dist):
    """SHA/readback checked, bounded F-only static copies before generated overlay."""
    public=Path(public).absolute();files,total=daily_public_files(public);public=checked_path(public,public.parent)
    external=Path(external_root(2*total+len(files)*65536)).absolute()
    require(Path(dist).absolute().is_relative_to(external/'world-country-risks'),'revision_dist_outside_external')
    dist=checked_path(dist,external)
    def target_for(source):return checked_path(dist/source.relative_to(public),dist)
    # Refuse compiled-asset collisions before writing any public data. Retried
    # data/v2 controls may differ from an earlier generated overlay and are reset.
    plan=[]
    for source in files:
        raw=artifact(source,64*MIB);digest=sha256(raw).hexdigest();target=target_for(source)
        if source.relative_to(public).parts[0]=='assets' and target.exists():require(file_sha(target)==digest,'revision_compiled_asset_collision')
        plan.append((source,target,digest,len(raw)))
    copied={}
    for source,target,digest,size in plan:
        checked_path(source,public)
        raw=artifact(source,64*MIB);require(len(raw)==size and sha256(raw).hexdigest()==digest,'revision_public_changed_during_copy')
        require(Path(external_root(2*size+65536)).absolute()==external,'revision_external_identity_changed')
        target_for(source);replace(target,raw,64*MIB)
        copied[source.relative_to(public).as_posix()]={'sha256':digest,'bytes':size}
    return {'files':copied,'bytes':total,'client_only':True}


def write_context(path,raw):
    if len(raw)>16*MIB:raise Waiting('revision_context_size_deferred')
    external=external_root(2*len(raw)+65536).absolute();path=Path(path).absolute()
    require(path.is_relative_to(external/'world-country-risks/daily') and path.name=='article-classification-context.json','revision_context_outside_external_daily')
    checked_path(path,external);replace(path,raw,16*MIB)


def run(command,log,timeout):
    temp=Path(log).parent/'temp';temp.mkdir(exist_ok=True)
    env={**os.environ,'TEMP':str(temp),'TMP':str(temp),'TMPDIR':str(temp),'NODE_COMPILE_CACHE':str(temp/'node-compile-cache'),'PYTHONDONTWRITEBYTECODE':'1'}
    start=datetime.now(timezone.utc);result=subprocess.run(command,cwd=ROOT,capture_output=True,timeout=timeout,env=env)
    if len(result.stdout)+len(result.stderr)>4*MIB:raise Waiting('revision_stage_log_limit')
    Path(log).write_bytes(result.stdout+b'\n'+result.stderr)
    if result.returncode:
        if Path(log).stem=='source':
            try:
                metrics=json_artifact(artifact(Path(log).parent/'source-metrics.json'))
                if metrics.get('error_type')=='StorageDeferred' and datetime.fromisoformat(metrics['started_at_utc'])>=start:raise Waiting('revision_source_resource_deferred:StorageDeferred')
            except (OSError,KeyError,ValueError):pass
        raise Waiting('revision_stage_failed:'+Path(log).stem)

def candidate_path(root,request):return Path(root)/'.local/source-revision-completion'/(request['id']+'.json')

def c_plan(root,request,bundle,blobs,snapshot_id=None):
    names=['scripts/source_revision_cycle.py','scripts/source_supplement_gate.py','scripts/source_revision_adapter.py','scripts/source_revision_queue.py','scripts/execbrief_sync.py',
        'scripts/cycle_lock.py','scripts/bounded_source_io.py','scripts/export_shared_gdelt.py','scripts/rebuild_baselines.py','scripts/aggregation_epoch.py','scripts/run_metadata.py',
        'scripts/archive_catalog.py','scripts/sync_article_context.py','scripts/handoff_v2.py','scripts/generate_v2.mjs','scripts/bootstrap_baseline.mjs','scripts/build_source_revision.mjs']
    writes={str(Path(bundle)/name):max(1,len(raw)) for name,raw in blobs.items()}
    writes.update({str(queue_root(root)/request['id']/'state.json'):65536,str(queue_root(root)/request['id']/'run.lock'):1,
        str(candidate_path(root,request)):65536,str(Path(root)/'.local/publication.lock'):1})
    if snapshot_id:
        for name,cap in [(snapshot_id+'.json',64*MIB),('latest.json',64*MIB),('manifest.json',MIB),('status.json',65536)]:writes[str(Path(root)/'public/data/v2'/name)]=cap
    return {'kind':'wcr-bounded-c-write-plan-v1','writer_chain':{name:file_sha(Path(root)/name) for name in names},'spill_limit_bytes':512*MIB,'writes':[{'path':p,'max_bytes':cap} for p,cap in writes.items()]}

def admission(root,policy,request,key,bundle,blobs,snapshot_id=None):
    # Until root review approves this exact chain, retain the old8GiB admission.
    # An empty allowlist never blocks a run that still satisfies the stronger
    # existing guard, and never authorizes a lower caller-chosen scalar.
    plan=c_plan(root,request,bundle,blobs,snapshot_id)
    checksum=sha256(json.dumps(plan['writer_chain'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    if checksum not in REVIEWED_C_WRITE_CHAINS:return daily_paths(root,policy,request['date'],key)
    return daily_paths(root,policy,request['date'],key,c_write_plan=plan)

def finalize(root,policy,request,candidate):
    """Resume after public/NAS verification without republishing or rolling back a newer day."""
    require(candidate.get('request_receipt_sha256')==request['source_revision_receipt']['sha256'] and candidate.get('parent')==request['parent'],'revision_completion_candidate_identity_mismatch')
    proof=candidate['proof'];generated=Path(candidate['generated_dir']).resolve()
    external=external_root(0).resolve()
    require(generated.is_relative_to(external/'world-country-risks/daily'/request['date']) and generated.name=='generated-v2','unregistered_revision_completion_path')
    payload=generated/(proof['snapshot_id']+'.json');completed_proof(root,request,proof,snapshot_path=payload)
    # Re-admit the exact final promotion, including retry after a process crash.
    admission(root,policy,request,generated.parent.name,Path(root)/'.local/unused',{},proof['snapshot_id'])
    public=Path(root)/'public/data/v2';records=json_artifact(artifact(public/'manifest.json'));current=records.get(request['date'],{})
    staged=json_artifact(artifact(generated/'manifest.json'))[request['date']]
    require(staged['snapshot_id']==proof['snapshot_id'] and staged['sha256']==proof['snapshot_sha256'],'revision_manifest_proof_mismatch')
    # Always retain the immutable revision. A later normal day or later revision
    # may have become current after an interrupted finalization.
    bounded_copy(payload,public/payload.name,64*MIB)
    if current.get('snapshot_id') in [request['parent']['snapshot_id'],proof['snapshot_id']]:records[request['date']]=staged
    else:
        revisions={r['snapshot_id']:r for r in current.get('revisions',[])}
        for row in staged.get('revisions',[]):revisions.setdefault(row['snapshot_id'],row)
        current['revisions']=list(revisions.values());records[request['date']]=current
    latest=json_artifact(artifact(public/'latest.json',64*MIB)) if (public/'latest.json').exists() else {}
    replace(public/'manifest.json',json.dumps(records,indent=2).encode()+b'\n',MIB)
    history_only=json_artifact(artifact(payload,64*MIB))['upstream_sync']['source_revision'].get('history_only') is True
    if (not history_only and latest.get('date','')<=request['date'] and records[request['date']]['snapshot_id']==proof['snapshot_id']):
        replace(public/'latest.json',artifact(payload,64*MIB),64*MIB)
        status=artifact(generated/'status.json',65536)
        require(json_artifact(status)['snapshot_id']==proof['snapshot_id'],'revision_status_proof_mismatch')
        replace(public/'status.json',status,65536)
        nas_pointer=Path(policy['handoff_root'])/'daily-latest.json'
        before=artifact(nas_pointer) if nas_pointer.exists() else None
        old=json_artifact(before) if before else {}
        if str(old.get('path','')).replace('\\','/').split('/')[1:2]<=[request['date']]:
            target=Path(proof['nas_manifest']).parent;relative=target.relative_to(Path(policy['handoff_root'])).as_posix()
            require(relative.startswith('daily/'+request['date']+'/'),'revision_NAS_pointer_outside_date')
            raw=canonical({'path':relative,'snapshot_id':proof['snapshot_id']})+b'\n'
            pending=nas_pointer.with_suffix('.revision-pending');pending.write_bytes(raw)
            require((artifact(nas_pointer) if nas_pointer.exists() else None)==before,'revision_NAS_pointer_changed_concurrently');pending.replace(nas_pointer)
            require(artifact(nas_pointer)==raw,'revision_NAS_pointer_readback_mismatch')
    completed_proof(root,request,proof)
    return proof

def recover(root,policy,request):
    p=candidate_path(root,request)
    if not p.exists():return None
    with publication_lock(Path(root)/'.local/publication.lock') as acquired:
        if not acquired:raise Waiting('publication_owner_busy')
        return finalize(root,policy,request,control(p)[1])

def consume(policy,request,runner=run):
    root=ROOT
    with publication_lock(root/'.local/publication.lock') as acquired:
        if not acquired:raise Waiting('publication_owner_busy')
        p=candidate_path(root,request)
        if p.exists():return finalize(root,policy,request,control(p)[1])
        parent_binding(root,policy,request)
        latest=json_artifact(artifact(root/'public/data/v2/latest.json',64*MIB));historical=latest['date']>request['date']
        bundle,binding,blobs=freeze(policy,request,root,history_only=historical,persist=False)
        chain=c_plan(root,request,bundle,blobs)['writer_chain']
        key=sha256(canonical({'bundle':binding['bundle_id'],'method':method_epoch(),'writer_chain':chain})).hexdigest()
        dist,releases=admission(root,policy,request,key,bundle,blobs)
        write_bundle(bundle,blobs,writer=replace)
        require(policy.get('external_storage') is True,'late_revision_requires_verified_external_staging')
        _,public_size=daily_public_files(root/'public')
        external_root(public_size*3+8*1024**3)
        base=dist.parent;base.mkdir(parents=True,exist_ok=True);series=base/'series';series.mkdir(exist_ok=True)
        state=base/'revision-stages.json';report=control(state)[1] if state.exists() else {'stages':{},'bundle_id':binding['bundle_id']}
        require(report['bundle_id']==binding['bundle_id'],'revision_stage_bundle_mismatch')
        generated=base/'generated-v2';generated.mkdir(exist_ok=True);audit=base/'audits';source=base/'source.json';context=base/'article-classification-context.json';verified=base/'verified-impacts.json'
        run_policy={**policy,'series_root':str(series)};config=base/'controller.private.json'
        replace(config,json.dumps(run_policy).encode()+b'\n',65536)
        if not state.exists():
            original_series=Path(policy['series_root'])
            cache=series/'baseline-sources';cache.mkdir(exist_ok=True)
            earliest=(datetime.fromisoformat(request['date'])-timedelta(days=14)).date().isoformat()
            seeds=[old for old in (original_series/'baseline-sources').glob('*.json') if earliest<=old.name[:10]<=request['date'] and old.name[10:] in ('.json','.epoch.json')]
            if (original_series/'v2-history.json').stat().st_size+sum(p.stat().st_size for p in seeds)>192*MIB:raise Waiting('revision_C_seed_hydration_limit')
            bounded_copy(original_series/'v2-history.json',series/'v2-history.json',512*MIB)
            for old in seeds:bounded_copy(old,cache/old.name,64*MIB)
            bounded_copy(root/'public/data/v2/manifest.json',generated/'manifest.json',MIB)
            atomic(state,report)
        history=series/'v2-history.json'
        commands={
            'source':[sys.executable,'-X','utf8','-B','scripts/rebuild_baselines.py','--config',str(config),'--cutoff',binding['cutoff_utc'],'--output',str(source),'--upstream-bundle',str(bundle)],
            'generate':[policy['node'],'--max-old-space-size=1024','scripts/generate_v2.mjs','--input',str(source),'--verified-impacts',str(verified),'--history',str(history),'--output-dir',str(generated),'--audit-dir',str(audit)],
            'build':[policy['node'],'--max-old-space-size=1024','scripts/build_source_revision.mjs','--client-only','--outDir',str(dist),'--cache-dir',str(base/'temp/vite-cache')],
            'publish':[sys.executable,'-X','utf8','-B','scripts/deploy_v2.py','--credentials',policy['credential_file'],'--dist',str(dist),'--release-root',str(releases)]}
        if historical:commands['generate'].append('--historical')
        for name,command in commands.items():
            saved=report['stages'].get(name)
            if saved:
                if name=='source' and file_sha(source)==saved['source_sha256'] and file_sha(context)==saved['context_sha256']:continue
                if name=='generate' and file_sha(generated/(saved['snapshot_id']+'.json'))==saved['snapshot_sha256']:continue
                if name=='build' and build_proof(dist)==saved['outputs']:continue
                if name=='publish' and file_sha(Path(saved['receipt']))==saved['sha256']:continue
                raise InvalidRequest('revision_saved_stage_SHA_mismatch')
            admission(root,policy,request,key,bundle,blobs,report['stages'].get('generate',{}).get('snapshot_id'))
            start=datetime.now(timezone.utc).isoformat();runner(command,base/(name+'.log'),min(5400,max(1800,int(policy.get('source_timeout_seconds',3600)))) if name=='source' else 900)
            row={'started_at_utc':start,'finished_at_utc':datetime.now(timezone.utc).isoformat()}
            if name=='source':
                obj=json_artifact(artifact(source,64*MIB));obj.update(upstream_sync=binding,cutoff_series='execbrief-03-v1',baseline_semantics='Retrospective same48h/03:00 English Events; source supplement became available after the original seal')
                replace(source,json.dumps(obj).encode()+b'\n',64*MIB);replace(verified,b'[]\n',65536)
                from sync_article_context import export
                export(policy,bundle,context,writer=write_context);artifact(context,16*MIB)
                row.update(source_sha256=file_sha(source),context_sha256=file_sha(context))
            elif name=='generate':
                record=json_artifact(artifact(generated/'manifest.json'))[request['date']];payload=generated/record['path'];value=json_artifact(artifact(payload,64*MIB))
                require(value['snapshot_id']==record['snapshot_id'] and file_sha(payload)==record['sha256'],'generated_revision_SHA_mismatch')
                require(value['upstream_sync']==binding,'generated_revision_binding_mismatch');row.update(snapshot_id=value['snapshot_id'],snapshot_sha256=record['sha256'])
            elif name=='build':
                row['static_public']=stage_daily_public(root/'public',dist)
                for f in generated.iterdir():
                    if f.is_file():replace(dist/'data/v2'/f.name,artifact(f,64*MIB),64*MIB)
                row['outputs']=build_proof(dist)
            else:
                pub=sorted(releases.glob('*/receipt.json'))[-1];publication=json_artifact(artifact(pub));require(publication.get('status')=='verified','revision_publication_unverified')
                row.update(receipt=str(pub),sha256=file_sha(pub))
            report['stages'][name]=row;atomic(state,report)
        generated_record=report['stages']['generate'];snapshot_path=generated/(generated_record['snapshot_id']+'.json')
        publication_row=report['stages']['publish'];publication=json_artifact(artifact(publication_row['receipt']))
        from handoff_v2 import save
        nas=save(run_policy,source,publication,upstream_bundle=bundle,snapshot_path=snapshot_path,audit_path=audit/(generated_record['snapshot_id']+'.json'))
        proof={'snapshot_id':generated_record['snapshot_id'],'snapshot_sha256':generated_record['snapshot_sha256'],
            'publication_receipt':publication_row['receipt'],'publication_sha256':publication_row['sha256'],
            'nas_manifest':str(Path(nas['path'])/'manifest.json'),'nas_manifest_sha256':nas['manifest_sha256']}
        completed_proof(root,request,proof,snapshot_path=snapshot_path)
        # Checkpoint before local selection changes. A native retry can finish
        # after a crash without re-running source, generation, publication or NAS.
        candidate={'request_receipt_sha256':request['source_revision_receipt']['sha256'],'parent':request['parent'],'proof':proof,'generated_dir':str(generated)}
        atomic(p,candidate)
        return finalize(root,policy,request,candidate)
