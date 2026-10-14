import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {aggregateToIso2,fipsToIso2,loadCountryNameMap} from './fips_to_iso2.js';
import scoring,{scoreAllCountries} from './scoring.mjs';
import {VERSION,METHOD,reference,assessCoverage,ratioRecord,bindExplanation,hash,latestCompletedWeek,verifyImpact} from './engine_v2.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bytesHash=value=>crypto.createHash('sha256').update(value).digest('hex');
const computationHash=bytesHash(['scripts/generate_v2.mjs','scripts/engine_v2.mjs','scripts/scoring.mjs','scripts/fips_to_iso2.js','config/scoring.json','config/r_definitions.json'].map(p=>bytesHash(fs.readFileSync(path.join(root,p)))).join('|'));
const arg=key=>{const i=process.argv.indexOf(key);return i>=0?process.argv[i+1]:null;};
const inputPath=arg('--input');if(!inputPath)throw new Error('--input private shared-source DTO required');
const raw=fs.readFileSync(inputPath),input=JSON.parse(raw);
const verifiedPath=arg('--verified-impacts'),verifiedRaw=verifiedPath?fs.readFileSync(verifiedPath):Buffer.from('[]');
const verifiedHash=bytesHash(verifiedRaw);
if(input.schema!=='country-risk-observations-v2'||input.code_system!=='FIPS 10-4'||!input.cutoff_utc||!['complete','partial'].includes(input.source_status))throw new Error('Invalid source contract');
if(Date.parse(input.window?.end_utc)-Date.parse(input.window?.start_utc)!==48*3600000||input.window?.semantics!=='[start,end)'||input.window?.time_field!=='DATEADDED')throw new Error('Source population/window must be the fixed48h DATEADDED contract');
const date=input.edition_date,dir=path.join(root,'public/data/v2'),historyPath=path.join(root,'.local/v2-history.json');
fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.dirname(historyPath),{recursive:true});
const history=fs.existsSync(historyPath)?JSON.parse(fs.readFileSync(historyPath)):{};
if(history[date]?.input_sha256===bytesHash(raw)&&history[date]?.computation_sha256===computationHash&&history[date]?.verified_input_sha256===verifiedHash){
    console.log(JSON.stringify({status:'reused',snapshot_id:history[date].snapshot_id,history_days:Object.keys(history).length}));process.exit(0);
}
const {data}=aggregateToIso2(input.countries),names=loadCountryNameMap();
const oldHistory={};for(const [day,item] of Object.entries(history))if(item.method===METHOD&&item.coverage==='complete')oldHistory[day]=item.countries;
scoring.loadHistoricalData(oldHistory);
const scored=scoreAllCountries(data,{date}).results;
const urls={};for(const [code,items] of Object.entries(input.source_urls||{})){
    const iso=fipsToIso2(code).iso2;if(iso)urls[iso]=[...(urls[iso]||[]),...items];
}
const output={schema:'country-risk-snapshot-v2',engine_version:VERSION,method:METHOD,date,
    cutoff_utc:input.cutoff_utc,generated_at:new Date().toISOString(),window:input.window,
    source_status:input.source_status,coverage:input.coverage,
    input_sha256:bytesHash(raw),verified_input_sha256:verifiedHash,computation_sha256:computationHash,source_manifest_sha256:input.source_manifest_sha256,
    method_change:'v2 separate series; no day-to-day comparison to legacy or mismatched baselines',
    metric:'GDELT Event table monitoring signals; not verified incident totals or measured state capacity',
    google_trends:[],polymarket:[],countries:{},confirmed_impacts:[],
    daily_briefing_ops:{en:'News-derived monitoring signals. Search interest and verified impact are separate.',ja:'報道由来の監視信号です。検索関心と確認済みの実影響は別に表示します。',es:'Señales de seguimiento derivadas de noticias. El interés de búsqueda y los impactos verificados se muestran por separado.'}};
for(const [iso,name] of Object.entries(names)){
    const row=data[iso],sourceState=assessCoverage(row,input),signal=scored[iso];
    const byType={};for(const [type,metric] of Object.entries({R1:'r1_security',R2:'r2_living_count',R3:'r3_governance',R4:'r4_fiscal_count'}))
        byType[type]=ratioRecord(row?.[metric]??null,reference(history,date,iso,metric));
    const active=Object.entries(byType).filter(([,v])=>v.is_active).map(([k])=>k);
    const comparable=Object.values(byType).every(v=>v.is_stable_input);
    const ratio=comparable?Math.max(...Object.values(byType).map(v=>v.ratio)):null;
    const valid=sourceState==='observed';
    const detected=['red','orange','yellow'].includes(signal?.level) && (row?.event_count??0)>=200;
    const level=(valid||sourceState==='partial'&&detected)?signal?.level||'unknown':'unknown';
    const ratioLevel=valid&&comparable?(ratio>=3.75?'Red':ratio>=2.75?'Orange':ratio>=1.75?'Yellow':'Green'):'Unknown';
    const rnames={R1:'Violence / coercion records',R2:'Living / humanitarian records',R3:'Governance / political confrontation records',R4:'Aid / sanctions / economic pressure records'};
    const sources=[...new Map((urls[iso]||[]).map(s=>[s.url,s])).values()].slice(0,5).map(s=>({...s,title:'GDELT discovery: '+new URL(s.url).hostname,sourceorg:new URL(s.url).hostname}));
    const counts=row||{};
    const explain=bindExplanation(iso,{level,by_type:byType},sources.map(s=>s.url),input.window);
    const text={en:`${sourceState}; ${counts.event_count??'unknown'} Event table records in the fixed48h window. Verified functional impacts are shown separately; reporting records alone do not confirm impact.`,
      ja:`データ状態：${sourceState}。固定48時間のEvent表レコード：${counts.event_count??'不明'}。確認済みの実影響は別欄に表示し、報道記録だけから実影響を確定しません。`,
      es:`Estado: ${sourceState}; ${counts.event_count??'desconocido'} registros Events en48h. Los impactos funcionales verificados se muestran aparte; los registros de noticias no los confirman.`};
    output.countries[iso]={code:iso,iso2:iso,name_en:name,name_ja:name,name_es:name,
      alert_level:level,data_status:sourceState,confidence:'low',composite_score:valid?signal?.score??0:null,
      baseline_status:comparable?'observed':'baseline_insufficient',comparison_to_previous:null,
      summary_en:text.en,summary_ja:text.ja,summary_es:text.es,
      brief:{headline:text.en,what_happened:text.en,confidence:'low',sources:sources.map(s=>s.url)},
      explanation:explain,sources,gdelt:{...counts,event_count:counts.event_count??null,avg_tone:counts.avg_tone??null},
      v4_scoring:signal||{level:'unknown',reason:'no_data',bundles:0},
      r_scores:signal?.r_scores_adj||{},r_scores_raw:signal?.r_scores_raw||{},
      index:{level:level,score:valid?signal?.score??0:null},
      surge_r:{level:ratioLevel,max_ratio_active:ratio,active_types:active,bundle_count:active.length},
      surge_r_by_type:byType,r_signal_labels:rnames,
      history_reference:reference(history,date,iso,'event_count'),
      weekly_history:{weeks:[],pattern:{overall:'unknown'},window:latestCompletedWeek(input.cutoff_utc),
        source:'history/weekly_5y',method:'legacy_history_not_comparable_to_v2'}};
}
if(verifiedPath){const events=JSON.parse(verifiedRaw);const seen=new Set();
  for(const event of events){const valid=verifyImpact(event,input.window,arg('--verification-root'));if(seen.has(valid.event_id))continue;seen.add(valid.event_id);output.confirmed_impacts.push(valid);}}
for(const [country,value] of Object.entries(output.countries))value.confirmed_impacts=output.confirmed_impacts.filter(e=>e.country===country);
// The public projection never publishes input artifact paths, full observations,
// review bodies, Google raw feeds or authentication settings.
output.snapshot_id=hash(output);
const render=JSON.stringify(output,null,2)+'\n';
function atomic(target,text){const tmp=target+'.pending';fs.writeFileSync(tmp,text);fs.renameSync(tmp,target);}
const revisionPath=path.join(dir,output.snapshot_id+'.json');if(!fs.existsSync(revisionPath))atomic(revisionPath,render);
const existing=history[date];
// Exact same input is idempotent; source corrections are new snapshot IDs.
history[date]={method:METHOD,coverage:input.source_status,cutoff_utc:input.cutoff_utc,
  input_sha256:output.input_sha256,verified_input_sha256:verifiedHash,computation_sha256:computationHash,countries:data,snapshot_id:output.snapshot_id};
atomic(historyPath,JSON.stringify(history,null,2)+'\n');
const manifestPath=path.join(dir,'manifest.json');
const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath)):{};
manifest[date]={snapshot_id:output.snapshot_id,path:output.snapshot_id+'.json',sha256:bytesHash(render),method:METHOD,cutoff_utc:input.cutoff_utc};
atomic(manifestPath,JSON.stringify(manifest,null,2)+'\n');
atomic(path.join(dir,'latest.json'),render);
atomic(path.join(dir,'status.json'),JSON.stringify({engine_version:VERSION,date,cutoff_utc:input.cutoff_utc,
  source_status:input.source_status,last_success_at:output.generated_at,snapshot_id:output.snapshot_id,
  expected_slots:input.coverage.expected_slots,available_slots:input.coverage.available_slots},null,2)+'\n');
console.log(JSON.stringify({status:'generated',engine_version:VERSION,snapshot_id:output.snapshot_id,
  source_status:input.source_status,countries:Object.keys(output.countries).length,
  history_days:Object.keys(history).length,previous_same_input:existing?.input_sha256===output.input_sha256}));
