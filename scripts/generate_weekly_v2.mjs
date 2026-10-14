import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {aggregateToIso2,loadCountryNameMap} from './fips_to_iso2.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const i=process.argv.indexOf('--input');if(i<0)throw new Error('--input required');
const input=JSON.parse(fs.readFileSync(process.argv[i+1]));
const start=new Date(input.window.start_utc),end=new Date(input.window.end_utc);
if(end-start!==7*86400000||start.getUTCDay()!==1||end.getUTCDay()!==1||start.getUTCHours()||end.getUTCHours())throw new Error('Weekly window must be one completed ISO week');
const thursday=new Date(start.getTime()+3*86400000);const year=thursday.getUTCFullYear();
const jan4=new Date(Date.UTC(year,0,4));const first=new Date(jan4.getTime()-((jan4.getUTCDay()+6)%7)*86400000);
const week=year+'-W'+String(Math.round((start-first)/(7*86400000))+1).padStart(2,'0');
const {data}=aggregateToIso2(input.countries),names=loadCountryNameMap(),dir=path.join(root,'public/data/history/weekly_5y');
const epoch=week+'-'+crypto.createHash('sha256').update(JSON.stringify(input)+fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0,20);
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
 const row=data[iso];const counts=row?{R1:row.r1_security,R2:row.r2_living_count,R3:row.r3_governance,R4:row.r4_fiscal_count}:null;
 const item={week,method:'gdelt-events-calendar-v2-weekly',window:input.window,
   source_status:row?input.source_status:'unknown',coverage:input.coverage,event_count:row?.event_count??null,
   counts,ratios:{R1:null,R2:null,R3:null,R4:null},levels:{R1:'NoData',R2:'NoData',R3:'NoData',R4:'NoData'},
   overall_level:'NoData',baseline_status:'matching_7d_baseline_unavailable',
   meaning:'7-day Event table records; no multiplication of a 48h baseline into7d',weekly_surge_r_by_type:{}};
 for(const type of ['R1','R2','R3','R4'])item.weekly_surge_r_by_type[type]={today7:counts?.[type]??null,baseline7:null,ratio7:null,is_active:false,reason:'matching_7d_baseline_unavailable',level:'NoData'};
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
