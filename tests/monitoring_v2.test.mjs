import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {evaluateMonitoring,matchedReferences,aggregateObservation} from '../scripts/monitoring_v2.mjs';
import {calendarDates,verifyImpact} from '../scripts/engine_v2.mjs';import {countryLevel,alertCounts} from '../src/display.js';
import {countryName,geoCountryCode} from '../src/country-codes.js';
const config=JSON.parse(fs.readFileSync('config/scoring.json'));
const input={source_status:'partial',coverage:{expected_slots:192,available_slots:120,rejected_rows:0},input_artifacts:Array.from({length:192},(_,i)=>({status:i%8<5?'available':'missing'}))};
const row={event_count:400,tone_count:400,denom_actor_geo:300,avg_tone:-2,r1_security:40,r2_living_count:0,r3_governance:30,r4_fiscal_count:0,observation_quality:{source_urls:40,source_domains:10,observed_hours:28,span_hours:46}};
const refs=Object.fromEntries(['R1','R2','R3','R4'].map(key=>[key,{ratio:null,is_stable_input:false}]));
test('All5 monitoring states stay consistent inside their selected mode',()=>{
 const countries={};for(const level of ['red','orange','yellow','green','unknown']){
  const evaluation=evaluateMonitoring(level==='unknown'?null:row,input,{level},refs,[],config);
  assert.equal(evaluation.level,level);countries[level]={evaluation,monitoring_level:level,baseline_status:'baseline_insufficient',data_status:'partial'};
  countries[level].evaluation.initial_level=level;
  countries[level].rindex_evaluation={level:'unknown'};
  for(const mode of ['raw','monitoring','index'])assert.equal(countryLevel(countries[level],mode),level);
  assert.equal(countryLevel(countries[level],'surge_r'),'unknown');
 }assert.deepEqual(alertCounts(countries,'monitoring'),{red:1,orange:1,yellow:1,green:1,unknown:1});
});
test('Sparse R2/R4 and observed zeros do not suppress available strong R1',()=>{
 const by={...refs,R1:{ratio:4,is_stable_input:true,is_active:true}};
 const e=evaluateMonitoring(row,input,{level:'green'},by,[],config);assert.equal(e.level,'red');assert.deepEqual(e.available_comparisons,['R1']);assert.equal(e.components.R2.value_status,'observed_zero');assert.equal(e.components.R2.total_window_estimate,null);
});
test('Partial inputs can qualify conditional Green; gaps, stale and no inputs cannot',()=>{
 assert.equal(evaluateMonitoring(row,input,{level:'green'},refs,[],config).level,'green');
 for(const status of ['missing','available']){
  const broken={...input,input_artifacts:Array.from({length:192},(_,i)=>({status:i>=96?'missing':status}))};
  assert.equal(evaluateMonitoring(row,broken,{level:'green'},refs,[],config).level,'unknown');
 }
 assert.equal(evaluateMonitoring({...row,event_count:0},input,{level:'green'},refs,[],config).level,'unknown');
 assert.equal(evaluateMonitoring({...row,observation_quality:{...row.observation_quality,source_domains:2}},input,{level:'red'},refs,[],config).level,'unknown');
});
test('Small country uses supported composition; otherwise remains Unknown',()=>{
 const small={...row,event_count:100,r1_security:30,r2_living_count:15,r3_governance:20,r4_fiscal_count:0};
 assert.equal(evaluateMonitoring(small,input,{},refs,[],config).level,'red');
 assert.equal(evaluateMonitoring({...small,event_count:20},input,{},refs,[],config).level,'unknown');
 assert.equal(evaluateMonitoring({...small,r1_security:0,r2_living_count:0,r3_governance:0},input,{},refs,[],config).level,'unknown');
});
test('Matched pairs exclude missing offsets, current day, legacy and old islands',()=>{
 const offsets=Array.from({length:120},(_,i)=>i),quarters=Object.fromEntries(offsets.map(i=>[i,{JP:{event_count:10,r1_security:4}}]));
 const current={offsets,quarters,data:{JP:{r1_security:480}}};const history={};
 for(const day of calendarDates('2026-10-14',14))history[day]={offsets:offsets.slice(0,100),quarters};
 history['2026-10-14']={offsets,quarters};history['2000-01-01']={offsets,quarters};
 const r=matchedReferences(current,history,'2026-10-14','JP');assert.equal(r.R1.reference.valid_days,14);assert.equal(r.R1.today,400);assert.equal(r.R1.observed_today,480);assert.equal(r.R1.ratio,1);assert.equal(r.R2.ratio,null);assert.equal(r.R2.baseline_median,0);
 history['2026-10-01'].offsets=[];assert.equal(matchedReferences(current,history,'2026-10-14','JP').R1.reference.valid_days,13);
 history['2026-10-02'].method='legacy';assert.equal(matchedReferences(current,history,'2026-10-14','JP').R1.reference.valid_days,12);
});
test('True7d comparisons require4 matching weeks, not daily conversion',()=>{
 const offsets=Array.from({length:672},(_,i)=>i),quarters=Object.fromEntries(offsets.map(i=>[i,{JP:{r1_security:1}}])),current={offsets,quarters,data:{JP:{r1_security:672}}};
 const dates=['a','b','c','d'],history=Object.fromEntries(dates.map(d=>[d,current]));
 assert.equal(matchedReferences(current,history,'unused','JP',{dates,required_days:4,expected_slots:672}).R1.ratio,1);
 delete history.d;assert.equal(matchedReferences(current,history,'unused','JP',{dates,required_days:4,expected_slots:672}).R1.ratio,null);
});
test('Country identity uses FIPS conversion and canonical ISO labels',()=>{
 assert.match(countryName('US','en','US Naval Base Guantanamo Bay'),/United States/);assert.equal(geoCountryCode({'ISO3166-1-Alpha-2':'CN-TW'}),'TW');assert.equal(geoCountryCode({'ISO3166-1-Alpha-2':'-99',name:'Kosovo'}),'XK');
 const dto={window:{start_utc:'2026-10-11T20:00:00Z'},countries:{JA:{event_count:5,r1_security:0}},input_artifacts:[]};assert.equal(aggregateObservation(dto).data.JP.event_count,5);
});
test('Actual accepted native impacts are bound to source bodies and review cutoff',()=>{
 if(!fs.existsSync('.local/accepted-impacts/impacts.json'))return;
 const events=JSON.parse(fs.readFileSync('.local/accepted-impacts/impacts.json'));
 const nl=events.find(e=>e.country==='NL');assert.ok(nl);const valid=verifyImpact(nl,{end_utc:'2026-10-13T20:00:00Z'},'.local/accepted-impacts/verification');assert.equal(valid.independent_source_count,1);assert.equal(valid.assessment.current_at_cutoff,true);
 const forged=structuredClone(nl);forged.verification.accepted_artifact_sha256='f'.repeat(64);assert.throws(()=>verifyImpact(forged,{end_utc:'2026-10-13T20:00:00Z'},'.local/accepted-impacts/verification'));
 const old=events.find(e=>e.country==='JP');assert.equal(old.assessment.current_at_cutoff,false);
});
