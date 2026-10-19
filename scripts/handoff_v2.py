"""Small daily NAS delta after verified publication; never restore or start workers."""
from hashlib import sha256
from pathlib import Path
import json,os

ROOT=Path(__file__).resolve().parents[1]


def save(policy,source,publication,upstream_bundle=None,snapshot_path=None):
    nas=Path(policy['handoff_root']);nas.mkdir(parents=True,exist_ok=True)
    snapshot=Path(snapshot_path or ROOT/'public/data/v2/latest.json');latest=json.loads(snapshot.read_bytes())
    folder=nas/'daily'/latest['date']/latest['snapshot_id'];folder.mkdir(parents=True,exist_ok=True)
    files={
      'source.private.json':Path(source).read_bytes(),
      'snapshot.json':snapshot.read_bytes(),
      'history.private.json':(Path(policy.get('series_root',ROOT/'.local'))/'v2-history.json').read_bytes(),
      'publication.json':(json.dumps(publication,indent=2)+'\n').encode()}
    if upstream_bundle:
        for file in Path(upstream_bundle).iterdir():
            if file.is_file():files['upstream-'+file.name]=file.read_bytes()
    audit=ROOT/'.local/comparison-audits'/(latest['snapshot_id']+'.json')
    if audit.exists():files['comparison-audit.private.json']=audit.read_bytes()
    for name in ['baseline-reconstruction.json','baseline-sources/rebuild-receipt.json']:
        file=Path(policy.get('series_root',ROOT/'.local'))/name
        if file.exists():files[Path(name).name]=file.read_bytes()
    entries={}
    for name,raw in files.items():
        file=folder/name;digest=sha256(raw).hexdigest()
        if file.exists() and sha256(file.read_bytes()).hexdigest()!=digest:raise ValueError('Immutable NAS delta conflict')
        if not file.exists():
            pending=file.with_suffix('.pending');pending.write_bytes(raw);os.replace(pending,file)
        if sha256(file.read_bytes()).hexdigest()!=digest:raise ValueError('NAS SHA mismatch')
        entries[name]={'sha256':digest,'bytes':len(raw)}
    manifest={'snapshot_id':latest['snapshot_id'],'date':latest['date'],'files':entries,
      'restore_jobs_enabled':False,'live_source_db_restored':False}
    raw=(json.dumps(manifest,indent=2)+'\n').encode();(folder/'manifest.json').write_bytes(raw)
    if (folder/'manifest.json').read_bytes()!=raw:raise ValueError('NAS manifest readback mismatch')
    if snapshot_path is None:
        pending=nas/'daily-latest.pending';pending.write_text(json.dumps({'path':str(folder.relative_to(nas)),'snapshot_id':latest['snapshot_id']}),encoding='utf-8');os.replace(pending,nas/'daily-latest.json')
    return {'status':'verified','snapshot_id':latest['snapshot_id'],'files':len(entries)}
