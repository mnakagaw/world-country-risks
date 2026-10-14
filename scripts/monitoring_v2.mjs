import { aggregateToIso2, fipsToIso2 } from './fips_to_iso2.js';
import { calendarDates,METHOD } from './engine_v2.mjs';
import fs from 'node:fs';
import {bundleLevel} from './r_bundles.mjs';
const DEFAULT_CONFIG=JSON.parse(fs.readFileSync(new URL('../config/scoring.json',import.meta.url)));

export const METRICS = { R1: 'r1_security', R2: 'r2_living_count', R3: 'r3_governance', R4: 'r4_fiscal_count' };
const ORDER = { unknown: -1, green: 0, yellow: 1, orange: 2, red: 3 };
const median = values => { const a = [...values].sort((x,y)=>x-y), i=Math.floor(a.length/2); return a.length ? a.length%2 ? a[i] : (a[i-1]+a[i])/2 : null; };
const instant = value => /^\d{14}$/.test(value || '') ? Date.UTC(+value.slice(0,4),+value.slice(4,6)-1,+value.slice(6,8),+value.slice(8,10),+value.slice(10,12),+value.slice(12,14)) : NaN;

export function aggregateObservation(input) {
    const { data, stats } = aggregateToIso2(input.countries || {});
    const seen = {};
    for (const [code, sample] of Object.entries(input.samples || {})) {
        const iso = fipsToIso2(code).iso2; if (!iso) continue;
        const target = seen[iso] ||= { hours:new Set(), domains:new Set(), urls:new Set(), first:Infinity, last:-Infinity };
        for (const hour of sample.hours || []) target.hours.add(hour);
        for (const domain of sample.domains || []) target.domains.add(domain);
        for (const url of sample.url_hashes || []) target.urls.add(url);
        target.first = Math.min(target.first,instant(sample.first_added));target.last = Math.max(target.last,instant(sample.last_added));
    }
    for (const [iso,row] of Object.entries(data)) {
        const sample=seen[iso]; row.observation_quality=sample ? { observed_hours:sample.hours.size,
            source_domains:sample.domains.size,source_urls:sample.urls.size,
            span_hours:(sample.last-sample.first)/3600000 } : {observed_hours:0,source_domains:0,source_urls:0,span_hours:0};
    }
    for(const [code,types] of Object.entries(input.r_support || {})){
        const iso=fipsToIso2(code).iso2;if(!iso || !data[iso])continue;
        const support=data[iso].domain_support ||= {};
        for(const [type,item] of Object.entries(types)){
            const target=support[type] ||= {exclusive_count:0,article_keys:[],examples:[]};target.exclusive_count+=item.exclusive_count;
            target.article_keys=[...new Set([...target.article_keys,...item.article_keys])].sort();target.examples=[...new Set([...target.examples,...item.examples])].sort().slice(0,3);
        }
    }
    const quarters={};for(const [offset,rows] of Object.entries(input.quarter_counts || {}))quarters[offset]=aggregateToIso2(rows).data;
    const start=Date.parse(input.window.start_utc);
    const offsets=(input.input_artifacts || []).filter(row=>row.status==='available' && row.rows_rejected===0)
        .map(row=>Math.round((Date.parse(row.slot)-start)/900000));
    return {data,stats,quarters,offsets};
}

export function temporalQuality(input) {
    const expected=input.coverage?.expected_slots || 0, available=input.coverage?.available_slots || 0;
    let longest=0,gap=0,last=-1;
    for(const [index,row] of (input.input_artifacts || []).entries()) {
        gap=row.status==='available' ? 0 : gap+1;longest=Math.max(longest,gap);
        if(row.status==='available')last=index;
    }
    return {available_slots:available,expected_slots:expected,fraction:expected ? available/expected : 0,
        longest_gap_minutes:longest*15,last_source_age_minutes:last<0 ? Infinity : (expected-last)*15,
        rejected_rows:input.coverage?.rejected_rows || 0,source_status:input.source_status};
}

// Compare canonical observations from exactly the same archive-time offsets in
// each 48h pair. No missing slot becomes zero; no observed count is scaled up.
export function matchedReferences(current,history,date,country,policy={}) {
    const config=policy.config || DEFAULT_CONFIG,settings=config.surge_r;
    const k=settings.smoothing_k,minBaseline=settings.min_baseline_median_for_surge;
    const pairs=[];const currentOffsets=new Set(current.offsets);
    const dates=policy.dates || calendarDates(date,14),required=policy.required_days || 10,expected=policy.expected_slots || 192;
    for(const day of dates) {
        const past=history[day];if(!past?.quarters || !past.offsets)continue;
        if(past.method && past.method!==METHOD)continue;
        const shared=past.offsets.filter(offset=>currentOffsets.has(offset));
        if(shared.length<expected/2)continue;
        const totals={current:{event_count:0},baseline:{event_count:0}};
        for(const side of Object.values(totals))for(const metric of Object.values(METRICS))side[metric]=0;
        for(const offset of shared) {
            for(const [side,source] of [['current',current],['baseline',past]]) {
                const row=source.quarters[offset]?.[country];
                // A country absent from a verified observed quarter has zero
                // records IN THAT QUARTER, not an estimated zero in a missing one.
                for(const key of ['event_count',...Object.values(METRICS)])totals[side][key]+=row?.[key] || 0;
            }
        }
        pairs.push({day,matched_slots:shared.length,...totals});
    }
    const records={};
    for(const [type,metric] of Object.entries(METRICS)) {
        const baseline=median(pairs.map(pair=>pair.baseline[metric]));
        const enough=pairs.length>=required && baseline!==null && baseline>=minBaseline;
        const ratio=enough ? median(pairs.map(pair=>(pair.current[metric]+k)/(Math.max(1,pair.baseline[metric])+k))) : null;
        records[type]={today:median(pairs.map(pair=>pair.current[metric])),observed_today:current.data[country]?.[metric] ?? 0,
            baseline_median:baseline,ratio,is_active:false,ratio_threshold_hit:ratio!==null && ratio>=settings.thresholds.yellow,is_stable_input:enough,smoothing_k:k,min_baseline:minBaseline,
            data_status:enough ? 'matched_observations' : pairs.length<required ? 'baseline_days_insufficient' : 'low_or_zero_baseline',
            method:policy.method || 'same-offset-observed-pairs-v2',reference:{start:dates[0],end:dates.at(-1),required_days:required,
                valid_days:pairs.length,valid_dates:pairs.map(pair=>pair.day),
                matched_slots_min:pairs.length ? Math.min(...pairs.map(pair=>pair.matched_slots)) : 0,
                matched_slots_max:pairs.length ? Math.max(...pairs.map(pair=>pair.matched_slots)) : 0,
                expected_slots:expected,unit:'Observed canonical Event records in matched source-time offsets; not full-window estimated totals',
                pairs:pairs.map(pair=>({date:pair.day,slots:pair.matched_slots,today:pair.current[metric],baseline:pair.baseline[metric]}))}};
    }
    return records;
}

export function evaluateMonitoring(row,input,scored,byType,impacts=[],config={}) {
    const thresholds=(config.surge_r || DEFAULT_CONFIG.surge_r).thresholds;
    const temporal=temporalQuality(input),quality=row?.observation_quality || {};
    const scale=Math.max(1,temporal.expected_slots/192);
    const n=row?.event_count ?? 0;const reasons=[];
    // Majority opportunity coverage plus temporal spread and source diversity.
    // This defines a conditional news-monitoring sample, never national safety.
    const timeReady=temporal.fraction>=0.5 && temporal.longest_gap_minutes<=180 && temporal.last_source_age_minutes<=180 && !temporal.rejected_rows;
    const diversityReady=quality.source_urls>=10 && quality.source_domains>=3 && quality.observed_hours>=8*scale && quality.span_hours>=24*scale;
    const sampleReady=timeReady && diversityReady && n>=50*scale;
    const greenReady=sampleReady && n>=200*scale && quality.source_urls>=20 && quality.source_domains>=5 && quality.observed_hours>=12*scale &&
        (row.tone_count || 0)/n>=0.8 && (row.denom_actor_geo || 0)>=50;
    let initial='unknown';
    const components={};
    for(const [type,metric] of Object.entries(METRICS)) {
        const count=row?.[metric] ?? 0,base=byType[type];
        const block=config[{R1:'r1_security',R2:'r2_living',R3:'r3_governance',R4:'r4_fiscal'}[type]] || {};
        const floor=(config.gating?.low_abs?.floors?.[type] || 10)*scale;
        const share=n ? count/n : null;
        // Startup path retains inherited count/share thresholds. The small-
        // sample path uses a Wilson-shaped conservative share guard. Event
        // records cluster by reporting; this is not a95% inference guarantee.
        const p=share || 0,z=1.96,den=1+z*z/Math.max(1,n);
        const lower=n ? (p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/den : null;
        const absolute=count>=(block.absolute_threshold || Infinity);
        const composition=count>=floor && lower!==null && lower>=(block.ratio_threshold || 1);
        const smallActive=sampleReady && n<200*scale && composition;
        const active=sampleReady && (smallActive || n>=200*scale && (absolute || count>=floor && share>=block.ratio_threshold));
        let level=active ? 'yellow' : greenReady ? 'green' : 'unknown';
        if(sampleReady && base?.is_active && base.ratio>=thresholds.red)level='red';
        else if(sampleReady && base?.is_active && base.ratio>=thresholds.orange)level='orange';
        else if(sampleReady && base?.is_active && base.ratio>=thresholds.yellow)level='yellow';
        components[type]={observed_count:count,value_status:count===0 ? 'observed_zero' : 'observed',
            total_window_estimate:null,level,initial_active:active,observed_share:share,conservative_share_guard:lower,
            count_floor:floor,absolute_threshold:block.absolute_threshold,share_threshold:block.ratio_threshold,
            comparison:base,confidence:sampleReady ? input.source_status==='complete' ? 'medium' : 'low' : 'insufficient',
            method:base?.is_stable_input ? 'initial-plus-matched-comparison-v2' : 'initial-absolute-composition-v2'};
    }
    if(sampleReady) {
        const active=Object.entries(components).filter(([,c])=>c.initial_active).map(([type])=>type);
        initial=bundleLevel(active,config.surge_r ? config : DEFAULT_CONFIG);
    }
    if(initial==='green' && !greenReady)initial='unknown';
    let level=initial,method='initial-absolute-composition-v2';
    const comparativeTypes=Object.entries(byType).filter(([,r])=>r.is_active && r.bundle_eligible).map(([type])=>type);
    const initialTypes=Object.entries(components).filter(([,c])=>c.initial_active).map(([type])=>type);
    const activeTypes=[...new Set([...initialTypes,...comparativeTypes])].sort();
    const comparative=bundleLevel(activeTypes,config.surge_r ? config : DEFAULT_CONFIG);
    if(sampleReady && comparativeTypes.length>0 && ORDER[comparative]>ORDER[level]){level=comparative;method='initial-plus-matched-comparison-v2';}
    const eligibleImpacts=impacts.filter(impact=>impact.assessment?.current_at_cutoff===true &&
        ['orange','red','yellow'].includes(impact.assessment?.level) && impact.assessment?.method==='accepted-functional-impact-v2');
    // Operator-scoped impacts remain separate facts. Without population/service
    // coverage and state-relationship evidence, they cannot set a country color.
    if(level==='unknown') {
        if(!n)reasons.push('no_country_records_in_observed_archives');else if(n<50*scale)reasons.push('country_record_count_below_50');
        if(!timeReady)reasons.push('time_coverage_gap_staleness_or_schema_insufficient');
        if(!diversityReady)reasons.push('country_source_diversity_or_temporal_spread_insufficient');
        if(sampleReady && n<200*scale)reasons.push('small_sample_without_supported_positive_signal');
        if(initial==='unknown' && !greenReady)reasons.push('no_signal_requires_stronger_coverage_than_positive_detection');
    } else reasons.push(level==='green' ? 'no_elevated_signal_in_qualified_observed_sample' : method==='accepted-functional-impact-v2' ? 'accepted_current_functional_disruption' : 'supported_observed_monitoring_signal');
    return {level,method,initial_level:initial,initial_active_types:initialTypes,active_types:activeTypes,confidence:level==='unknown' ? 'insufficient' : input.source_status==='complete' ? 'medium' : 'low',
        scoped_impacts:eligibleImpacts.map(impact=>impact.event_id),national_functional_state:'not_assessed',
        components,reasons,temporal_coverage:temporal,country_input:{records:n,...quality},
        available_comparisons:Object.keys(byType).filter(type=>byType[type].is_stable_input),
        unevaluated_comparisons:Object.keys(byType).filter(type=>!byType[type].is_stable_input),
        scope:'Qualified observed English news records and explicitly scoped accepted impacts; no claim of national safety or measured fiscal capacity',
        partial_observation:input.source_status!=='complete',green_requirements:{records:200*scale,source_urls:20,domains:5,observed_hours:12*scale,span_hours:24*scale,source_fraction:0.5,max_gap_minutes:180,max_source_age_minutes:180,tone_fraction:0.8,known_actor_geographies:50},
        display_score:level==='unknown' ? null : {green:0,yellow:5,orange:7.5,red:10}[level],score_unit:'Ordinal monitoring display, not probability'};
}
