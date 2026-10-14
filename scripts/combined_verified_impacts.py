"""Bind accepted producer facts and existing SW reviews in a WCR-owned namespace."""
from pathlib import Path
from hashlib import sha256
import json
from execbrief_verified_impacts import export as accepted
from shared_verified_impacts import export as reviewed

def export(policy,cutoff,output,namespace):
    output=Path(output);namespace=Path(namespace)
    report=accepted(policy['execbrief_root'],cutoff,output,namespace);records=report['records']
    sw=output.with_name('sw-reviewed-impacts.json');reviewed(policy['interest_root'],cutoff,sw)
    for record in json.loads(sw.read_bytes()):
        for evidence in record['evidence']:
            capture_path=Path('captures')/(evidence['capture_id']+'.json')
            capture_raw=(Path(policy['interest_root'])/capture_path).read_bytes();capture=json.loads(capture_raw)
            name=capture['body_file']
            if Path(name).name!=name:raise ValueError('Body path invalid')
            raw=(Path(policy['interest_root'])/'verified-bodies'/name).read_bytes()
            if sha256(raw).hexdigest()!=capture['body_sha256']:raise ValueError('Source body SHA mismatch')
            (namespace/'captures').mkdir(parents=True,exist_ok=True);(namespace/'verified-bodies').mkdir(exist_ok=True)
            (namespace/capture_path).write_bytes(capture_raw);(namespace/'verified-bodies'/name).write_bytes(raw)
        records.append(record)
    output.write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    from semantic_article_bridge import export as annotate
    annotate(policy,records,output.with_name('article-classification-context.json'),namespace,cutoff)
    return {'records':len(records),'accepted_status':report['status']}
