"""Adapter for the existing shared Windows tick; no independent scheduler."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json
from synced_cycle import cycle,ROOT


def main():
    p=argparse.ArgumentParser();p.add_argument('--result',type=Path,required=True);p.add_argument('--weekly',action='store_true');a=p.parse_args()
    if a.weekly:
        from weekly_cycle import cycle as weekly
        report=weekly(ROOT/'.local/controller.json')
    else:
        report=cycle(ROOT/'.local/controller.json')
        queue=ROOT/'.local/history-recovery.json'
        if report.get('status')=='verified' and queue.is_file():
            requests=json.loads(queue.read_bytes())
            # Same invocation/OS lock, after current-day publication. No new job.
            if requests.get('enabled') is True:
                report['historical_recoveries']=[cycle(ROOT/'.local/controller.json',recovery=row) for row in requests.get('editions',[])]
                report['historical_recovery_pending']=any(row.get('status')!='verified' for row in report['historical_recoveries'])
                if not report['historical_recovery_pending']:
                    requests.update(enabled=False,completed_at_utc=datetime.now(timezone.utc).isoformat())
                    pending=queue.with_suffix('.pending');pending.write_text(json.dumps(requests,indent=2)+'\n',encoding='utf-8');pending.replace(queue)
    status='retry_sync_stage' if report.get('historical_recovery_pending') else 'completed' if report.get('status')=='verified' else report.get('status','failed')
    result={'kind':'countryrisks-weekly-v2' if a.weekly else 'countryrisks-daily-v2','status':status,
      'ai_required':False,'source_receipt':report,'source_owner':'existing-shared-windows-tick','raw_collection_added':False}
    a.result.parent.mkdir(parents=True,exist_ok=True);pending=a.result.with_suffix('.pending');pending.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');pending.replace(a.result)
    print(json.dumps({'status':result['status'],'ai_required':False}))


if __name__=='__main__':main()
