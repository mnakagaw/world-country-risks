"""One daily adapter called by the existing shared Windows tick.

No scheduler here. Private controller paths and credentials are restored disabled.
Failed stages retain the fixed input/history and cannot certify publication.
"""
from datetime import datetime,timedelta,timezone
from pathlib import Path
from hashlib import sha256
import argparse,json,os,subprocess,sys

ROOT=Path(__file__).resolve().parents[1]

def dispose_read_cache():
    cache=(ROOT/'work/archive-objects').resolve()
    if not cache.is_relative_to((ROOT/'work').resolve()):raise ValueError('Unsafe cache cleanup')
    if not cache.exists():return
    if cache.is_junction() or cache.is_symlink():raise ValueError('Cache is a link')
    for file in cache.iterdir():
        if file.is_symlink() or not file.is_file() or file.resolve().parent!=cache:raise ValueError('Unexpected cache member')
        file.unlink()
    cache.rmdir()


def cycle(config,now=None):
    policy=json.loads(Path(config).read_text(encoding='utf-8'))
    if policy.get('enabled') is not True:return {'status':'disabled'}
    now=now or datetime.now(timezone.utc)
    cutoff=now.replace(hour=20,minute=0,second=0,microsecond=0)
    if cutoff>now:cutoff-=timedelta(days=1)
    date=(cutoff+timedelta(hours=9)).date().isoformat()
    state=ROOT/'.local/cycles'/date;state.mkdir(parents=True,exist_ok=True)
    receipt=state/'receipt.json'
    if receipt.is_file():
        old=json.loads(receipt.read_text())
        if old.get('status')=='verified':return {**old,'reused':True}
    lock=ROOT/'.local/cycle.lock'
    try:lock.open('x').close()
    except FileExistsError:return {'status':'busy','pending_retained':True}
    try:
        report={'status':'running','date':date,'cutoff_utc':cutoff.isoformat(),'owner':'countryrisks-daily','stages':[]}
        source=state/'source.json'
        from combined_verified_impacts import export as export_verified_impacts
        verified=state/'verified-impacts.json'
        namespace=state/'verification'
        export_verified_impacts(policy,cutoff.isoformat(),verified,namespace)
        commands=[
          [sys.executable,'-X','utf8','-B','scripts/rebuild_baselines.py','--config',str(config),'--cutoff',cutoff.isoformat(),'--output',str(source)],
          [policy['node'],'scripts/generate_v2.mjs','--input',str(source),'--verified-impacts',str(verified),'--verification-root',str(namespace)],
          [policy['node'],'node_modules/vite/bin/vite.js','build'],
          [sys.executable,'-X','utf8','-B','scripts/deploy_v2.py','--credentials',policy['credential_file']]]
        for index,command in enumerate(commands):
            result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=1800 if index==0 else 480)
            (state/f'stage-{index}.log').write_text(result.stdout+'\n'+result.stderr,encoding='utf-8')
            report['stages'].append({'stage':index,'exit_code':result.returncode})
            if result.returncode:report['status']='failed';break
        else:
            from handoff_v2 import save
            publication=json.loads(sorted((ROOT/'.local/releases').glob('*/receipt.json'))[-1].read_bytes())
            if publication.get('status')!='verified':raise ValueError('Publication proof unavailable')
            report['nas_handoff']=save(policy,source,publication)
            report['status']='verified'
        receipt.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');return report
    except Exception as error:
        report={'status':'failed','error_type':type(error).__name__,'pending_retained':True}
        receipt.write_text(json.dumps(report)+'\n');return report
    finally:
        try:dispose_read_cache()
        finally:lock.unlink(missing_ok=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--config',type=Path,required=True);a=p.parse_args();print(json.dumps(cycle(a.config)))
