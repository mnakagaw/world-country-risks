import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {weeklyBundle,signalState,firstLit} from '../src/alert-contract.js';
const root=path.resolve('public/data/history/weekly_5y'),index=JSON.parse(fs.readFileSync(path.join(root,'index.json'))),out=path.resolve('.local/rindex-v203-evidence');
let preserved=0,singleThenOff=null,spread=null,otherSpread=null,unknownWeeks=0;const originalNotPresent=[];
const summarize=h=>({week:h.week,...weeklyBundle(h),original_max_country_level:h.weekly_surge_r?.level,ratios:h.ratios});
for(const r of index.countries){
 if(!fs.existsSync(path.join(root,r.iso2+'.json'))){originalNotPresent.push(r.iso2);continue;}
 const raw=fs.readFileSync(path.join(root,r.iso2+'.json')),original=JSON.parse(raw),selected=JSON.parse(fs.readFileSync(path.join(root,r.path)));
 assert.equal(selected.legacy_original_sha256,crypto.createHash('sha256').update(raw).digest('hex'));
 const restored=[...selected.history.filter(h=>h.method!=='gdelt-events-calendar-v2-weekly'),...selected.legacy_history_overrides].sort((a,b)=>a.week.localeCompare(b.week));
 // Only method labels were appended in the release; original source rows/bytes remain intact.
 const unmatched=[...restored];for(const h of original.history){const n=unmatched.findIndex(v=>Object.entries(h).every(([key,value])=>JSON.stringify(v[key])===JSON.stringify(value)));assert.ok(n>=0,`${r.iso2} ${h.week}: original row missing`);unmatched.splice(n,1);}
 assert.equal(unmatched.length,0);
 assert.equal(restored.length,original.history.length);preserved++;
 const rows=[...original.history].sort((a,b)=>a.week.localeCompare(b.week));
 unknownWeeks+=rows.filter(h=>Object.keys(h.levels||{}).some(t=>signalState(h,t)==='unknown')).length;
 for(let n=0;n<rows.length-1;n++){
  const a=weeklyBundle(rows[n]),b=weeklyBundle(rows[n+1]);
  if(a.active.length===1&&b.active.length===0&&b.unknown.length===0&&(!singleThenOff||r.iso2==='JP'))singleThenOff={iso2:r.iso2,weeks:[summarize(rows[n]),summarize(rows[n+1])]};
  if((!spread||!otherSpread)&&a.active.length===1&&a.active[0]==='R4')for(let j=n+1;j<Math.min(n+2,rows.length);j++){
   const mid=weeklyBundle(rows[j]);if(mid.active.length!==2||!mid.active.includes('R4'))continue;
   for(let k=j+1;k<Math.min(n+3,rows.length);k++){const last=weeklyBundle(rows[k]);if(last.active.length>=3&&mid.active.every(t=>last.active.includes(t))){const example={iso2:r.iso2,weeks:[summarize(rows[n]),summarize(rows[j]),summarize(rows[k])],first_lit:firstLit(rows.slice(n,k+1)),meaning:'Three adjacent original observation rows with sustained R4; not evidence of causal diffusion or event onset.'};if(mid.active.includes('R1'))spread=example;else if(!otherSpread)otherSpread=example;break;}}
   if(spread)break;
  }
 }
}
const report={epoch:index.epoch,original_country_histories_preserved:preserved,original_history_not_present:originalNotPresent,unknown_original_country_weeks:unknownWeeks,single_then_off:singleThenOff,observed_R4_R1_R3_adjacent_example:spread,other_observed_R4_spread_example:otherSpread,meaning:'Retrospective concurrent-bundle projection on unmodified original R activations; duplicate original week rows retained. Original max-only colors preserved. Off does not prove physical recovery; no forecasting accuracy claim.'};
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'weekly-design-audit.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
