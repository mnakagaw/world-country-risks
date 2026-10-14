"""Exact7d archive observations, without converting daily totals into weekly baselines."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
import argparse,json
from archive_catalog import catalog
from export_shared_gdelt import export,ROOT

def rebuild(policy,end,output):
    end=datetime.fromisoformat(end.replace('Z','+00:00')).astimezone(timezone.utc)
    rows,failures=catalog(Path(policy['archive_root']),end-timedelta(weeks=9),end)
    folder=ROOT/'.local/weekly-baseline-sources';folder.mkdir(parents=True,exist_ok=True)
    verified={};report=[]
    for offset in range(8,-1,-1):
        finish=end-timedelta(weeks=offset);begin=finish-timedelta(days=7)
        # Retain genuinely unavailable weeks, do not make a synthetic zero week.
        available=sum(bool(rows.get((begin+timedelta(minutes=15*i)).isoformat())) for i in range(672))
        if offset and available<336:
            report.append({'end':finish.isoformat(),'status':'insufficient_archive_candidates','candidate_slots':available});continue
        name=begin.date().isoformat();target=folder/(name+'.json')
        result=export(Path(policy['archive_root']),finish,target,hours=168,candidates=rows,verified=verified,quiet=True)
        report.append({'start':name,'status':result['source_status'],'slots':result['coverage']['available_slots']})
        if offset==0:Path(output).parent.mkdir(parents=True,exist_ok=True);Path(output).write_bytes(target.read_bytes())
    (folder/'report.json').write_text(json.dumps({'weeks':report,'catalog_failures':failures},indent=2)+'\n')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--cutoff',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    print(json.dumps(rebuild(json.loads(Path(a.config).read_bytes()),a.cutoff,a.output)))
