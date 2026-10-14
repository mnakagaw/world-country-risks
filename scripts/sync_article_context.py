"""Reuse sealed ExecBrief interpretations; no fresh body fetch or new R model."""
from pathlib import Path
from hashlib import sha256
import json
from execbrief_sync import moment
from r_support import canonicalizer

def export(policy,bundle,output):
    bundle=Path(bundle);meta=json.loads((bundle/'manifest.json').read_bytes());binding=meta['binding'];cutoff=moment(binding['cutoff_utc']);editorial=json.loads((bundle/'editorial.json').read_bytes());canonical,canonical_sha=canonicalizer(policy['execbrief_root']);articles=[];excluded=[]
    version=sha256(Path(__file__).read_bytes()).hexdigest()
    for story in editorial.get('stories',[]):
        published=story.get('published_at_utc') or story.get('publication_datetime_utc')
        if published and moment(published)>cutoff:excluded.append(story['id']);continue
        url=canonical(story['url']);article_id='article-'+sha256(url.encode()).hexdigest()[:20]
        claims=(story.get('r_claims') if story.get('r_claims_verified') is True else None) or [{'r':None,'subcategory':'not_supplied','direction':'unknown','reason':'Accepted ExecBrief article interpretation; a verified R/subcategory/direction mapping is not supplied by this edition.'}]
        for c in claims:
            if c.get('r') not in [None,'R1','R2','R3','R4'] or c.get('direction') not in ['degradation','improvement','related','unknown']:raise ValueError('Invalid supplied R interpretation')
        for country in story.get('country_codes',[])[:10]:
            if len(country)!=2:continue
            articles.append({'stable_article_id':article_id,'canonical_url':url,'event_id':story['id'],'country_locator':country,'country_locator_basis':'Accepted article country tags; actor/place/domestic reception roles not independently established here','domestic_reception_evidence':None,'body_verification':'accepted_daily_article_interpretation; not an independent original-body review','classification_confidence':'R_unknown_unless_supplied_by_accepted_edition','r_claims':[{**c,'scope':'Accepted article statement; no country color promotion'} for c in claims],'body_sha256':None,'accepted_source_sha256':binding['accepted_editorial_sha256'],'policy_sha256':version,'canonicalization_policy_sha256':canonical_sha,'metadata_sha256':sha256(json.dumps(story,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),'source_publication_day':story.get('source_date'),'reviewed_at':binding['information_confirmed_at_utc'],'cutoff_utc':binding['cutoff_utc'],'translations':story.get('summary'),'counts_role':'Context only, never CAMEO Event numerator or baseline'})
    # Keep a bounded display subset; the complete accepted source is retained privately.
    selected=[];counts={};titles={s['id']:s.get('title_localized') for s in editorial.get('stories',[])}
    for row in articles:
        row['title_localized']=titles.get(row['event_id'])
        code=row['country_locator'];counts[code]=counts.get(code,0)+1
        if counts[code]<=3:selected.append(row)
    result={'schema':'r-article-evidence-v1','policy_sha256':version,'upstream_binding':binding,'articles':selected,'accepted_articles_total':len(editorial.get('stories',[])),'display_subset':True,'explicit_post_cutoff_articles_excluded':excluded,'new_ai_calls':0,'new_collection':False,'source_ledger':[{'source':'GDELT English Events','active':True,'role':'Fixed48h DATEADDED; current raw Event SHA matched to the accepted upstream source selection; not article counts or resident opinion'},{'source':'ExecBrief accepted daily article interpretations','active':True,'role':'Same edition/cutoff/publication and acceptance SHA; bounded context subset, no reclassification'},{'source':'Verified R/subcategory/direction interpretation','active':any(s.get('r_claims_verified') is True and s.get('r_claims') for s in editorial.get('stories',[])),'role':'Use supplied accepted fields only; generic desk/topic classification does not supply R semantics'},{'source':'Google Trending Now daily03:00 seal','active':True,'role':'Cutoff-bound search interest; external country-interest page is a separate live view; no R bundle'},{'source':'Resident SNS post/context corpus','active':False,'role':'Not connected or validated; no measured resident sentiment'}]}
    seal=json.loads((bundle/'search-interest-seal.json').read_bytes())
    result['search_interest_daily']={'snapshot_id':seal['snapshot_id'],'window':seal['window'],'metric':seal.get('metric'),'source_sha256':binding['search_interest_seal_sha256'],'countries':seal.get('countries',{}),'role':'Search-interest context only; never a risk bundle or resident-opinion measurement'}
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');return result
