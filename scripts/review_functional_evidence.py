"""Offline three-layer design review; does not write scoring/producer/runtime state."""
from pathlib import Path
from hashlib import sha256
import json

ROOT=Path(__file__).resolve().parents[1]
def review():
    inputs=ROOT/'.local/accepted-impacts';records=json.loads((inputs/'impacts.json').read_bytes())
    provenance=inputs/'verification/provenance';accepted=None
    for file in provenance.glob('*.json'):
        raw=file.read_bytes();assert sha256(raw).hexdigest()==file.stem
        value=json.loads(raw)
        if value.get('schema')=='priority-theme-v1':accepted=value
    if not accepted:raise ValueError('Retained accepted source required')
    source={r['id']:r for r in accepted['incidents']};examples=[]
    for event in records:
        original=source[event['event_id'].rsplit(':',1)[0]]
        for evidence in event['evidence']:
            capture=json.loads((inputs/'verification/captures'/(evidence['capture_id']+'.json')).read_bytes())
            body=(inputs/'verification/verified-bodies'/capture['body_file']).read_bytes();assert sha256(body).hexdigest()==evidence['body_sha256'];assert evidence['excerpt_original'] in body.decode('utf-8','replace')
        incident=original['id']
        facts={'idcf-2026-10':['Some cloud virtual servers stopped/could not restart','Four zones in East Japan Region1','495 companies/authorities reported affected','TypeS/private cloud explicitly excluded; recovery planning is not completed recovery'],
          'nissui-logistics-2026-10':['Goods receiving/dispatch unavailable at named logistics provider','Outsourced data-center unauthorized access was suspected, not proven causal attribution','Recovery outlook absent; data exposure investigation distinct'],
          'ahold-netherlands-2026-10-12':['Stores and tills operating','Shelf-price system restored','Several distribution centers operating','Online orders, delivery and customer service unavailable in source update','Uneven fresh-product availability is an outlook, not measured deprivation']}[incident]
        examples.append({'event_id':event['event_id'],'country_locator':event['country'],'provider':event['scope'],'provider_type':'private_operator',
         'state_relationship':{'role':'unknown','regulatory_or_supply_responsibility':'not_established','ability_or_willingness_failure':'not_established'},
         'layer1_verified_conditions':{'source_time_state':facts,'publication_day':event['period']['publication_date'],'last_observation_instant':None,'actual_onset_instant':None,'actual_recovery_instant':None,
           'service_access_denominator':None,'affected_population':None,'national_market_share':None,'organization_count':original.get('affected_organizations'),'unit':'organizations, not people',
           'area':{'idcf-2026-10':'Four named cloud zones, not population coverage of Japan','nissui-logistics-2026-10':'Named provider service; territorial/population coverage unavailable','ahold-netherlands-2026-10-12':'Named retailer channels; national affected-population coverage unavailable'}[incident],
           'duration':None,'alternatives_available':None,'unmet_need':None,'current_service_continuity_at_cutoff':'not_inferred_from_publication_age','recovery':'Only explicitly restored components; remaining services and historical confirmations stay separate'},
         'layer2_salience_proxy':{'event_linked_media_volume':None,'domestic_media_origin':None,'language_and_audience':None,'persistence_and_republication_paths':None,'note':'Country GDELT aggregates exist but cannot be attributed to this event or its domestic readers without event/article/audience linkage'},
         'layer3_perception_and_legitimacy':{'resident_fear_or_dissatisfaction':None,'government_response_appraisal':None,'trust_survey':None,'political_mobilization_or_spillover':None,'R1_R2_R4_to_R3_path':'candidate_only; no supporting reaction evidence in these operator statements'},
         'scope_aggregation':{'national_state':'not_assessed','reason':'Missing population/service coverage, duration, alternatives, state relationship and reaction evidence; no local-max country promotion'},
         'source_binding':{'accepted_sha256':event['verification']['accepted_artifact_sha256'],'native_manifest_sha256':event['verification']['native_manifest_sha256'],'reviewed_before_cutoff':event['verification']['verified_at'],'evidence':[{'url':e['url'],'body_sha256':e['body_sha256'],'original_source_id':e['original_source_id'],'retrieved_capture':e['capture_id']} for e in event['evidence']]},
         'same_event_origins':event['event_id'],'not_independent_reports':len(event['evidence'])>1})
    result={'status':'design_review_not_new_perception_or_function_index_implemented','cutoff_utc':'2026-10-13T20:00:00Z',
       'intended_core':'Public concern and weakening trust in expected political-goods provision, observed indirectly through news baseline deviations. Actual functional outcomes provide independent corroboration/counterevidence/context, not a replacement.',
       'theory_sources':[{'url':'https://assets.press.princeton.edu/chapters/s7666.pdf','pages':'printed2–9','point':'Effective political goods and legitimacy/trust/social contract; no official R1–R4 news-count formula'},
         {'url':'https://www.cigionline.org/articles/measuring-governance-improve-lives/','point':'Five political-goods bundles and supply outcomes; separate from this project news proxy'}],
       'operational_separation':['Verified event/function/harm','Domestic media salience proxy: increase, persistence, spread and search interest','Residents response, trust, government appraisal and political spillover'],
       'retained':['Same-country/R baselines and small/high-volume/external-geography guards','Fixed48h/14 calendar dates/10 valid matched pairs; SHA-bound missingness','Reporting persistence can matter even for one actual incident'],
       'not_implemented':['Domestic-language/audience event-level salience measure','Fear/distrust model from tone or Trends','Trust/legitimacy national score','New national functional colors or probabilities'],
       'design_requirements':['Keep event identity and article/republication paths separately; retransmission is not independent incident evidence','ActionGeo is event geography, not reader geography','Stable/improved objective indicators do not cancel a salience signal','Positive operating evidence is scope-specific; zero reports/expiry cannot prove recovery','Do not equate election turnover, approval decline, government collapse, state functional failure and state collapse','Calibrate against suitable survey/experience/trust evidence with source year/population/question and held-out periods; no invented causal coefficients'],
       'examples':examples,'runtime_changed_by_review':False,'new_collection_or_spend':False}
    folder=ROOT/'.local/rindex-v202-evidence';folder.mkdir(parents=True,exist_ok=True);(folder/'three-layer-design-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'status':result['status'],'native_examples':len(examples)}))

if __name__=='__main__':review()
