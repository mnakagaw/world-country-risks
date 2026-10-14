"""Adapter for the existing shared Windows tick; no independent scheduler."""
from pathlib import Path
import argparse,json
from local_cycle import cycle,ROOT


def main():
    p=argparse.ArgumentParser();p.add_argument('--result',type=Path,required=True);p.add_argument('--weekly',action='store_true');a=p.parse_args()
    if a.weekly:
        from weekly_cycle import cycle as weekly
        report=weekly(ROOT/'.local/controller.json')
    else:report=cycle(ROOT/'.local/controller.json')
    result={'kind':'countryrisks-daily-v2','status':'completed' if report.get('status')=='verified' else report.get('status','failed'),
      'ai_required':False,'source_receipt':report,'source_owner':'existing-shared-windows-tick','raw_collection_added':False}
    a.result.parent.mkdir(parents=True,exist_ok=True);pending=a.result.with_suffix('.pending');pending.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');pending.replace(a.result)
    print(json.dumps({'status':result['status'],'ai_required':False}))


if __name__=='__main__':main()
