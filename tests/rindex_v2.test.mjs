import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {assessRIndex} from '../scripts/rindex_v2.mjs';import {matchedReferences,evaluateMonitoring} from '../scripts/monitoring_v2.mjs';import {calendarDates} from '../scripts/engine_v2.mjs';import {countryLevel,alertCounts} from '../src/display.js';
const cfg=JSON.parse(fs.readFileSync('config/scoring.json'));
const input={source_status:'partial',coverage:{expected_slots:192,available_slots:120,rejected_rows:0},input_artifacts:Array.from({length:192},(_,i)=>({status:i%8<5?'available':'missing'}))};
const row={event_count:400,tone_count:400,denom_actor_geo:300,domestic_event_count:210,avg_tone:-2,r1_security:40,r2_living_count:0,r3_governance:30,r4_fiscal_count:0,domain_support:{R1:{exclusive_count:40,article_keys:['a']},R2:{exclusive_count:40,article_keys:['b']},R3:{exclusive_count:30,article_keys:['c']},R4:{exclusive_count:40,article_keys:['d']}},observation_quality:{source_urls:40,source_domains:10,observed_hours:28,span_hours:46}};
const empty=()=>Object.fromEntries(['R1','R2','R3','R4'].map(r=>[r,{ratio:null,is_stable_input:false,data_status:'low_or_zero_baseline'}]));
const refs=(ratio=4)=>({...empty(),R1:{ratio,is_stable_input:true,baseline_median:10}});
test('Extreme single R1 is Yellow, with Red domain intensity; unavailable others do not erase it',()=>{const r=assessRIndex(row,input,refs(),cfg);assert.equal(r.level,'yellow');assert.equal(r.by_type.R1.comparison_level,'red');assert.deepEqual(r.active_types,['R1']);assert.equal(r.by_type.R2.comparison_level,'unknown');});
test('High-volume absolute-only gate suppresses false activation',()=>{const r=assessRIndex({...row,event_count:10000,r1_security:400},input,refs(8),cfg);assert.equal(r.level,'green');assert.equal(r.max_ratio_active,0);assert.ok(r.by_type.R1.gate_reasons.includes('high_volume_absolute_only_suppressed'));});
test('Active maximum excludes even a larger gated ratio, unavailable maximum is null',()=>{
 const base={...refs(3),R2:{ratio:30,is_stable_input:true,baseline_median:5}};const r=assessRIndex(row,input,base,cfg);assert.equal(r.max_ratio_active,3);assert.equal(r.max_ratio_observed,30);assert.equal(assessRIndex(row,input,empty(),cfg).max_ratio_active,null);
});
test('External pressure proxy raises R1/R3 to Orange without altering R2',()=>{
 const base={...refs(2),R2:{ratio:2,is_stable_input:true,baseline_median:5},R3:{ratio:2,is_stable_input:true,baseline_median:5}};
 const r=assessRIndex({...row,domestic_event_count:30,r2_living_count:40},input,base,cfg);assert.deepEqual(r.active_types,['R2']);assert.equal(r.actor_geography.external_pressure_noise,true);assert.equal(r.by_type.R1.threshold,cfg.surge_r.thresholds.orange);
});
test('Unknown actor geography is neither domestic nor confirmed external pressure',()=>{
 const r=assessRIndex({...row,denom_actor_geo:20,domestic_event_count:0},input,refs(2),cfg);assert.equal(r.actor_geography.status,'unknown');assert.equal(r.actor_geography.external_pressure_noise,null);assert.equal(r.actor_geography.domestic_ratio,null);assert.equal(r.by_type.R1.is_active,false);assert.ok(r.by_type.R1.gate_reasons.includes('actor_geography_unknown_conservative_orange_threshold'));
});
test('Missing or insufficient country denominator never emits Green',()=>{for(const n of [undefined,0,49])assert.equal(assessRIndex({...row,event_count:n},input,refs(),cfg).level,'unknown');});
test('Canonical thresholds, smoothing and baseline minimum take effect',()=>{
 const changed=structuredClone(cfg);changed.surge_r.thresholds={yellow:2.5,orange:4,red:6};assert.equal(assessRIndex(row,input,refs(2),changed).level,'green');
 const offsets=Array.from({length:120},(_,i)=>i);const quarter=n=>Object.fromEntries(offsets.map(o=>[o,{JP:{r1_security:n}}]));const history=Object.fromEntries(calendarDates('2026-10-14',14).map(d=>[d,{offsets,quarters:quarter(1)}]));const current={offsets,quarters:quarter(2),data:{JP:{r1_security:240}}};
 const before=matchedReferences(current,history,'2026-10-14','JP',{config:cfg}).R1.ratio;changed.surge_r.smoothing_k=100;assert.notEqual(matchedReferences(current,history,'2026-10-14','JP',{config:changed}).R1.ratio,before);changed.surge_r.min_baseline_median_for_surge=121;assert.equal(matchedReferences(current,history,'2026-10-14','JP',{config:changed}).R1.ratio,null);
});
test('US-type composite Red and R-INDEX Green are intentionally different',()=>{
 const country={monitoring_level:'red',evaluation:{initial_level:'red'},rindex_evaluation:{level:'green'}};assert.equal(countryLevel(country,'monitoring'),'red');assert.equal(countryLevel(country,'surge_r'),'green');assert.deepEqual(alertCounts({US:country},'surge_r'),{red:0,orange:0,yellow:0,green:1,unknown:0});
});
test('A local operator Orange impact cannot rewrite R-INDEX or national news color',()=>{
 const r=assessRIndex(row,input,refs(1),cfg);const impact={event_id:'local:N L',assessment:{current_at_cutoff:true,level:'orange',method:'accepted-functional-impact-v2'}};
 const monitoring=evaluateMonitoring({...row,r1_security:0,r3_governance:0},input,{level:'green'},r.by_type,[impact],cfg);assert.equal(r.level,'green');assert.equal(monitoring.level,'green');assert.equal(monitoring.national_functional_state,'not_assessed');assert.deepEqual(monitoring.scoped_impacts,['local:N L']);
});
