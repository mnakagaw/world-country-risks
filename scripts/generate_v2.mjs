import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {aggregateToIso2,fipsToIso2,loadCountryNameMap} from './fips_to_iso2.js';
import scoring,{scoreAllCountries} from './scoring.mjs';
import {VERSION,METHOD,reference,assessCoverage,ratioRecord,bindExplanation,hash,latestCompletedWeek,verifyImpact} from './engine_v2.mjs';
import {aggregateObservation,matchedReferences,evaluateMonitoring} from './monitoring_v2.mjs';
import {countryName} from '../src/country-codes.js';
import {assessRIndex,validateRIndexConfig} from './rindex_v2.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bytesHash=value=>crypto.createHash('sha256').update(value).digest('hex');
const computationHash=bytesHash(['scripts/generate_v2.mjs','scripts/engine_v2.mjs','scripts/monitoring_v2.mjs','scripts/rindex_v2.mjs','scripts/r_bundles.mjs','scripts/scoring.mjs','scripts/fips_to_iso2.js','src/country-codes.js','config/scoring.json','config/r_definitions.json'].map(p=>bytesHash(fs.readFileSync(path.join(root,p)))).join('|'));
const arg=key=>{const i=process.argv.indexOf(key);return i>=0?process.argv[i+1]:null;};
const inputPath=arg('--input');if(!inputPath)throw new Error('--input private shared-source DTO required');
const raw=fs.readFileSync(inputPath),input=JSON.parse(raw);
const historical=process.argv.includes('--historical');
if(historical&&!input.upstream_sync?.historical_recovery)throw Error('Historical generation requires verified original-edition recovery binding');
const verifiedPath=arg('--verified-impacts'),verifiedRaw=verifiedPath?fs.readFileSync(verifiedPath):Buffer.from('[]');
const verifiedHash=bytesHash(verifiedRaw);
const contextPath=path.join(path.dirname(verifiedPath || inputPath),'article-classification-context.json');
const contextRaw=fs.existsSync(contextPath)?fs.readFileSync(contextPath):Buffer.from('{}'),contextHash=bytesHash(contextRaw),articleContext=JSON.parse(contextRaw);
if(input.schema!=='country-risk-observations-v2'||input.code_system!=='FIPS 10-4'||!input.cutoff_utc||!['complete','partial'].includes(input.source_status))throw new Error('Invalid source contract');
if(Date.parse(input.window?.end_utc)-Date.parse(input.window?.start_utc)!==48*3600000||input.window?.semantics!=='[start,end)'||input.window?.time_field!=='DATEADDED')throw new Error('Source population/window must be the fixed48h DATEADDED contract');
const date=input.edition_date,dir=path.resolve(arg('--output-dir')||path.join(root,'public/data/v2')),historyPath=path.resolve(arg('--history')||path.join(root,'.local/v2-history.json'));
if(input.cutoff_series==='execbrief-03-v1' && (!input.cutoff_utc.endsWith('18:00:00Z') || !input.upstream_sync || input.upstream_sync.date!==date || input.upstream_sync.cutoff_utc!==input.cutoff_utc))throw Error('ExecBrief synchronization binding mismatch');
fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.dirname(historyPath),{recursive:true});
const history=fs.existsSync(historyPath)?JSON.parse(fs.readFileSync(historyPath)):{};
const priorHistory=Object.fromEntries(Object.entries(history).filter(([day])=>day>=new Date(Date.parse(date)-14*86400000).toISOString().slice(0,10)&&day<date));
if(input.cutoff_series==='execbrief-03-v1' && Object.values(priorHistory).some(h=>!h.cutoff_utc?.endsWith('18:00:00Z')))throw Error('Old05:00 baselines cannot enter the03:00 series');
const baselineHash=hash(priorHistory);
if(history[date]?.input_sha256===bytesHash(raw)&&history[date]?.computation_sha256===computationHash&&history[date]?.verified_input_sha256===verifiedHash&&history[date]?.annotation_input_sha256===contextHash&&history[date]?.baseline_input_sha256===baselineHash){
    console.log(JSON.stringify({status:'reused',snapshot_id:history[date].snapshot_id,history_days:Object.keys(history).length}));process.exit(0);
}
const observed=aggregateObservation(input),data=observed.data,names=loadCountryNameMap();
const scoringConfig=JSON.parse(fs.readFileSync(path.join(root,'config/scoring.json')));
validateRIndexConfig(scoringConfig);
const oldHistory={};for(const [day,item] of Object.entries(history))if(item.method===METHOD&&item.coverage==='complete')oldHistory[day]=item.countries;
scoring.loadHistoricalData(oldHistory);
const scored=scoreAllCountries(data,{date}).results;
const urls={};for(const [code,items] of Object.entries(input.source_urls||{})){
    const iso=fipsToIso2(code).iso2;if(iso)urls[iso]=[...(urls[iso]||[]),...items];
}
const output={schema:'country-risk-snapshot-v2',engine_version:VERSION,method:METHOD,date,
    cutoff_utc:input.cutoff_utc,generated_at:new Date().toISOString(),window:input.window,cutoff_series:input.cutoff_series||'legacy-05-v1',upstream_sync:input.upstream_sync||null,
    source_status:input.source_status,coverage:input.coverage,support_evidence:input.support_evidence,
    input_sha256:bytesHash(raw),verified_input_sha256:verifiedHash,annotation_input_sha256:contextHash,baseline_input_sha256:baselineHash,computation_sha256:computationHash,source_manifest_sha256:input.source_manifest_sha256,
    method_change:input.cutoff_series==='execbrief-03-v1'?'ExecBrief03:00 synchronization revision; old05:00 source/history preserved in a separate series, not day-to-day deterioration':'v2 separate series; no day-to-day comparison to legacy or mismatched baselines',
    metric:'GDELT Event table monitoring signals; not verified incident totals or measured state capacity',
    google_trends:[],polymarket:[],countries:{},confirmed_impacts:[],
    daily_briefing_ops:{en:'News-derived monitoring signals. Search interest and verified impact are separate.',ja:'報道由来の監視信号です。検索関心と確認済みの実影響は別に表示します。',es:'Señales de seguimiento derivadas de noticias. El interés de búsqueda y los impactos verificados se muestran por separado.'}};
const comparisonAudit={};
output.source_ledger=articleContext?.source_ledger || [];
output.search_interest_daily=articleContext?.search_interest_daily || null;
if(verifiedPath){const events=JSON.parse(verifiedRaw);const seen=new Set();
  for(const event of events){const valid=verifyImpact(event,input.window,arg('--verification-root'));if(seen.has(valid.event_id))continue;seen.add(valid.event_id);output.confirmed_impacts.push(valid);}}
for(const [iso,name] of Object.entries(names)){
    const row=data[iso],sourceState=assessCoverage(row,input),signal=scored[iso];
    const comparisons=matchedReferences(observed,priorHistory,date,iso,{config:scoringConfig});
    const rindex=assessRIndex(row,input,comparisons,scoringConfig),byType=rindex.by_type;
    comparisonAudit[iso]=structuredClone(byType);
    for(const record of Object.values(byType))delete record.reference.pairs;
    const active=rindex.active_types,availableTypes=rindex.available_types;
    const comparable=availableTypes.length>0;
    const ratio=rindex.max_ratio_active;
    const valid=sourceState==='observed';
    const detected=['red','orange','yellow'].includes(signal?.level) && (row?.event_count??0)>=200;
    const impacts=output.confirmed_impacts.filter(event=>event.country===iso);
    const evaluation=evaluateMonitoring(row,input,signal,byType,impacts,scoringConfig);
    const level=evaluation.level;
    const rnames={R1:'Violence / coercion records',R2:'Living / humanitarian records',R3:'Governance / political confrontation records',R4:'Aid / sanctions / economic pressure records'};
    const sources=[...new Map((urls[iso]||[]).map(s=>[s.url,s])).values()].slice(0,5).map(s=>({...s,title:'GDELT discovery: '+new URL(s.url).hostname,sourceorg:new URL(s.url).hostname}));
    const counts=row||{};
    const explain=bindExplanation(iso,{level,by_type:byType},sources.map(s=>s.url),input.window);
    const drivers=Object.entries(evaluation.components).filter(([,r])=>['red','orange','yellow'].includes(r.level)).map(([r])=>r).join(', ')||'—';
    const text={en:`48h: ${counts.event_count??0} observed records; elevated components: ${drivers}. ${availableTypes.length}/4 comparisons available. ${impacts.some(e=>e.assessment?.current_at_cutoff)?'Confirmed disruption within the stated service scope.':''}`,
      ja:`固定48時間：観測記録${counts.event_count??0}件。上昇信号の指標：${drivers}。比較可能な指標${availableTypes.length}/4。${impacts.some(e=>e.assessment?.current_at_cutoff)?'明記されたサービス範囲の障害を確認。':''}`,
      es:`48h: ${counts.event_count??0} registros observados; indicadores elevados: ${drivers}. ${availableTypes.length}/4 comparaciones disponibles. ${impacts.some(e=>e.assessment?.current_at_cutoff)?'Interrupción confirmada en el servicio indicado.':''}`};
    output.countries[iso]={code:iso,iso2:iso,name_en:name,name_ja:countryName(iso,'ja',name),name_es:countryName(iso,'es',name),
      alert_level:level,monitoring_level:level,evaluation,rindex_evaluation:{...rindex,by_type:undefined},data_status:sourceState,confidence:evaluation.confidence,composite_score:evaluation.display_score,
      baseline_status:availableTypes.length===4?'observed':comparable?'partial_comparison':'baseline_insufficient',comparison_to_previous:null,
      summary_en:text.en,summary_ja:text.ja,summary_es:text.es,
      mode_summaries:{surge_r:{en:`R-INDEX: ${rindex.level}; active R: ${active.join(', ')||'none'}; comparable R: ${availableTypes.join(', ')||'none'}. Active maximum: ${ratio??'unavailable'}.`,ja:`R-INDEX：${rindex.level}。発火した指標：${active.join(', ')||'なし'}。比較可能：${availableTypes.join(', ')||'なし'}。発火指標の最大倍率：${ratio??'比較不能'}。`,es:`R-INDEX: ${rindex.level}; activos: ${active.join(', ')||'ninguno'}; comparables: ${availableTypes.join(', ')||'ninguno'}. Máximo activo: ${ratio??'no disponible'}.`}},
      brief:{headline:text.en,what_happened:text.en,confidence:evaluation.confidence,sources:sources.map(s=>s.url)},
      explanation:explain,sources,gdelt:{...counts,domain_support:undefined,event_count:counts.event_count??0,observed_count_status:(counts.event_count??0)===0?'observed_zero':'observed',total_window_estimate:null,avg_tone:counts.avg_tone??null},
      article_interpretations:(articleContext?.articles || []).filter(a=>a.country_locator===iso).map(a=>({article_id:a.stable_article_id,url:a.canonical_url,event_id:a.event_id,title_localized:a.title_localized,summary_localized:a.translations,verification:a.body_verification,claims:a.r_claims.map(({original_excerpt_anchor,...claim})=>claim),body_sha256:a.body_sha256,policy_sha256:a.policy_sha256,source_publication_day:a.source_publication_day,scope_role:a.counts_role,public_reaction:'not_established'})),
      v4_scoring:signal||{level:'unknown',reason:'no_data',bundles:0},
      r_scores:signal?.r_scores_adj||{},r_scores_raw:signal?.r_scores_raw||{},
      index:{level:level,score:evaluation.display_score,method:evaluation.method,unit:evaluation.score_unit},
      surge_r:{level:rindex.level,max_ratio_active:ratio,max_ratio_observed:rindex.max_ratio_observed,active_types:active,bundle_count:active.length,available_types:availableTypes,thresholds:rindex.thresholds,method:rindex.method,color_role:rindex.color_role},
      practical_alert:{active_types:active,detection_window:input.window,detection_time_basis:'Model observation window/cutoff, not event onset or predictive accuracy',unassessed_types:rindex.unevaluated_types},
      surge_r_by_type:byType,r_signal_labels:rnames,
      history_reference:reference(history,date,iso,'event_count'),
      weekly_history:{weeks:[],pattern:{overall:'unknown'},window:latestCompletedWeek(input.cutoff_utc),
        source:'history/weekly_5y',method:'legacy_history_not_comparable_to_v2'}};
}
for(const [country,value] of Object.entries(output.countries))value.confirmed_impacts=output.confirmed_impacts.filter(e=>e.country===country);
const levels={red:0,orange:0,yellow:0,green:0,unknown:0};for(const row of Object.values(output.countries))levels[row.monitoring_level]++;
const leaders=Object.values(output.countries).filter(c=>c.monitoring_level==='red').map(c=>c.code).join(', ')||'—';
const currentImpacts=output.confirmed_impacts.filter(e=>e.assessment?.current_at_cutoff).map(e=>`${e.country}: ${e.scope}`).join('; ')||'—';
output.monitoring_counts=levels;
output.national_functional_assessment={status:'not_assessed',method_status:'research_and_design_review_only',reason:'News counts/ratios and operator-scoped incidents do not establish national political-goods delivery or response capacity'};
output.mode_counts={};for(const mode of ['surge_r','raw','monitoring']){
 const counts={red:0,orange:0,yellow:0,green:0,unknown:0};
 for(const row of Object.values(output.countries))counts[mode==='surge_r'?row.rindex_evaluation.level:mode==='raw'?row.evaluation.initial_level:row.monitoring_level]++;
 output.mode_counts[mode]=counts;
}
output.daily_briefing_rindex={};for(const [lang,label] of Object.entries({ja:'R-INDEX：同じ取得時間枠の比較・旧guard適用後',en:'R-INDEX: matched-time comparison with restored guards',es:'R-INDEX: comparación coincidente con controles restaurados'})){
 const c=output.mode_counts.surge_r;
 output.daily_briefing_rindex[lang]=[`${label} · Red ${c.red} / Orange ${c.orange} / Yellow ${c.yellow} / Green ${c.green} / Unknown ${c.unknown}`,
  {ja:'緑は比較可能な指標に発火なし。比較不能の指標は未評価で、国の安全を意味しません。確認済み影響は別欄・総合監視に表示します。',en:'Green means no guard-qualified activation in available comparisons. Unavailable components remain unassessed. Accepted impacts belong to the separate monitoring view.',es:'Verde indica ausencia de activación válida entre indicadores comparables. Los faltantes quedan sin evaluar. Los impactos confirmados se presentan en seguimiento integral.'}[lang]];
}
output.daily_briefing_raw={};for(const [lang,label] of Object.entries({ja:'RAW：観測の絶対数・構成比による初期評価',en:'RAW: initial observed counts and composition',es:'RAW: conteos y composición observados'})){
 const c=output.mode_counts.raw;output.daily_briefing_raw[lang]=[`${label} · Red ${c.red} / Orange ${c.orange} / Yellow ${c.yellow} / Green ${c.green} / Unknown ${c.unknown}`];
}
output.daily_briefing_ops={
 ja:[`固定48時間：取得${input.coverage.available_slots}/${input.coverage.expected_slots}枠。赤${levels.red}・橙${levels.orange}・黄${levels.yellow}・緑${levels.green}・判定不能${levels.unknown}。赤の対象：${leaders}。`,`絶対数・構成比による初期評価に、同じ取得時間枠の比較と確認済み影響を追加。最近の確認資料（サービス範囲限定）：${currentImpacts}。`,`緑は条件を満たす観測範囲で上昇信号なし。欠測部分は未評価で、国全体の安全・国家機能・財政能力を示しません。`],
 en:[`Fixed48h: ${input.coverage.available_slots}/${input.coverage.expected_slots} source slots. Red ${levels.red}; orange ${levels.orange}; yellow ${levels.yellow}; green ${levels.green}; unknown ${levels.unknown}. Red: ${leaders}.`,`Counts/composition startup assessment, with qualified matched-time comparisons and accepted scoped impacts. Recent accepted statements (service scope only): ${currentImpacts}.`,`Green means no elevated signal in a qualified observed sample. Missing portions remain unassessed; no claim about national safety, state functions or fiscal capacity.`],
 es:[`Ventana fija48h: ${input.coverage.available_slots}/${input.coverage.expected_slots} intervalos. Rojo ${levels.red}; naranja ${levels.orange}; amarillo ${levels.yellow}; verde ${levels.green}; sin evaluación ${levels.unknown}. Rojo: ${leaders}.`,`Evaluación inicial por conteos y composición, con comparaciones coincidentes e impactos confirmados de alcance explícito. Fuentes recientes aceptadas (alcance de servicio): ${currentImpacts}.`,`Verde significa sin señal elevada en la muestra suficiente. Los faltantes quedan sin evaluar; no demuestra seguridad nacional, funciones estatales ni capacidad fiscal.`]};
// The public projection never publishes input artifact paths, full observations,
// review bodies, Google raw feeds or authentication settings.
output.snapshot_id=hash(output);
const auditDir=path.resolve(arg('--audit-dir')||path.join(root,'.local/comparison-audits'));fs.mkdirSync(auditDir,{recursive:true});
fs.writeFileSync(path.join(auditDir,output.snapshot_id+'.json'),JSON.stringify({snapshot_id:output.snapshot_id,input_sha256:output.input_sha256,baseline_input_sha256:baselineHash,countries:comparisonAudit})+'\n');
const render=JSON.stringify(output,null,2)+'\n';
function atomic(target,text){const tmp=target+'.pending';fs.writeFileSync(tmp,text);fs.renameSync(tmp,target);}
const revisionPath=path.join(dir,output.snapshot_id+'.json');if(!fs.existsSync(revisionPath))atomic(revisionPath,render);
const existing=history[date];
// Exact same input is idempotent; source corrections are new snapshot IDs.
history[date]={method:METHOD,coverage:input.source_status,cutoff_utc:input.cutoff_utc,
  input_sha256:output.input_sha256,verified_input_sha256:verifiedHash,annotation_input_sha256:contextHash,baseline_input_sha256:baselineHash,computation_sha256:computationHash,countries:data,quarters:observed.quarters,offsets:observed.offsets,source_coverage:input.coverage,snapshot_id:output.snapshot_id};
atomic(historyPath,JSON.stringify(history,null,2)+'\n');
const manifestPath=path.join(dir,'manifest.json');
const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath)):{};
manifest[date]={snapshot_id:output.snapshot_id,path:output.snapshot_id+'.json',sha256:bytesHash(render),method:METHOD,cutoff_utc:input.cutoff_utc};
atomic(manifestPath,JSON.stringify(manifest,null,2)+'\n');
if(!historical){atomic(path.join(dir,'latest.json'),render);
atomic(path.join(dir,'status.json'),JSON.stringify({engine_version:VERSION,date,cutoff_utc:input.cutoff_utc,
  source_status:input.source_status,last_success_at:output.generated_at,snapshot_id:output.snapshot_id,
  expected_slots:input.coverage.expected_slots,available_slots:input.coverage.available_slots},null,2)+'\n');}
console.log(JSON.stringify({status:'generated',engine_version:VERSION,snapshot_id:output.snapshot_id,
  source_status:input.source_status,countries:Object.keys(output.countries).length,
  history_days:Object.keys(history).length,previous_same_input:existing?.input_sha256===output.input_sha256}));
