"""Consume accepted ExecBrief functional facts and retained native source bytes.

No fetch, re-assessment, shared-state write or article-count promotion here.
Older statements remain historical evidence and cannot create a current alert.
"""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timedelta,timezone
from urllib.parse import urlsplit
import json,re


def moment(value):return datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(timezone.utc)


def export(execbrief_root,cutoff,output,verification_root):
    root=Path(execbrief_root);cutoff=moment(cutoff);day=(cutoff+timedelta(hours=9)).date().isoformat()
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    def unavailable(status):
        output.write_text('[]\n',encoding='utf-8')
        return {'records':[],'status':status}
    accepted=root/'content/priority-themes/current.json'
    manifest=root/'.daily-work'/day/'D-priority-source-read-manifest-v1.json'
    if not accepted.exists() or not manifest.exists():return unavailable('accepted_native_sources_not_available')
    accepted_raw=accepted.read_bytes();theme=json.loads(accepted_raw)
    reviewed=moment(theme['reviewed_at_utc']);expires=moment(theme['valid_until_utc'])
    if not reviewed<cutoff<expires:return unavailable('accepted_review_outside_cutoff_or_expired')
    native_raw=manifest.read_bytes();native=json.loads(native_raw)
    candidates={item['url']:item for item in native.get('candidates',[])}
    namespace=Path(verification_root);(namespace/'captures').mkdir(parents=True,exist_ok=True);(namespace/'verified-bodies').mkdir(exist_ok=True)
    records=[];skipped=[]
    for item in theme.get('incidents',[]):
        if item.get('confirmation') not in ('operator_statement','authority_statement') or item.get('service_disruption') is not True:
            skipped.append({'id':item['id'],'reason':'not_a_primary_confirmed_service_disruption'});continue
        evidence=[]
        for url in item.get('source_urls',[]):
            candidate=candidates.get(url)
            if not candidate or candidate.get('http_status')!=200 or not candidate.get('body'):continue
            retrieved=moment(candidate['checked_at_utc'])
            if not retrieved<=reviewed<cutoff:continue
            source=Path(candidate['immutable_source']['path']).resolve()
            if not source.is_relative_to((root/'.daily-work').resolve()):raise ValueError('Native path outside producer')
            raw=source.read_bytes();digest=sha256(raw).hexdigest()
            if digest!=candidate['immutable_source']['sha256']:raise ValueError('Native source SHA mismatch')
            text=raw.decode('utf-8','replace');body=candidate['body']
            excerpt=None
            for width in [120,80,40,20]:
                for fragment in re.split(r'[\n。]',body):
                    part=fragment.strip()[:width]
                    if len(part)>=width and part in text:excerpt=part;break
                if excerpt:break
            if not excerpt:skipped.append({'id':item['id'],'reason':'native_excerpt_not_bound'});continue
            capture_id=sha256((url+'|'+digest+'|'+str(retrieved)).encode()).hexdigest()
            (namespace/'verified-bodies'/(digest+'.body')).write_bytes(raw)
            capture={'url':url,'body_file':digest+'.body','body_sha256':digest,'retrieved_at':retrieved.isoformat(),
                'producer':'execbrief-accepted-priority','accepted_artifact_sha256':sha256(accepted_raw).hexdigest(),
                'native_manifest_sha256':sha256(native_raw).hexdigest(),'native_source_sha256':digest}
            (namespace/'captures'/(capture_id+'.json')).write_text(json.dumps(capture)+'\n',encoding='utf-8')
            evidence.append({'url':url,'original_source_id':item['confirmation']+':'+item['id'],'capture_id':capture_id,
                'body_sha256':digest,'checked_at':reviewed.isoformat(),'body_reviewed':True,'excerpt_original':excerpt})
        if not evidence:continue
        publication=datetime.fromisoformat(item['publication_date']).date()
        current=publication>=(cutoff-timedelta(days=3)).date()
        major=item.get('major_impact') is True and (item.get('critical_function') in ['healthcare','administration','payments','major_logistics'] or item.get('affected_organizations',0)>=100)
        display=item.get('display',{})
        for country in item.get('country_codes',[]):
            if not re.fullmatch(r'[A-Z]{2}',country):raise ValueError('Accepted country identity required')
            record={'schema':'verified-impact-v2','status':'verified','event_id':item['id']+':'+country,'country':country,
                'impact':display.get('summary',{}).get('en') or item['text']['en'],
                'impact_localized':display.get('summary') or item['text'],
                'scope':display.get('organization') or item.get('publisher') or 'Source statement scope only',
                'period':{'publication_date':item['publication_date'],'reviewed_at_utc':reviewed.isoformat()},
                'recovery':{'status':'not_inferred','accepted_description':item['text']},
                'verification':{'verified_at':reviewed.isoformat(),'body_sha256':evidence[0]['body_sha256'],
                    'accepted_artifact_sha256':sha256(accepted_raw).hexdigest(),'native_manifest_sha256':sha256(native_raw).hexdigest()},
                'assessment':{'method':'accepted-functional-impact-v2','level':'orange' if major else 'yellow',
                    'current_at_cutoff':current,'basis':'primary_confirmed_major_scoped_service_disruption' if major else 'primary_confirmed_scoped_service_disruption',
                    'r_type':'R2' if item.get('critical_function')=='major_logistics' else 'R1',
                    'currency_rule':'Accepted before cutoff; valid review; source publication within3 days. Older statements remain historical, not current continuity.',
                    'valid_until_utc':theme['valid_until_utc']},'evidence':evidence}
            records.append(record)
    report={'records':records,'skipped':skipped,'status':'verified_from_accepted_native_sources',
        'accepted_artifact_sha256':sha256(accepted_raw).hexdigest(),'native_manifest_sha256':sha256(native_raw).hexdigest(),
        'source_time_cutoff':cutoff.isoformat(),'producer_written':False,'fetched':False}
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (output.parent/'execbrief-impact-receipt.json').write_text(json.dumps({key:value for key,value in report.items() if key!='records'},indent=2)+'\n',encoding='utf-8')
    return report
