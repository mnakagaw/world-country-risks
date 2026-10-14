"""Project only original-body-verified functional reviews; never infer from traffic."""
from datetime import datetime
from pathlib import Path
import json


def export(root,cutoff,output):
    cutoff=datetime.fromisoformat(cutoff.replace('Z','+00:00'));records=[]
    for path in sorted((Path(root)/'reviews').glob('*.json')):
        review=json.loads(path.read_bytes())
        if review.get('status')!='verified_event_candidate' or not review.get('confirmed_impact'):continue
        when=datetime.fromisoformat(review['checked_at'].replace('Z','+00:00'))
        if when>=cutoff:continue
        event=review['confirmed_impact'];evidence=review.get('evidence',[])
        if not evidence:continue
        records.append({'schema':'verified-impact-v2','status':'verified','event_id':review['event_id'],
          'country':review['event_country'],'impact':event['impact'],'scope':event['scope'],
          'period':event.get('period'),'recovery':event.get('recovery'),
          'verification':{'verified_at':review['checked_at'],'body_sha256':evidence[0]['body_sha256']},'evidence':evidence})
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(records,ensure_ascii=False)+'\n',encoding='utf-8');return len(records)
