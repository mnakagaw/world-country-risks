"""Former Monday11:00 JST update on the same shared Windows tick and publish lock."""
from datetime import datetime,timedelta,timezone
from pathlib import Path
import json,subprocess,sys
from local_cycle import ROOT,dispose_read_cache


def cycle(config,now=None):
    policy=json.loads(Path(config).read_bytes())
    if policy.get('enabled') is not True:return {'status':'disabled'}
    now=now or datetime.now(timezone.utc);end=now.replace(hour=0,minute=0,second=0,microsecond=0)-timedelta(days=now.weekday())
    start=end-timedelta(days=7);week=f'{start.isocalendar().year}-W{start.isocalendar().week:02}'
    folder=ROOT/'.local/weekly-cycles'/week;folder.mkdir(parents=True,exist_ok=True);receipt=folder/'receipt.json'
    if receipt.is_file():
        old=json.loads(receipt.read_bytes())
        if old.get('status')=='verified':return {**old,'reused':True}
    lock=ROOT/'.local/cycle.lock'
    try:lock.open('x').close()
    except FileExistsError:return {'status':'busy','pending_retained':True}
    try:
        source=folder/'source.json';report={'status':'running','week':week,'owner':'countryrisks-weekly','stages':[]}
        commands=[
          [sys.executable,'-X','utf8','-B','scripts/rebuild_weekly_baselines.py','--config',str(config),'--cutoff',end.isoformat(),'--output',str(source)],
          [policy['node'],'scripts/generate_weekly_v2.mjs','--input',str(source)],
          [policy['node'],'node_modules/vite/bin/vite.js','build'],
          [sys.executable,'-X','utf8','-B','scripts/deploy_v2.py','--credentials',policy['credential_file'],'--weekly']]
        for i,command in enumerate(commands):
            result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=3600 if i==0 else 900)
            (folder/f'stage-{i}.log').write_text(result.stdout+'\n'+result.stderr,encoding='utf-8')
            report['stages'].append({'stage':i,'exit_code':result.returncode})
            if result.returncode:report['status']='failed';break
        else:
            from handoff_weekly import save
            report['nas_handoff']=save(policy,source);report['status']='verified'
        receipt.write_text(json.dumps(report,indent=2)+'\n');return report
    except Exception as error:
        report={'status':'failed','error_type':type(error).__name__,'pending_retained':True};receipt.write_text(json.dumps(report)+'\n');return report
    finally:
        try:dispose_read_cache()
        finally:lock.unlink(missing_ok=True)
