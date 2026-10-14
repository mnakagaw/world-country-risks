import test from 'node:test';import assert from 'node:assert/strict';
import {calendarDates,reference,assessCoverage,ratioRecord,verifyImpact,bindExplanation,METHOD,latestCompletedWeek} from '../scripts/engine_v2.mjs';
import {FIPS_TO_ISO2,aggregateToIso2} from '../scripts/fips_to_iso2.js';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
test('FIPS duplicate merge keeps weighted Tone and known-geography denominator',()=>{
 const aliases=Object.entries(FIPS_TO_ISO2).filter(([,iso],i,a)=>a.findIndex(([,v])=>v===iso)!==i);
 const pair=aliases[0];assert.ok(pair,'Actual mapping has a duplicate alias');
 const first=Object.entries(FIPS_TO_ISO2).find(([key,v])=>v===pair[1]&&key!==pair[0]);
 const make=(count,tone,denom,domestic)=>({event_count:count,avg_tone:tone,tone_count:count,tone_sum:count*tone,denom_actor_geo:denom,domestic_event_count:domestic});
 const merged=aggregateToIso2({[first[0]]:make(100,-4,80,40),[pair[0]]:make(300,0,200,20)}).data[pair[1]];
 assert.equal(merged.avg_tone,-1);assert.equal(merged.denom_actor_geo,280);assert.equal(merged.domestic_ratio,60/280);assert.equal(merged.raw_country_codes.length,2);
});
test('Calendar ignores old islands and current day',()=>{
 const h={'2026-01-01':{method:METHOD,coverage:'complete',countries:{JP:{event_count:99999}}},'2026-10-14':{method:METHOD,coverage:'complete',countries:{JP:{event_count:1}}}};
 const r=reference(h,'2026-10-14','JP','event_count');assert.equal(r.valid_days,0);assert.equal(r.median,null);assert.equal(r.missing_dates.length,14);assert.equal(r.start,'2026-09-30');
});
test('True measured zero can be a reference; partial and legacy cannot',()=>{
 const h={};for(const day of calendarDates('2026-10-14',14))h[day]={method:METHOD,coverage:'complete',countries:{JP:{event_count:0}}};
 h['2026-10-10'].coverage='partial';h['2026-10-11'].method='legacy';const r=reference(h,'2026-10-14','JP','event_count');assert.equal(r.valid_days,12);assert.equal(r.median,0);
});
test('Unknown, partial and low coverage are never Green',()=>{
 assert.equal(assessCoverage(null,{source_status:'complete'}),'unknown');assert.equal(assessCoverage({event_count:30},{source_status:'complete'}),'low_coverage');assert.equal(assessCoverage({event_count:2000},{source_status:'partial'}),'partial');
});
test('Missing baseline is null rather than one',()=>{assert.equal(ratioRecord(99,{median:null,valid_days:0}).ratio,null);});
test('URL presence never raises confidence',()=>{assert.equal(bindExplanation('JP',{},['https://example.org'],{}).confidence,'low');});
test('Verified impact needs actual body review and original provenance',()=>{
 const window={end_utc:'2026-10-14T00:00:00Z'};
 assert.throws(()=>verifyImpact({status:'verified',evidence:[{url:'https://example.org'}]},window));
 const row={schema:'verified-impact-v2',status:'verified',event_id:'e1',country:'JP',impact:'power unavailable',scope:'one verified facility',verification:{body_sha256:'a'.repeat(64),verified_at:'2026-10-13T00:00:00Z'},evidence:[{url:'https://example.org/a',original_source_id:'wire1',checked_at:'2026-10-13T00:00:00Z',body_reviewed:true},{url:'https://example.org/b',original_source_id:'wire1',checked_at:'2026-10-13T00:00:00Z',body_reviewed:true}]};
 const base=path.resolve('work/impact-fixtures');fs.mkdirSync(base,{recursive:true});const dir=fs.mkdtempSync(path.join(base,'case-'));
 try{
  fs.mkdirSync(path.join(dir,'captures'));fs.mkdirSync(path.join(dir,'verified-bodies'));
  const raw=Buffer.from('Original verified report of the power failure.');const sha=crypto.createHash('sha256').update(raw).digest('hex');
  fs.writeFileSync(path.join(dir,'verified-bodies',sha+'.body'),raw);row.verification.body_sha256=sha;row.verification.verified_at='2026-10-13T23:30:00Z';
  for(const [i,e] of row.evidence.entries()){
   e.capture_id=String(i).repeat(64);e.body_sha256=sha;e.checked_at='2026-10-13T23:30:00Z';e.excerpt_original='Original verified report';
   fs.writeFileSync(path.join(dir,'captures',e.capture_id+'.json'),JSON.stringify({url:e.url,body_file:sha+'.body',body_sha256:sha,retrieved_at:'2026-10-13T23:00:00Z'}));
  }
  assert.equal(verifyImpact(row,window,dir).independent_source_count,1);
  row.evidence[0].url='https://invented.invalid';assert.throws(()=>verifyImpact(row,window,dir));row.evidence[0].url='https://example.org/a';
  row.verification.verified_at='2026-10-14T00:00:00.000Z';assert.throws(()=>verifyImpact(row,window,dir));
 }finally{if(!dir.startsWith(base+path.sep))throw new Error('Unsafe fixture cleanup');fs.rmSync(dir,{recursive:true});}
});
test('Weekly window is last completed week, excludes ongoing week',()=>{const w=latestCompletedWeek('2026-10-14T00:00:00Z');assert.equal(w.start_utc,'2026-10-05T00:00:00.000Z');assert.equal(w.end_utc,'2026-10-12T00:00:00.000Z');});
