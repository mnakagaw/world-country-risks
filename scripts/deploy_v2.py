"""Explicit v2 release: TLS, content hashes, immutable payloads, latest and HTML last."""
from datetime import datetime,timezone
from ftplib import FTP_TLS,error_perm
from hashlib import sha256
from io import BytesIO
from pathlib import Path,PurePosixPath
from urllib.request import Request,urlopen
import argparse,json,ssl,re

ROOT=Path(__file__).resolve().parents[1]
REMOTE='/domains/countryrisks.org/public_html/world'
PUBLIC='https://world.countryrisks.org'


def connect(credentials):
    rows=[x.strip() for x in Path(credentials).read_text(encoding='utf-8-sig').splitlines() if x.strip()]
    if len(rows)<6 or rows[0]!='サーバー' or rows[2]!='アカウント' or rows[4]!='パスワード' or rows[1]!='v2007.coreserver.jp':
        raise ValueError('Unexpected existing credential format or host')
    ftp=FTP_TLS(context=ssl.create_default_context(),timeout=25);ftp.connect(rows[1],21);ftp.login(rows[3],rows[5]);ftp.prot_p();ftp.cwd(REMOTE)
    if ftp.pwd().rstrip('/')!=REMOTE:raise ValueError('Unexpected deployment root')
    return ftp


def read(ftp,name):
    b=BytesIO()
    try:ftp.retrbinary('RETR '+REMOTE+'/'+name,b.write);return b.getvalue()
    except error_perm as error:
        if str(error).startswith('550'):return None
        raise


def deploy(credentials,weekly=False,ui_only=False,dist=None,release_root=None):
    dist=Path(dist or ROOT/'dist')
    files=[]
    for base in ['assets','country-interest','data/v2']:
        if (dist/base).is_dir():files.extend(p for p in (dist/base).rglob('*') if p.is_file())
    files+=[dist/name for name in ['country-interest.js','country-interest.css','country-interest-cards.js','country-interest-cards.css','country-interest-alerts.js','country-interest-alerts.css','index.html'] if (dist/name).is_file()]
    for name in ['geo/countries.overview.geojson','geo/countries.overview.metadata.json']:
        if (dist/name).is_file():files.append(dist/name)
    if weekly:
        index_file=dist/'data/history/weekly_5y/index.json'
        index=json.loads(index_file.read_bytes())
        for record in index['countries']:
            relative=PurePosixPath(record['path'])
            if relative.is_absolute() or '..' in relative.parts or relative.parts[:2]!=('releases',index['epoch']):
                raise ValueError('Weekly payload outside selected immutable epoch')
            files.append(dist/'data/history/weekly_5y'/relative)
        files.append(index_file)
    if not files or not (dist/'data/v2/latest.json').is_file():raise ValueError('Validated v2 build required')
    names={p.relative_to(dist).as_posix():p for p in files}
    # Freeze validated bytes before any transfer. A parallel build must not
    # combine an old payload list with newer manifest/root HTML references.
    payloads={name:file.read_bytes() for name,file in names.items()}
    dates=json.loads(payloads['data/v2/manifest.json'])
    for date,record in dates.items():
        name='data/v2/'+record['path']
        if name not in payloads or sha256(payloads[name]).hexdigest()!=record['sha256'] or json.loads(payloads[name])['date']!=date:
            raise ValueError('Daily manifest is not bound to complete payloads')
    html=payloads['index.html'].decode('utf-8')
    for reference in re.findall(r'(?:src|href)=["\']\./(assets/[^"\']+)["\']',html):
        if reference not in payloads:raise ValueError('HTML asset missing from frozen release')
    if weekly:
        index=json.loads(payloads['data/history/weekly_5y/index.json'])
        for record in index['countries']:
            name='data/history/weekly_5y/'+record['path']
            value=json.loads(payloads[name])
            if sha256(payloads[name]).hexdigest()!=record['sha256'] or value['epoch']!=index['epoch'] or value['latest_completed_week']!=index['latest_completed_week']:
                raise ValueError('Weekly epoch/payload mismatch')
    if ui_only:
        if weekly:raise ValueError('UI-only cannot replace the weekly index')
        payloads={name:raw for name,raw in payloads.items() if not name.startswith('data/')}
        names={name:file for name,file in names.items() if name in payloads}
    deferred=['data/history/weekly_5y/index.json','data/v2/status.json','data/v2/latest.json','data/v2/manifest.json','index.html']
    ordered=sorted(n for n in names if n not in deferred)+[n for n in deferred if n in names]
    folder=Path(release_root or ROOT/'.local/releases')/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ');folder.mkdir(parents=True,exist_ok=False)
    receipt={'schema':'country-risk-publication-v2','files':{},'status':'running','latest_last':True,'ui_only':ui_only}
    ftp=connect(credentials);known=set()
    try:
        for i,name in enumerate(ordered):
            if i and i%20==0:ftp.quit();ftp=connect(credentials)
            raw=payloads[name];digest=sha256(raw).hexdigest();old=read(ftp,name)
            same=old is not None and sha256(old).hexdigest()==digest
            if not same:
                if old is not None:
                    backup=folder/'before'/name;backup.parent.mkdir(parents=True,exist_ok=True);backup.write_bytes(old)
                parent=PurePosixPath(name).parent
                for j in range(1,len(parent.parts)+1):
                    directory='/'.join(parent.parts[:j])
                    if directory in known:continue
                    try:ftp.mkd(REMOTE+'/'+directory)
                    except error_perm:ftp.cwd(REMOTE+'/'+directory)
                    known.add(directory)
                pending=REMOTE+'/'+name+'.pending'
                ftp.storbinary('STOR '+pending,BytesIO(raw))
                b=BytesIO();ftp.retrbinary('RETR '+pending,b.write)
                if sha256(b.getvalue()).hexdigest()!=digest:raise ValueError('FTPS pending SHA mismatch: '+name)
                ftp.rename(pending,REMOTE+'/'+name)
            # All payloads and every pointer are independently read by public HTTP.
            with urlopen(Request(PUBLIC+'/'+name,headers={'Cache-Control':'no-cache'}),timeout=25) as response:found=response.read()
            if sha256(found).hexdigest()!=digest:raise ValueError('Public SHA mismatch: '+name)
            receipt['files'][name]={'sha256':digest,'bytes':len(raw),'action':'reused' if same else 'uploaded','http_verified':True}
            (folder/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
        receipt.update(status='verified',completed_at=datetime.now(timezone.utc).isoformat())
        (folder/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'status':'verified','files':len(receipt['files']),'receipt':str(folder/'receipt.json')}))
        return receipt
    finally:ftp.quit()


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--credentials',type=Path,required=True);p.add_argument('--weekly',action='store_true');p.add_argument('--ui-only',action='store_true');p.add_argument('--dist',type=Path);p.add_argument('--release-root',type=Path);a=p.parse_args();deploy(a.credentials,weekly=a.weekly,ui_only=a.ui_only,dist=a.dist,release_root=a.release_root)
