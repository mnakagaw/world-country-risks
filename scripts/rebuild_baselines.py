"""Reconstruct same-method days on the existing daily job; shared archive is read-only."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import argparse,json,subprocess,sys
from export_shared_gdelt import export,artifacts,ROOT
from archive_catalog import catalog

def rebuild(policy,cutoff,output):
    cutoff=datetime.fromisoformat(cutoff.replace('Z','+00:00')).astimezone(timezone.utc)
    archive=Path(policy['archive_root']);rows,failures=catalog(archive,cutoff-timedelta(days=16),cutoff)
    folder=ROOT/'.local/baseline-sources';folder.mkdir(parents=True,exist_ok=True)
    verified={};report=[]
    method=sha256(b''.join((ROOT/p).read_bytes() for p in ['scripts/export_shared_gdelt.py','scripts/archive_catalog.py','config/r_definitions.json'])).hexdigest()
    for offset in range(14,-1,-1):
        end=cutoff-timedelta(days=offset);day=(end+timedelta(hours=9)).date().isoformat()
        path=folder/(day+'.json');stamp=folder/(day+'.epoch.json')
        candidates=artifacts(archive,end-timedelta(hours=48),end,candidates=rows,verified=verified)
        epoch=sha256((method+json.dumps([{k:v for k,v in r.items() if k!='read_path'} for r in candidates],sort_keys=True)).encode()).hexdigest()
        if path.exists() and stamp.exists() and json.loads(stamp.read_bytes()).get('epoch')==epoch:
            result=json.loads(path.read_bytes());reused=True
        else:
            result=export(archive,end,path,policy.get('execbrief_root'),candidates=rows,verified=verified,quiet=True);reused=False
            stamp.write_text(json.dumps({'epoch':epoch,'method_sha256':method})+'\n')
        report.append({'date':day,'available_slots':result['coverage']['available_slots'],'status':result['source_status'],'reused':reused,'input_sha256':sha256(path.read_bytes()).hexdigest()})
        if offset==0:
            target=Path(output);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(path.read_bytes())
    edition=(cutoff+timedelta(hours=9)).date().isoformat()
    subprocess.run([policy['node'],'scripts/bootstrap_baseline.mjs','--sources',str(folder),'--date',edition],cwd=ROOT,check=True,timeout=120)
    receipt={'edition':edition,'method_sha256':method,'days':report,'catalog_failures':failures,'shared_archive_written':False}
    (folder/'rebuild-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    return receipt

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--cutoff',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    print(json.dumps(rebuild(json.loads(Path(a.config).read_bytes()),a.cutoff,a.output)))
