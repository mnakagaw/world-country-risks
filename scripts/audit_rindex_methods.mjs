import fs from 'node:fs';import crypto from 'node:crypto';import path from 'node:path';
import {aggregateObservation,matchedReferences} from './monitoring_v2.mjs';import {assessRIndex} from './rindex_v2.mjs';import {alertCounts} from '../src/display.js';
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex'),root=path.resolve('.');
const sourceRaw=fs.readFileSync('.local/baseline-sources/2026-10-14.json'),source=JSON.parse(sourceRaw),current=JSON.parse(fs.readFileSync('public/data/v2/latest.json'));
const oldRaw=fs.readFileSync('public/data/v2/40e04c1c4447ac1b1b11be3e82275e05eed101d54c1969c7e68461fb42cc4871.json'),old=JSON.parse(oldRaw),history=JSON.parse(fs.readFileSync('.local/v2-history.json')),config=JSON.parse(fs.readFileSync('config/scoring.json'));
const observed=aggregateObservation(source),k=config.surge_r.smoothing_k,t=config.surge_r.thresholds;
const legacyBaselineRaw=fs.readFileSync('public/data/baselines/gdelt_r_baselines_5y.json'),legacyBaseline=JSON.parse(legacyBaselineRaw);
const levels=ratio=>ratio==null?'unknown':ratio>=t.red?'red':ratio>=t.orange?'orange':ratio>=t.yellow?'yellow':'green';
const rows=[],details={};let guardChanged=0,formulaChanged=0;
for(const [iso,country] of Object.entries(current.countries)){
 const base=matchedReferences(observed,history,current.date,iso,{config});
 const legacy=structuredClone(base);for(const r of Object.values(legacy)){r.ratio=r.is_stable_input?(r.today+k)/(Math.max(1,r.baseline_median)+k):null;}
 const legacyGuarded=assessRIndex(observed.data[iso],source,legacy,config),guarded=assessRIndex(observed.data[iso],source,base,config);
 const unguardedMaximum=Math.max(...Object.values(base).filter(r=>r.is_stable_input).map(r=>r.ratio),-Infinity),unguardedLevel=levels(unguardedMaximum===-Infinity?null:unguardedMaximum);
 if(guarded.level!==unguardedLevel)guardChanged++;if(guarded.level!==legacyGuarded.level)formulaChanged++;
 details[iso]={legacy_formula_on_same_matched_population:legacyGuarded,matched_formula_with_guards:guarded};
 for(const type of ['R1','R2','R3','R4']){
  const g=guarded.by_type[type],v=base[type],p=old.countries[iso];
  rows.push({iso2:iso,component:type,observed_country_records:observed.data[iso]?.event_count??0,matched_today_median:v.today,matched_baseline_median:v.baseline_median,valid_pairs:v.reference.valid_days,
   retained_legacy_5y_baseline:legacyBaseline.baselines[iso]?.[type]?.median??null,
   legacy_5y_formula_counterfactual:legacyBaseline.baselines[iso]?.[type]?.median>=config.surge_r.min_baseline_median_for_surge?(v.observed_today+k)/(Math.max(1,legacyBaseline.baselines[iso][type].median)+k):null,
   legacy_formula_matched_medians:legacy[type].ratio,v201_pair_ratio:p.surge_r_by_type[type].ratio,v202_pair_ratio:v.ratio,
   before_guard_active:p.surge_r_by_type[type].is_active,after_guard_active:g.is_active,gate_share:g.share,abs_hit:g.abs_hit,share_hit:g.share_hit,high_volume:g.high_vol,activation_threshold:g.threshold,guard_reasons:g.gate_reasons.join(';'),
   domestic_ratio:guarded.actor_geography.domestic_ratio,actor_geography_status:guarded.actor_geography.status,
   prior_v201_display_all_modes:p.monitoring_level,prior_v201_diagnostic:p.surge_r.level,unguarded_pair_comparison:unguardedLevel,legacy_formula_with_restored_guards:legacyGuarded.level,
   new_rindex:country.rindex_evaluation.level,new_raw:country.evaluation.initial_level,new_combined_news:country.monitoring_level,snapshot_id:current.snapshot_id});
 }
}
const quote=v=>`"${String(v??'').replaceAll('"','""')}"`,keys=Object.keys(rows[0]),csv='\ufeff'+[keys.join(','),...rows.map(row=>keys.map(key=>quote(row[key])).join(','))].join('\n')+'\n';
const out=path.resolve('.local/rindex-v202-evidence');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'239-country-method-comparison.csv'),csv);
const priorDiagnostic={red:0,orange:0,yellow:0,green:0,unknown:0};for(const c of Object.values(old.countries))priorDiagnostic[c.surge_r.level.toLowerCase()]++;
const report={snapshot_id:current.snapshot_id,source_sha256:sha(sourceRaw),previous_snapshot_sha256:sha(oldRaw),source_unchanged:current.input_sha256===old.input_sha256,baseline_unchanged:current.baseline_input_sha256===old.baseline_input_sha256,
 config_sha256:sha(fs.readFileSync('config/scoring.json')),before_display_counts:old.monitoring_counts,before_diagnostic_counts:priorDiagnostic,after_mode_counts:current.mode_counts,
 retained_legacy_5y_baseline:{sha256:sha(legacyBaselineRaw),metadata:legacyBaseline.meta,use:'Counterfactual diagnostic only; current partial observation compared to an old zero-filled historical population. Not a replay or a validated like-for-like change.'},
 countries_with_guard_color_difference:guardChanged,countries_with_formula_color_difference:formulaChanged,countries:239,component_rows:rows.length,
 meaning:'Legacy-formula comparator uses SAME matched observation population to isolate formula change. It is not a reproduction of old5y/test3d/calmest3y baselines or old published forecasts. v2.0.1 diagnostic is retained separately.',
 functional_national_score:'not_assessed',operator_impact_country_color_promotion_removed:true};
fs.writeFileSync(path.join(out,'method-audit.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(out,'paired-guard-audit.private.json'),JSON.stringify(details)+'\n');
console.log(JSON.stringify(report));
