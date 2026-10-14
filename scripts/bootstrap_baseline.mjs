import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import { calendarDates, METHOD } from './engine_v2.mjs';
import { aggregateObservation } from './monitoring_v2.mjs';
const arg=key=>process.argv[process.argv.indexOf(key)+1];
const folder=arg('--sources'),date=arg('--date');if(!folder||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Explicit sources and edition date required');
const option=key=>process.argv.includes(key)?arg(key):null;
const historyPath=path.resolve(option('--history')||'.local/v2-history.json'),cutoffHour=Number(option('--cutoff-hour')||20);const history=fs.existsSync(historyPath)?JSON.parse(fs.readFileSync(historyPath)):{};
const report=[];
for(const day of calendarDates(date,14)) {
    const file=path.join(folder,day+'.json');if(!fs.existsSync(file))continue;
    const raw=fs.readFileSync(file),input=JSON.parse(raw);
    if(input.schema!=='country-risk-observations-v2'||input.edition_date!==day||Date.parse(input.window.end_utc)-Date.parse(input.window.start_utc)!==48*3600000||input.window.time_field!=='DATEADDED'||new Date(input.cutoff_utc).getUTCHours()!==cutoffHour)throw Error('Historical population/window mismatch');
    const observed=aggregateObservation(input);
    history[day]={method:METHOD,coverage:input.source_status,cutoff_utc:input.cutoff_utc,window:input.window,
        input_sha256:crypto.createHash('sha256').update(raw).digest('hex'),source_manifest_sha256:input.source_manifest_sha256,
        countries:observed.data,quarters:observed.quarters,offsets:observed.offsets,source_coverage:input.coverage,
        reconstruction:'Retrospective same-population archive computation; not a published-at-that-time prediction'};
    report.push({date:day,status:input.source_status,available_slots:observed.offsets.length,input_sha256:history[day].input_sha256});
}
fs.mkdirSync(path.dirname(historyPath),{recursive:true});fs.writeFileSync(historyPath+'.pending',JSON.stringify(history)+'\n');fs.renameSync(historyPath+'.pending',historyPath);
fs.writeFileSync(option('--report')||'.local/baseline-reconstruction.json',JSON.stringify({edition:date,cutoff_hour_utc:cutoffHour,reference_dates:calendarDates(date,14),days:report,method:METHOD},null,2)+'\n');
console.log(JSON.stringify({status:'reconstructed',days:report.length,complete_days:report.filter(row=>row.status==='complete').length,reference:'Previous 14 calendar dates; paired observations are separately labelled'}));
