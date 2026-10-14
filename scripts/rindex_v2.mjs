import {temporalQuality,METRICS} from './monitoring_v2.mjs';
const BLOCKS={R1:'r1_security',R2:'r2_living',R3:'r3_governance',R4:'r4_fiscal'};
export function validateRIndexConfig(config){
 const s=config.surge_r,t=s?.thresholds,g=s?.external_pressure_guard;
 if(!s || !Number.isFinite(s.smoothing_k) || s.smoothing_k<0 || !Number.isFinite(s.min_baseline_median_for_surge) || s.min_baseline_median_for_surge<0 ||
    !Number.isFinite(s.high_volume_floor) || s.high_volume_floor<=0 || !Number.isFinite(s.min_observed_records) || s.min_observed_records<1 ||
    !t || ![t.yellow,t.orange,t.red].every(Number.isFinite) || !(t.yellow>1 && t.orange>t.yellow && t.red>t.orange) ||
    !g || !(g.max_domestic_share>=0 && g.max_domestic_share<=1) || !(g.min_known_actor_geographies>0) || g.unknown_policy!=='orange_threshold_for_R1_R3')throw Error('Invalid canonical R-INDEX config');
 for(const type of Object.keys(BLOCKS)){const b=config[BLOCKS[type]];if(!b || !Number.isFinite(b.absolute_threshold) || !Number.isFinite(b.ratio_threshold))throw Error('Missing R gate config');}
}
// A comparison assessment only: accepted impacts never enter this calculation.
export function assessRIndex(row,input,comparisons,config){
 validateRIndexConfig(config);const s=config.surge_r,t=s.thresholds,temporal=temporalQuality(input),q=row?.observation_quality || {},n=row?.event_count;
 const scale=Math.max(1,temporal.expected_slots/192);
 const denominatorReady=Number.isFinite(n) && n>=s.min_observed_records*scale;
 const timeReady=temporal.fraction>=0.5 && temporal.longest_gap_minutes<=180 && temporal.last_source_age_minutes<=180 && temporal.rejected_rows===0;
 const sampleReady=denominatorReady && timeReady && q.source_urls>=10 && q.source_domains>=3 && q.observed_hours>=8*scale && q.span_hours>=24*scale;
 const geo=s.external_pressure_guard,denom=row?.denom_actor_geo,domestic=row?.domestic_event_count;
 const geographyKnown=Number.isFinite(denom) && denom>=geo.min_known_actor_geographies && Number.isFinite(domestic) && domestic>=0 && domestic<=denom;
 const domesticRatio=geographyKnown ? domestic/denom : null;
 const pressureProxy=geographyKnown ? domesticRatio<=geo.max_domestic_share : null;
 const highVol=denominatorReady && n>=s.high_volume_floor;
 const byType={};
 for(const [type,metric] of Object.entries(METRICS)){
  const base=comparisons[type],count=row?.[metric]??0,b=config[BLOCKS[type]];
  const share=denominatorReady ? count/n : null,absHit=denominatorReady && count>=b.absolute_threshold,shareHit=share!==null && share>=b.ratio_threshold;
  const triggered=shareHit || (absHit && !highVol);
  const affected=type==='R1'||type==='R3';
  const threshold=affected && (pressureProxy===true || pressureProxy===null) ? t.orange : t.yellow;
  const comparable=base?.is_stable_input===true && Number.isFinite(base.ratio);
  const isActive=sampleReady && comparable && triggered && base.ratio>=threshold;
  const reasons=[];
  if(!comparable)reasons.push(base?.data_status || 'baseline_unavailable');
  if(!denominatorReady)reasons.push('insufficient_country_denominator');
  if(!sampleReady)reasons.push('insufficient_observation_coverage');
  if(highVol && absHit && !shareHit)reasons.push('high_volume_absolute_only_suppressed');
  else if(!triggered)reasons.push('absolute_share_gate_not_met');
  if(affected && pressureProxy===true)reasons.push('external_pressure_geography_proxy_orange_threshold');
  if(affected && pressureProxy===null)reasons.push('actor_geography_unknown_conservative_orange_threshold');
  if(comparable && base.ratio<threshold)reasons.push('below_active_threshold');
  byType[type]={...base,is_active:isActive,threshold,share,abs_hit:absHit,share_hit:shareHit,triggered,high_vol:highVol,
   gate_observed_count:count,gate_event_count:denominatorReady?n:null,gate_population:'Current observed canonical records in the fixed window; no extrapolation',
   absolute_threshold:b.absolute_threshold,share_threshold:b.ratio_threshold,
   gate_reasons:isActive?['active_after_all_guards']:reasons,
   comparison_level:!sampleReady || !comparable?'unknown':isActive ? base.ratio>=t.red?'red':base.ratio>=t.orange?'orange':'yellow':'green'};
 }
 const available=Object.keys(byType).filter(type=>byType[type].is_stable_input && Number.isFinite(byType[type].ratio));
 const active=Object.keys(byType).filter(type=>byType[type].is_active);
 const evaluable=sampleReady && available.length>0;
 const maxActive=evaluable ? active.length ? Math.max(...active.map(type=>byType[type].ratio)) : 0 : null;
 const level=!evaluable?'unknown':maxActive>=t.red?'red':maxActive>=t.orange?'orange':maxActive>=t.yellow?'yellow':'green';
 return {level,method:s.method_version,thresholds:{...t},smoothing_k:s.smoothing_k,by_type:byType,
  active_types:active,available_types:available,unevaluated_types:Object.keys(byType).filter(type=>!available.includes(type)),
  max_ratio_active:maxActive,max_ratio_observed:available.length?Math.max(...available.map(type=>byType[type].ratio)):null,
  reasons:!denominatorReady?['insufficient_country_denominator']:!sampleReady?['insufficient_observation_coverage']:!available.length?['no_comparable_components']:active.length?['active_after_all_guards']:['no_active_in_available_comparisons'],
  sample_ready:sampleReady,temporal_coverage:temporal,partial_observation:input.source_status!=='complete',
  actor_geography:{status:geographyKnown?'observed':'unknown',known_geography_denominator:Number.isFinite(denom)?denom:null,domestic_records:Number.isFinite(domestic)?domestic:null,domestic_ratio:domesticRatio,external_pressure_noise:pressureProxy,
   meaning:'Actor/action geographic alignment proxy, not verified external pressure or domestic impact',unknown_policy:geo.unknown_policy},
  color_role:'R-INDEX only. Green means no gate-qualified activation among available comparisons; not national safety'};
}
