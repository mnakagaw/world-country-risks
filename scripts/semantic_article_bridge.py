"""Small accepted-body annotation bridge, cached by article/body/policy hashes.
No all-GKG classifier or Event/article denominator mixing.
"""
from pathlib import Path
from hashlib import sha256
import json
from r_support import canonicalizer

ROOT=Path(__file__).resolve().parents[1]
POLICY={'version':'r-article-evidence-v1','unit':'Reviewed accepted original article, not GDELT Event or all GKG','direction':'Claim-specific degradation/improvement/related/unknown; no country color promotion'}
def export(policy,records,output,verification_root=None,cutoff=None):
    canonical,canonical_sha=canonicalizer(policy['execbrief_root']);policy_sha=sha256(json.dumps(POLICY,sort_keys=True).encode()+Path(__file__).read_bytes()).hexdigest();rows=[]
    # Curated acceptance examples, not rules applied to unseen articles.
    claims={'idcf-2026-10:JP':[('R2','digital_service_access','degradation','Some cloud virtual servers stopped/could not restart; four zones/495 organizations, not population coverage'),('R1','protection_related_topic','related','Cybercrime topic alone does not establish resident fear or government protection failure'),('R3','government_appraisal','unknown','Municipal customers affected does not establish administrative failure or resident distrust')],
      'nissui-logistics-2026-10:JP':[('R2','logistics_service_access','degradation','Goods receiving and dispatch unavailable at named provider'),('R1','cybercrime_related_topic','related','Suspected intrusion is distinct from confirmed public-safety harm or resident fear')],
      'ahold-netherlands-2026-10-12:NL':[('R2','online_order_delivery_access','degradation','Online ordering, delivery and customer service unavailable in the statement'),('R2','stores_payments_access','improvement','Stores/tills operate and shelf-price system restored; only these components'),('R4','public_finance_payment_capacity','unknown','Retail tills are not government tax/payment capacity'),('R3','government_trust','unknown','No resident/government appraisal evidence in operator statements')]}
    for event in records:
        for e in event['evidence']:
            url=canonical(e['url']);article_id='article-'+sha256(url.encode()).hexdigest()[:20];body=e['body_sha256']
            metadata_sha=sha256(json.dumps({k:event.get(k) for k in ['event_id','country','scope','impact_localized','period']},sort_keys=True).encode()).hexdigest();key=sha256((article_id+body+policy_sha+metadata_sha).encode()).hexdigest()
            namespace=Path(verification_root) if verification_root else ROOT/'.local/accepted-impacts/verification';capture=json.loads((namespace/'captures'/(e['capture_id']+'.json')).read_bytes());raw=(namespace/'verified-bodies'/capture['body_file']).read_bytes();assert sha256(raw).hexdigest()==body
            accepted_example=event['verification'].get('accepted_artifact_sha256')=='7ae3e13a77089a0ff2212235c682e3723cf8f4695b5b3c996f175ce3b948c65e'
            selected=claims.get(event['event_id'],[]) if accepted_example else []
            if accepted_example and '20261009001' in url:selected=[('R2','digital_service_restoration_plan','related','Backup/migration/recovery planning is not evidence of completed recovery')]
            if accepted_example and 'aholddelhaize.com' in url:selected=[('R2','operator_service_incident','degradation','Corporate incident statement; later component restoration must use the updated AH original')]
            if not selected:selected=[(None,'unassigned','unknown','No accepted R/subcategory mapping for this body/review version')]
            row={'stable_article_id':article_id,'canonical_url':url,'event_id':event['event_id'],'country_locator':event['country'],'domestic_reception_evidence':None,'body_verification':'body_bound_accepted_original','classification_confidence':'claim_supported_scope_only; public_reaction_unknown',
                 'prior_coarse_mapping':event.get('assessment',{}).get('r_type'),'r_claims':[{'r':r,'subcategory':sub,'direction':direction,'reason':reason,'scope':event['scope'],'original_excerpt_anchor':e['excerpt_original']} for r,sub,direction,reason in selected],
                 'body_sha256':body,'accepted_source_sha256':event['verification'].get('accepted_artifact_sha256'),'policy_sha256':policy_sha,'metadata_sha256':metadata_sha,'canonicalization_policy_sha256':canonical_sha,'reviewed_at':e['checked_at'],'source_publication_day':(event.get('period') or {}).get('publication_date'),'cutoff_utc':cutoff or '2026-10-13T20:00:00Z','observation_instant':None,'translations':event.get('impact_localized'),
                 'shared_gkg_membership':'not_asserted; accepted native example subset only','counts_role':'Annotation/context only; do not add to CAMEO Event numerator or baseline','cache_key':key}
            cache=ROOT/'.local/r-article-classification-cache'/ (key+'.json');cache.parent.mkdir(parents=True,exist_ok=True)
            classification={k:row[k] for k in ['stable_article_id','r_claims','body_sha256','policy_sha256','metadata_sha256']}
            raw=(json.dumps(classification,ensure_ascii=False,indent=2)+'\n').encode()
            if cache.exists():assert cache.read_bytes()==raw
            else:cache.write_bytes(raw)
            rows.append(row)
    result={'schema':'r-article-evidence-v1','policy':POLICY,'policy_sha256':policy_sha,'articles':rows,'classification_precision_rate':None,'forecast_accuracy':None,'body_review_reused':True,'new_ai_calls':0,'new_collection':False,
      'qualitative_corrections':['Cyber topic alone is related R1, while verified service interruption supports R2','AH restoration and ongoing channel interruption are separate claims','Retail payments do not prove R4 public fiscal capacity','No operator statement establishes national resident distrust'],
      'source_ledger':[{'source':'GDELT English Events','role':'CAMEO reporting proxy; not articles/incidents/reader sentiment','active':True},{'source':'ExecBrief accepted native articles','role':'Body/context/direction interpretation, subset only','active':True},{'source':'Google Trending Now / selected shared producer','role':'Search interest, not SNS posts or sentiment','active':'external country-interest view; no R bundle'},{'source':'GetDayTrends country trend-topic scraper','role':'Legacy SNS topic/volume proxy; no post context','active':False,'reason':'Present in legacy generator, not invoked by v2 cycle'},{'source':'Resident SNS post/context corpus','active':False,'role':'Not connected/validated here; cannot claim population sentiment'}]}
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');return result
