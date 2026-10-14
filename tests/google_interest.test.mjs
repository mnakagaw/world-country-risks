import test from 'node:test';
import assert from 'node:assert/strict';
import {interestQuery, selectedInterest, interestHistoryLink} from '../src/google-interest.js';
const fixture=()=>({schema:'country-interest-v1',producer:'securitywatch-general15',mode:'daily',delivery_state:'sealed',snapshot_id:'a'.repeat(64),window:{start_utc:'2026-10-12T18:00:00Z',end_utc:'2026-10-13T18:00:00Z'},cards:[{country:'JP',top5:Array.from({length:7},()=>({raw_query:'地震'}))}]});
test('popup uses the displayed edition and shared producer, maximum5 terms',()=>{
 const url=new URL(interestQuery('JP','2026-10-14'));assert.equal(url.searchParams.get('mode'),'daily');assert.equal(url.searchParams.get('day'),'2026-10-14');assert.equal(url.searchParams.get('country'),'JP');assert.equal(selectedInterest(fixture(),'JP','2026-10-14').card.top5.length,5);assert.equal(new URL(interestHistoryLink('JP','2026-10-14')).searchParams.get('day'),'2026-10-14');
});
test('later, live, wrong-country and malformed editions are withheld',()=>{
 for(const change of [v=>v.mode='live',v=>v.window.end_utc='2026-10-13T20:00:00Z',v=>v.cards[0].country='DO',v=>v.delivery_state='stale',v=>v.snapshot_id='invalid']) {const v=fixture();change(v);assert.throws(()=>selectedInterest(v,'JP','2026-10-14'));}
 assert.throws(()=>interestQuery('JP',''));assert.throws(()=>selectedInterest(fixture(),'JP','2026-10-15'));
});
