import test from 'node:test';import assert from 'node:assert/strict';import {matchedReferences} from '../scripts/monitoring_v2.mjs';import {calendarDates,METHOD} from '../scripts/engine_v2.mjs';
const offsets=Array.from({length:192},(_,n)=>n),quarters=Object.fromEntries(offsets.map(n=>[n,{JP:{event_count:20,r1_security:5,r2_living_count:4,r3_governance:3,r4_fiscal_count:6}}]));
test('03:00 matched references reject old05:00 even with the same dates and offsets',()=>{
 const current={offsets,quarters,data:{JP:{event_count:3840,r1_security:960,r2_living_count:768,r3_governance:576,r4_fiscal_count:1152}},cutoff_utc:'2026-10-14T18:00:00Z'};
 const history=Object.fromEntries(calendarDates('2026-10-15',14).map(day=>[day,{method:METHOD,offsets,quarters,cutoff_utc:day+'T20:00:00Z'}]));
 assert.equal(matchedReferences(current,history,'2026-10-15','JP').R1.reference.valid_days,0);
 for(const day of Object.keys(history).slice(0,10))history[day].cutoff_utc=day+'T18:00:00Z';
 const r=matchedReferences(current,history,'2026-10-15','JP').R1;assert.equal(r.reference.valid_days,10);assert.equal(r.ratio,1);
});
