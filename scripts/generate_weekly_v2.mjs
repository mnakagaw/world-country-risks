import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {aggregateToIso2,loadCountryNameMap} from './fips_to_iso2.js';
import {aggregateObservation,matchedReferences,evaluateMonitoring} from './monitoring_v2.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const i=process.argv.indexOf('--input');if(i<0)throw new Error('--input required');
const input=JSON.parse(fs.readFileSync(process.argv[i+1]));
const start=new Date(input.window.start_utc),end=new Date(input.window.end_utc);
if(end-start!==7*86400000||start.getUTCDay()!==1||end.getUTCDay()!==1||start.getUTCHours()||end.getUTCHours())throw new Error('Weekly window must be one completed ISO week');
const thursday=new Date(start.getTime()+3*86400000);const year=thursday.getUTCFullYear();
const jan4=new Date(Date.UTC(year,0,4));const first=new Date(jan4.getTime()-((jan4.getUTCDay()+6)%7)*86400000);
const week=year+'-W'+String(Math.round((start-first)/(7*86400000))+1).padStart(2,'0');
const observed=aggregateObservation(input),data=observed.data;
const historyDir=path.join(root,'.local/weekly-baseline-sources'),paired={};
if(fs.existsSync(historyDir))for(const file of fs.readdirSync(historyDir).filter(p=>/^\d{4}-\d{2}-\d{2}\.json$/.test(p))){
 const past=JSON.parse(fs.readFileSync(path.join(historyDir,file)));if(Date.parse(past.window.end_utc)-Date.parse(past.window.start_utc)!==7*86400000)throw Error('Invalid7d baseline');
 paired[file.slice(0,10)]=aggregateObservation(past);
}
const dates=Array.from({length:8},(_,i)=>new Date(start.getTime()-(8-i)*7*86400000).toISOString().slice(0,10));
const config=JSON.parse(fs.readFileSync(path.join(root,'config/scoring.json')));
for(const key of ['r1_security','r2_living','r3_governance','r4_fiscal'])config[key].absolute_threshold*=3.5;
const names=loadCountryNameMap(),dir=path.join(root,'public/data/history/weekly_5y');
const epoch=week+'-'+crypto.createHash('sha256').update(JSON.stringify(input)+JSON.stringify(paired)+fs.readFileSync(fileURLToPath(import.meta.url))+fs.readFileSync(path.join(root,'scripts/monitoring_v2.mjs'))).digest('hex').slice(0,20);
const release=path.join(dir,'releases',epoch);fs.mkdirSync(release,{recursive:true});
if(fs.existsSync(path.join(release,'index.json'))){
 const fixed=fs.readFileSync(path.join(release,'index.json'));fs.writeFileSync(path.join(dir,'index.json.pending'),fixed);fs.renameSync(path.join(dir,'index.json.pending'),path.join(dir,'index.json'));
 console.log(JSON.stringify({status:'reused',week,epoch}));process.exit(0);
}
const countries=[];fs.mkdirSync(dir,{recursive:true});
const active=fs.existsSync(path.join(dir,'index.json'))?JSON.parse(fs.readFileSync(path.join(dir,'index.json'))):null;
for(const [iso,name] of Object.entries(names)){
 const inherited=active?.countries?.find(c=>c.iso2===iso)?.path;
 const file=inherited&&fs.existsSync(path.join(dir,inherited))?path.join(dir,inherited):path.join(dir,iso+'.json');
 const legacy=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{iso2:iso,name_en:name,history:[]};
 const row=data[iso];const counts={R1:row?.r1_security??0,R2:row?.r2_living_count??0,R3:row?.r3_governance??0,R4:row?.r4_fiscal_count??0};
 const refs=matchedReferences(observed,paired,start.toISOString().slice(0,10),iso,{dates,required_days:4,expected_slots:672,method:'same-offset-observed-7d-pairs-v2'});
 const blocks={R1:'r1_security',R2:'r2_living',R3:'r3_governance',R4:'r4_fiscal'};
 const bundleCount=Object.entries(counts).filter(([key,count])=>count>=config[blocks[key]].absolute_threshold || count>=config.gating.low_abs.floors[key]*3.5 && count/(row?.event_count || Infinity)>=config[blocks[key]].ratio_threshold).length;
 const initial=bundleCount>=3?'red':bundleCount>=2?'orange':bundleCount && row?.avg_tone<=config.tone.mild_threshold?'yellow':'green';
 const evaluation=evaluateMonitoring(row,input,{level:initial},refs,[],config);
 evaluation.method=evaluation.method.replace('v2','v2-weekly');
 const item={week,method:'gdelt-events-calendar-v2-weekly',reconstruction:'Retrospective archive computation; not a prediction or publication made at that time',window:input.window,source_status:input.source_status,coverage:input.coverage,event_count:row?.event_count??0,
   counts,ratios:Object.fromEntries(Object.entries(refs).map(([key,r])=>[key,r.ratio])),levels:Object.fromEntries(Object.entries(evaluation.components).map(([key,r])=>[key,r.level])),
   overall_level:evaluation.level,evaluation,baseline_status:Object.values(refs).some(r=>r.is_stable_input)?'matching_7d_comparison_available':'matching_7d_comparison_insufficient',
   meaning:'Exact7d canonical observations; counts/composition startup plus4 of previous8 matched7d weeks. Absolute count thresholds are scaled for7d, observed counts are never extrapolated.',weekly_surge_r_by_type:{}};
 for(const [type,r] of Object.entries(refs))item.weekly_surge_r_by_type[type]={today7:r.today,observed_today7:r.observed_today,baseline7:r.baseline_median,ratio7:r.ratio,is_active:r.is_active,reason:r.data_status,level:evaluation.components[type].level,reference:r.reference,method:r.method};
 const history=legacy.history.filter(h=>h.week!==week).map(h=>({...h,method:h.method||'legacy-weekly;not-comparable-to-v2'}));history.push(item);history.sort((a,b)=>a.week.localeCompare(b.week));
 const value={...legacy,generated_at:new Date().toISOString(),latest_completed_week:week,epoch,source_status:input.source_status,coverage:input.coverage,window:input.window,history,weeks_total:history.length,
   legacy_warning:'Legacy ratio histories use a different population/baseline and are not v2 comparisons'};
 const payload=JSON.stringify(value,null,2)+'\n',target=path.join(release,iso+'.json');
 fs.writeFileSync(target+'.pending',payload);fs.renameSync(target+'.pending',target);
 countries.push({iso2:iso,name_en:name,weeks:history.length,latest_completed_week:week,source_status:item.source_status,
   path:'releases/'+epoch+'/'+iso+'.json',sha256:crypto.createHash('sha256').update(payload).digest('hex')});
}
const index={generated_at:new Date().toISOString(),latest_completed_week:week,epoch,window:input.window,source_status:input.source_status,coverage:input.coverage,countries};
fs.writeFileSync(path.join(release,'index.json'),JSON.stringify(index,null,2)+'\n');
fs.writeFileSync(path.join(dir,'index.json.pending'),JSON.stringify(index,null,2)+'\n');fs.renameSync(path.join(dir,'index.json.pending'),path.join(dir,'index.json'));
console.log(JSON.stringify({status:'generated',week,countries:countries.length,source_status:input.source_status}));
