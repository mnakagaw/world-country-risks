"""Read existing ExecBrief immutable normalized artifacts; never collect or open its live DB.

Each normalized file is bound to the bulk/index manifests and checked by SHA256.
Missing quarter slots remain missing. All raw and audit DTOs are private.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone
from hashlib import sha256
from pathlib import Path
import argparse
import json
import re
import duckdb
from archive_catalog import catalog

ROOT=Path(__file__).resolve().parents[1]


def sha(path):
    h=sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    return h.hexdigest()


def artifacts(archive,start,end,columns=None,candidates=None,verified=None):
    candidates = candidates if candidates is not None else catalog(archive,start,end)[0]
    verified = verified if verified is not None else {}
    tasks=[];clock=start
    while clock<end:
        tasks.append(clock);clock+=timedelta(minutes=15)
    def load(clock):
        options=candidates.get(clock.isoformat(),[])
        for option in options:
            try:
                normalized=Path(option['path'])
                signature=(str(normalized),option['sha256'])
                if signature not in verified:
                    from archive_catalog import read_bytes
                    content=read_bytes(normalized)
                    if sha256(content).hexdigest()!=option['sha256']:raise ValueError('Normalized SHA mismatch')
                    cache=ROOT/'work/archive-objects';cache.mkdir(parents=True,exist_ok=True)
                    copy=cache/(option['sha256']+'.parquet')
                    if not copy.exists():copy.write_bytes(content)
                    if sha(copy)!=option['sha256']:raise ValueError('Private read cache SHA mismatch')
                    verified[signature]=str(copy)
                return {**option,'status':'available','read_path':verified[signature]}
            except (OSError,ValueError):pass
        # Exact-quarter diagnosis is retained when the historical catalog has
        # no verified candidate. No failure is converted into an observed zero.
        folder=archive/'manifests'/clock.strftime('%Y-%m-%d')/(clock.strftime('%Y%m%dT%H%M%SZ')+'_'+(clock+timedelta(minutes=15)).strftime('%Y%m%dT%H%M%SZ'))
        source=folder/'gdelt-bulk-manifest.json'
        try:
            raw=source.read_bytes();bulk=json.loads(raw)
            index_path=archive/'indexes'/('index-v2-'+bulk['dataset_hash'][:16]+'.json')
            index_raw=index_path.read_bytes();index=json.loads(index_raw)
            if index['bulk_manifest_sha256']!=sha256(raw).hexdigest():raise ValueError('Source epoch changed')
            fid=clock.strftime('%Y%m%d%H%M%S')+'.export'
            item=next(i for i in index['files'] if i['source_file_id']==fid and i['status']=='available')
            normalized=Path(item['parquet_path']).resolve()
            if not normalized.is_relative_to((archive/'normalized').resolve()):raise ValueError('Unexpected normalized path')
            if sha(normalized)!=item['parquet_sha256']:raise ValueError('Normalized artifact changed')
            if source.read_bytes()!=raw or index_path.read_bytes()!=index_raw:raise ValueError('Manifest epoch changed')
            return {'slot':clock.isoformat(),'status':'available','path':str(normalized),
              'sha256':item['parquet_sha256'],'bulk_manifest_sha256':sha256(raw).hexdigest(),
              'index_sha256':sha256(index_raw).hexdigest(),'rows_rejected':item.get('rows_rejected',0)}
        except (OSError,ValueError,KeyError,StopIteration) as error:
            return {'slot':clock.isoformat(),'status':'missing','error_type':type(error).__name__,
              'reason':'candidate_hash_or_read_failure' if options else
                  'bulk_manifest_missing' if not source.exists() else
                  'index_missing' if 'index_path' in locals() and not index_path.exists() else
                  'normalized_missing' if 'normalized' in locals() and not normalized.exists() else 'index_or_schema_unavailable'}
    with ThreadPoolExecutor(max_workers=4) as pool:return list(pool.map(load,tasks))


def condition(definition):
    clauses=[]
    for field,key in [('EventRootCode','rootCodes'),('EventCode','eventCodes')]:
        vals=definition.get(key,[])
        if any(not re.fullmatch(r'\d+',v) for v in vals):raise ValueError('Invalid CAMEO code')
        if vals:clauses.append('"'+field+'" IN ('+','.join("'"+v+"'" for v in vals)+')')
    for prefix in definition.get('eventCodePrefixes',[]):
        if not re.fullmatch(r'\d+',prefix):raise ValueError('Invalid prefix')
        clauses.append('starts_with("EventCode",\''+prefix+'\')')
    return '('+' OR '.join(clauses)+')' if clauses else 'FALSE'


def export(archive,cutoff,output,execbrief_root=None,hours=48,*,candidates=None,verified=None,quiet=False):
    cutoff=cutoff.astimezone(timezone.utc)
    if cutoff.minute%15 or cutoff.second or cutoff.microsecond:raise ValueError('Cutoff must close a 15-minute boundary')
    if cutoff>datetime.now(timezone.utc):raise ValueError('Future cutoff')
    if hours not in (24,48,168):raise ValueError('Explicit 24h,48h or7d unit required')
    start=cutoff-timedelta(hours=hours)
    rows=artifacts(archive,start,cutoff,candidates=candidates,verified=verified);available=[r for r in rows if r['status']=='available']
    if not available:raise ValueError('No verified source artifacts; preserve previous snapshot')
    definitions=json.loads((ROOT/'config/r_definitions.json').read_text())
    db=duckdb.connect(':memory:');db.execute("SET memory_limit='512MB'");db.execute('SET threads=2')
    try:
        db.from_parquet([r.get('read_path',r['path']) for r in available]).create_view('raw')
        sports=r'(\/|\.|^)(sport|sports|football|soccer|nba|nfl|mlb|nhl|f1|ufc)(\/|\.|$)|espn\.|goal\.com|bleacherreport\.|skysports\.|marca\.com|sports\.yahoo\.'
        # DATEADDED is discovery time. SQLDATE is retained independently; old event
        # dates are not thrown away or mislabeled as current incident dates.
        db.execute('''CREATE TEMP TABLE population AS SELECT * EXCLUDE(n) FROM (
          SELECT *,row_number() OVER(PARTITION BY GlobalEventID ORDER BY DATEADDED DESC,source_file_id) n
          FROM raw WHERE DATEADDED >= ? AND DATEADDED < ? AND ActionGeo_CountryCode<>''
          AND NOT regexp_matches(lower(coalesce(SOURCEURL,'')),?)) WHERE n=1''',
          [start.strftime('%Y%m%d%H%M%S'),cutoff.strftime('%Y%m%d%H%M%S'),sports])
        counts=','.join('count(*) FILTER(WHERE '+condition(definitions[r])+') AS '+r for r in ('R1','R2','R3','R4'))
        query='''SELECT ActionGeo_CountryCode AS code,count(*) AS event_count,
          avg(try_cast(AvgTone AS DOUBLE)) AS avg_tone,
          sum(try_cast(AvgTone AS DOUBLE)) AS tone_sum,count(try_cast(AvgTone AS DOUBLE)) AS tone_count,
          count(*) FILTER(WHERE nullif(Actor1Geo_CountryCode,'')=ActionGeo_CountryCode OR nullif(Actor2Geo_CountryCode,'')=ActionGeo_CountryCode) AS domestic_event_count,
          count(*) FILTER(WHERE nullif(Actor1Geo_CountryCode,'') IS NOT NULL OR nullif(Actor2Geo_CountryCode,'') IS NOT NULL) AS denom_actor_geo,'''+counts+''' FROM population GROUP BY ActionGeo_CountryCode'''
        cursor=db.execute(query);keys=[d[0] for d in cursor.description]
        countries={}
        for values in cursor.fetchall():
            r=dict(zip(keys,values));countries[r.pop('code')]={**r,
              'r1_security':r.pop('R1'),'r2_living_count':r.pop('R2'),
              'r3_governance':r.pop('R3'),'r4_fiscal_count':r.pop('R4'),
              'domestic_ratio':r['domestic_event_count']/r['denom_actor_geo'] if r['denom_actor_geo']>=50 else None}
        samples={}
        for code,hours_seen,domains,url_hashes,first,last in db.execute('''SELECT ActionGeo_CountryCode,
          list(DISTINCT substr(DATEADDED,1,10)),
          list(DISTINCT lower(regexp_extract(SOURCEURL,'^https?://([^/:?#]+)',1))) FILTER(WHERE SOURCEURL LIKE 'http%'),
          list(DISTINCT sha256(SOURCEURL)) FILTER(WHERE SOURCEURL LIKE 'http%'),min(DATEADDED),max(DATEADDED)
          FROM population GROUP BY ActionGeo_CountryCode''').fetchall():
            samples[code]={'hours':hours_seen,'domains':[v for v in domains or [] if v],'url_hashes':url_hashes or [],'first_added':first,'last_added':last}
        quarter_counts={}
        cursor=db.execute('SELECT source_file_id,ActionGeo_CountryCode AS code,count(*) AS event_count,'+counts+' FROM population GROUP BY source_file_id,ActionGeo_CountryCode')
        for fid,code,total,r1,r2,r3,r4 in cursor.fetchall():
            slot=datetime.strptime(fid[:14],'%Y%m%d%H%M%S').replace(tzinfo=timezone.utc)
            offset=int((slot-start).total_seconds()/900)
            quarter_counts.setdefault(str(offset),{})[code]={'event_count':total,'r1_security':r1,'r2_living_count':r2,'r3_governance':r3,'r4_fiscal_count':r4}
        urls={}
        query='''SELECT ActionGeo_CountryCode,SOURCEURL,SQLDATE,DATEADDED,GlobalEventID,ingested_at_utc FROM population
          WHERE SOURCEURL LIKE 'http%' QUALIFY row_number() OVER(PARTITION BY ActionGeo_CountryCode ORDER BY try_cast(NumMentions AS BIGINT) DESC,GlobalEventID)<=5'''
        for code,url,event_date,added,eid,ingested in db.execute(query).fetchall():
            urls.setdefault(code,[]).append({'url':url,'event_date':event_date,'gdelt_added_at':added,
              'article_published_at':None,'normalized_ingested_at':str(ingested),'gdelt_record_id':eid,'verification_status':'discovery_metadata_only'})
        rejected=sum(r['rows_rejected'] for r in available)
        result={'schema':'country-risk-observations-v2','producer':'execbrief-immutable-gdelt-export',
          'edition_date':(cutoff+timedelta(hours=9)).date().isoformat(),
          'cutoff_utc':cutoff.isoformat().replace('+00:00','Z'),
          'window':{'start_utc':start.isoformat().replace('+00:00','Z'),'end_utc':cutoff.isoformat().replace('+00:00','Z'),'semantics':'[start,end)','time_field':'DATEADDED'},
          'source_status':'complete' if len(available)==len(rows) and rejected==0 else 'partial',
          'coverage':{'expected_slots':len(rows),'available_slots':len(available),'missing_slots':[r['slot'] for r in rows if r['status']=='missing'],'rejected_rows':rejected,'source_series':'English export'},
          'code_system':'FIPS 10-4','countries':countries,'samples':samples,'quarter_counts':quarter_counts,'source_urls':urls,
          'population':'Unique GDELT Event table IDs added within window; sports URL filter v2; not independent incidents',
          'source_manifest_sha256':sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest(),
          'input_artifacts':[{key:value for key,value in row.items() if key!='read_path'} for row in rows]}
        output.parent.mkdir(parents=True,exist_ok=True)
        pending=output.with_suffix('.tmp');pending.write_text(json.dumps(result,ensure_ascii=False)+'\n',encoding='utf-8');pending.replace(output)
        if not quiet:print(json.dumps({'status':result['source_status'],'countries':len(countries),'available_slots':len(available),'expected_slots':len(rows),'output':str(output)},ensure_ascii=False))
        return result
    finally:db.close()


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--archive',type=Path,required=True);p.add_argument('--cutoff',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--execbrief-root',type=Path);p.add_argument('--hours',type=int,default=48)
    a=p.parse_args();export(a.archive,datetime.fromisoformat(a.cutoff.replace('Z','+00:00')),a.output,a.execbrief_root,a.hours)
