import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {bundleLevel,assignDistinctSupports} from '../scripts/r_bundles.mjs';import {weeklyBundle,firstLit,alertCard,signalState} from '../src/alert-contract.js';import {assessRIndex} from '../scripts/rindex_v2.mjs';import {evaluateMonitoring} from '../scripts/monitoring_v2.mjs';
const config=JSON.parse(fs.readFileSync('config/scoring.json'));
const input={source_status:'complete',coverage:{expected_slots:192,available_slots:192,rejected_rows:0},input_artifacts:Array.from({length:192},()=>({status:'available'}))};
const row={event_count:400,avg_tone:2,tone_count:400,denom_actor_geo:300,domestic_event_count:210,r1_security:40,r2_living_count:0,r3_governance:40,r4_fiscal_count:40,observation_quality:{source_urls:40,source_domains:10,observed_hours:30,span_hours:46},domain_support:{R1:{exclusive_count:40,article_keys:['a']},R3:{exclusive_count:40,article_keys:['c']},R4:{exclusive_count:40,article_keys:['d']}}};
const refs=types=>Object.fromEntries(['R1','R2','R3','R4'].map(r=>[r,types.includes(r)?{ratio:r==='R1'?8:2,is_stable_input:true}:{ratio:null,is_stable_input:false,data_status:'baseline_unavailable'}]));
const week=(w,types,unknown=[])=>({week:w,weekly_surge_r_by_type:Object.fromEntries(['R1','R2','R3','R4'].map(r=>[r,{is_active:types.includes(r),ratio7:unknown.includes(r)?null:types.includes(r)?2:1}]))});
test('A single extreme R is not country Red; two moderate Rs are Orange; three are Red',()=>{
 assert.equal(assessRIndex(row,input,refs(['R1']),config).level,'yellow');assert.equal(assessRIndex(row,input,refs(['R1','R3']),config).level,'orange');assert.equal(assessRIndex(row,input,refs(['R1','R3','R4']),config).level,'red');
});
test('One valid activation is Yellow even with positive Tone; Tone is not a fifth R',()=>{assert.equal(bundleLevel(['R1','VOL','TREND','TONE'],config),'yellow');const r=assessRIndex(row,input,refs(['R1']),config);assert.equal(r.level,'yellow');assert.equal(alertCard(r.active_types).checks.length,1);});
test('A duplicate article cannot alone support two bundles; lack of support stays Unknown',()=>{
 assert.equal(Object.keys(assignDistinctSupports(['R1','R3'],{R1:{article_keys:['same']},R3:{article_keys:['same']}})).length,1);
 const r=assessRIndex({...row,domain_support:{}},input,refs(['R1']),config);assert.equal(r.level,'unknown');assert.equal(r.max_ratio_active,null);
});
test('Missing other Rs do not erase two known activations',()=>{const r=assessRIndex(row,input,refs(['R1','R3']),config);assert.equal(r.level,'orange');assert.deepEqual(r.unevaluated_types,['R2','R4']);});
test('Single weekly light then off is distinct from unobserved week or physical recovery',()=>{
 const a=week('2026-W01',['R4']),b=week('2026-W02',[]),missing=week('2026-W03',[],['R4']);assert.equal(weeklyBundle(a).level,'yellow');assert.equal(weeklyBundle(b).level,'green');assert.equal(weeklyBundle(missing).level,'unknown');assert.equal(signalState(missing,'R4'),'unknown');
});
test('Existing weekly first-lit and spreading R4 -> R1 -> R3 reproduce Yellow Orange Red',()=>{
 const h=[week('2026-W01',['R4']),week('2026-W02',['R4','R1']),week('2026-W03',['R4','R1','R3'])];assert.deepEqual(h.map(w=>weeklyBundle(w).level),['yellow','orange','red']);assert.deepEqual(firstLit(h).order.map(([r])=>r),['R4','R1','R3']);
});
test('Preventive candidate spillover is not a triggered bundle and needs checks at first light',()=>{
 const r4=alertCard(['R4'],'ja');assert.deepEqual(r4.candidates,['R2','R1']);assert.equal(bundleLevel(r4.active,config),'yellow');assert.ok(r4.checks[0].text.includes('未払い'));const r1=alertCard(['R1'],'ja');assert.deepEqual(r1.candidates,['R3']);
});
test('Empty comparative activation cannot make an insufficient small sample Green; VOL cannot add R',()=>{
 const no=Object.fromEntries(['R1','R2','R3','R4'].map(r=>[r,{ratio:null,is_stable_input:false}]));const e=evaluateMonitoring({...row,event_count:100,r1_security:0,r3_governance:0,r4_fiscal_count:0},input,{level:'red',signals:[{type:'VOL'}]},no,[],config);assert.equal(e.level,'unknown');
});
