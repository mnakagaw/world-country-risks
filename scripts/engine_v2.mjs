import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const VERSION = '2.0.0';
export const METHOD = 'gdelt-events-calendar-v2';
export const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function calendarDates(date, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(days) || days < 1) throw new Error('Invalid calendar');
    const end = new Date(date+'T00:00:00Z');
    return Array.from({length:days}, (_, i) => new Date(end.getTime()-(days-i)*86400000).toISOString().slice(0,10));
}

export function reference(history, date, country, metric, days=14) {
    const dates=calendarDates(date,days), values=[];
    const valid_dates=[], missing_dates=[];
    for (const key of dates) {
        const row=history[key]?.countries?.[country];
        const value=row?.[metric];
        if (history[key]?.method===METHOD && history[key]?.coverage==='complete' && Number.isFinite(value)) {
            values.push(value);valid_dates.push(key);
        } else missing_dates.push(key);
    }
    values.sort((a,b)=>a-b);const middle=Math.floor(values.length/2);
    const median=values.length ? (values.length%2 ? values[middle] : (values[middle-1]+values[middle])/2) : null;
    return {start:dates[0],end:dates.at(-1),valid_days:values.length,missing_dates,valid_dates,median,
            unit:'48h Event table records; same population/filter/method'};
}

export function assessCoverage(row, input) {
    if (!row || !Number.isFinite(row.event_count) || row.event_count===0) return 'unknown';
    if (input.source_status!=='complete') return 'partial';
    if (row.event_count<200) return 'low_coverage';
    return 'observed';
}

export function ratioRecord(count, base) {
    if (!Number.isFinite(base.median) || base.valid_days<10 || base.median<3) return {
        today:count,baseline_median:base.median,ratio:null,is_active:false,is_stable_input:false,
        data_status:'baseline_insufficient',reference:base};
    const ratio=(count+5)/(base.median+5);
    return {today:count,baseline_median:base.median,ratio,is_active:ratio>=1.75,
            is_stable_input:true,data_status:'observed',reference:base};
}

export function verifyImpact(record, window, verificationRoot) {
    const cutoff=Date.parse(window.end_utc);
    if (!record || record.schema!=='verified-impact-v2' || record.status!=='verified' ||
        !record.event_id || !record.country || !record.impact || !record.scope ||
        !record.verification?.body_sha256 || !/^[a-f0-9]{64}$/.test(record.verification.body_sha256) ||
        !Number.isFinite(Date.parse(record.verification?.verified_at)) || Date.parse(record.verification.verified_at)>=cutoff ||
        !record.evidence?.length || !record.evidence.every(e => e.url && e.original_source_id && Date.parse(e.checked_at)<cutoff && e.body_reviewed===true)) {
        throw new Error('Impact requires cutoff-bound original body verification, scope and independent provenance');
    }
    if(!verificationRoot)throw new Error('Native capture namespace required');
    for(const evidence of record.evidence){
        if(!/^[a-f0-9]{64}$/.test(evidence.capture_id||''))throw new Error('Original capture ID required');
        const capture=JSON.parse(fs.readFileSync(path.join(verificationRoot,'captures',evidence.capture_id+'.json')));
        if(!/^[a-f0-9]{64}\.body$/.test(capture.body_file||''))throw new Error('Invalid native body path');
        const body=fs.readFileSync(path.join(verificationRoot,'verified-bodies',capture.body_file));
        const actual=crypto.createHash('sha256').update(body).digest('hex');
        if(actual!==capture.body_sha256||actual!==evidence.body_sha256||capture.url!==evidence.url||
           Date.parse(capture.retrieved_at)>=cutoff||Date.parse(evidence.checked_at)<Date.parse(capture.retrieved_at)||
           !evidence.excerpt_original||!body.toString('utf8').includes(evidence.excerpt_original))throw new Error('Original body/provenance/cutoff verification failed');
    }
    const sourceIds=new Set(record.evidence.map(e=>e.original_source_id));
    return {schema:record.schema,status:record.status,event_id:record.event_id,country:record.country,
        impact:record.impact,scope:record.scope,period:record.period||null,recovery:record.recovery||null,
        verification:{verified_at:record.verification.verified_at,body_sha256:record.verification.body_sha256},
        evidence:record.evidence.map(e=>({url:e.url,original_source_id:e.original_source_id,checked_at:e.checked_at,body_sha256:e.body_sha256})),
        independent_source_count:sourceIds.size,
        confidence:sourceIds.size>=2 ? 'corroborated' : 'single_original_source'};
}

export function bindExplanation(country, signal, sourceUrls, window) {
    const urls=[...new Set(sourceUrls)].filter(url=>/^https?:\/\//.test(url)).slice(0,5);
    return {method:METHOD,country,window,signal_sha256:hash(signal),source_urls:urls,
        evidence_status:'discovery_metadata_only',confidence:'low',
        meaning:'Event table records extracted from reporting; not article counts, independent incidents or measured state capacity'};
}

export function latestCompletedWeek(cutoff) {
    const d=new Date(cutoff);d.setUTCHours(0,0,0,0);
    const weekday=(d.getUTCDay()+6)%7;
    const end=new Date(d.getTime()-weekday*86400000),start=new Date(end.getTime()-7*86400000);
    return {start_utc:start.toISOString(),end_utc:end.toISOString(),semantics:'[start,end)'};
}
