from pathlib import Path
from hashlib import sha256
import json,os
from local_cycle import ROOT


def save(policy,source):
    base=ROOT/'public/data/history/weekly_5y';raw=(base/'index.json').read_bytes();index=json.loads(raw)
    folder=Path(policy['handoff_root'])/'weekly'/index['epoch'];folder.mkdir(parents=True,exist_ok=True)
    inputs={'source.private.json':Path(source).read_bytes(),'index.json':raw}
    for record in index['countries']:inputs[record['iso2']+'.json']=(base/record['path']).read_bytes()
    entries={}
    for name,content in inputs.items():
        file=folder/name;digest=sha256(content).hexdigest()
        if file.exists() and sha256(file.read_bytes()).hexdigest()!=digest:raise ValueError('Immutable NAS weekly conflict')
        if not file.exists():
            pending=file.with_suffix('.pending');pending.write_bytes(content);os.replace(pending,file)
        if sha256(file.read_bytes()).hexdigest()!=digest:raise ValueError('NAS weekly SHA mismatch')
        entries[name]={'sha256':digest,'bytes':len(content)}
    manifest={'epoch':index['epoch'],'week':index['latest_completed_week'],'files':entries,'restore_enabled':False}
    (folder/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    return {'status':'verified','week':index['latest_completed_week'],'epoch':index['epoch'],'files':len(entries)}
