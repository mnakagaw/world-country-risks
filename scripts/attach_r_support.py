"""Append domain-support evidence to a fixed, already verified source epoch.

Original counts/windows/slots are retained, never refreshed from a live queue.
"""
from pathlib import Path
from hashlib import sha256
import argparse,json,duckdb,sys
from export_shared_gdelt import condition,ROOT
from archive_catalog import read_bytes

def attach(input_path,output):
    original=Path(input_path).read_bytes();data=json.loads(original);definitions=json.loads((ROOT/'config/r_definitions.json').read_bytes());types=['R1','R2','R3','R4']
    paths=[];cache=ROOT/'work/support-objects';cache.mkdir(parents=True,exist_ok=True)
    for record in data['input_artifacts']:
        if record['status']!='available':continue
        raw=read_bytes(Path(record['path']));assert sha256(raw).hexdigest()==record['sha256']
        file=cache/(record['sha256']+'.parquet');file.write_bytes(raw);paths.append(str(file))
    db=duckdb.connect(':memory:');db.execute("SET memory_limit='512MB'");db.execute('SET threads=2')
    db.from_parquet(paths).create_view('raw')
    sports=r'(\/|\.|^)(sport|sports|football|soccer|nba|nfl|mlb|nhl|f1|ufc)(\/|\.|$)|espn\.|goal\.com|bleacherreport\.|skysports\.|marca\.com|sports\.yahoo\.'
    start=data['window']['start_utc'].replace('-','').replace(':','').replace('T','').replace('Z','');end=data['window']['end_utc'].replace('-','').replace(':','').replace('T','').replace('Z','')
    db.execute('''CREATE TEMP TABLE population AS SELECT * EXCLUDE(n) FROM (SELECT *,row_number() OVER(PARTITION BY GlobalEventID ORDER BY DATEADDED DESC,source_file_id) n FROM raw WHERE DATEADDED>=? AND DATEADDED<? AND ActionGeo_CountryCode<>'' AND NOT regexp_matches(lower(coalesce(SOURCEURL,'')),?)) WHERE n=1''',[start,end,sports])
    db.execute('CREATE TEMP TABLE tagged AS SELECT *, '+','.join(condition(definitions[t])+' AS '+t for t in types)+' FROM population')
    from r_support import extract_support
    producer=json.loads((ROOT/'.local/controller.json').read_bytes())['execbrief_root']
    support,support_audit=extract_support(db,definitions,condition,producer)
    overlaps=support_audit['multi_label_records_excluded_from_bundle_support']
    # Verify row identity/population, not just broad totals.
    original_counts={k:v['event_count'] for k,v in data['countries'].items()}
    actual=dict(db.execute('SELECT ActionGeo_CountryCode,count(*) FROM population GROUP BY ActionGeo_CountryCode').fetchall());assert actual==original_counts
    data['r_support']=support;data['support_evidence']={'schema':'r-domain-support-v1','original_input_sha256':sha256(original).hexdigest(),'definition_sha256':sha256((ROOT/'config/r_definitions.json').read_bytes()).hexdigest(),**support_audit,'counts_windows_artifacts_unchanged':True,'meaning':'Exclusive CAMEO category and canonical article group support; not independent incidents or measured resident sentiment'}
    target=Path(output);target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(data,ensure_ascii=False)+'\n',encoding='utf-8');db.close()
    print(json.dumps({'status':'fixed_epoch_evidence_attached','overlap_records':overlaps,'countries':len(support),'output':str(target)}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);args=p.parse_args();attach(args.input,args.output)
