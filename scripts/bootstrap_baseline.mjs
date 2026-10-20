import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import { calendarDates, METHOD } from './engine_v2.mjs';
import { aggregateObservation } from './monitoring_v2.mjs';
const arg=key=>process.argv[process.argv.indexOf(key)+1];
const folder=process.argv.includes('--sources')?arg('--sources'):null,date=arg('--date');if((!folder&&!process.argv.includes('--source-index'))||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Explicit sources and edition date required');
const option=key=>process.argv.includes(key)?arg(key):null;
const historyPath=path.resolve(option('--history')||'.local/v2-history.json'),cutoffHour=Number(option('--cutoff-hour')||20);if(fs.existsSync(historyPath)&&fs.statSync(historyPath).size>512*1024*1024)throw Error('History input byte limit');const history=fs.existsSync(historyPath)?JSON.parse(fs.readFileSync(historyPath)):{};
function readBounded(file,limit,label){
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>limit)throw Error(label+' byte/type limit');
 const buffer=Buffer.alloc(stat.size+1),fd=fs.openSync(file,'r');let count=0;
 try{while(count<buffer.length){const n=fs.readSync(fd,buffer,count,buffer.length-count,null);if(!n)break;count+=n;}}finally{fs.closeSync(fd);}
 if(count!==stat.size)throw Error(label+' changed during read');return buffer.subarray(0,count);
}
const sourceIndex=option('--source-index')?JSON.parse(readBounded(option('--source-index'),4*1024*1024,'Source index')):null;
if(sourceIndex&&(sourceIndex.schema!=='wcr-baseline-dto-index-v1'||sourceIndex.edition!==date||sourceIndex.cutoff_hour_utc!==cutoffHour||!/^[a-f0-9]{64}$/.test(sourceIndex.contract_sha256)||!sourceIndex.files||typeof sourceIndex.files!=='object'||Array.isArray(sourceIndex.files)||Object.keys(sourceIndex.files).length>15||Object.keys(sourceIndex.files).some(day=>day!==date&&!calendarDates(date,14).includes(day))))throw Error('DTO source index identity mismatch');
const report=[];
for(const day of calendarDates(date,14)) {
    const entry=sourceIndex?.files[day];if(sourceIndex&&!Object.hasOwn(sourceIndex.files,day))continue;
    if(sourceIndex&&(!entry||typeof entry!=='object'))throw Error('Missing bound DTO reference');
    if(entry&&(!path.isAbsolute(entry.path)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>32*1024*1024||!/^[a-f0-9]{64}$/.test(entry.sha256)))throw Error('DTO source reference invalid');
    const file=entry?entry.path:path.join(folder,day+'.json');if(!fs.existsSync(file)){if(entry)throw Error('Bound DTO missing');continue;}
    const raw=readBounded(file,32*1024*1024,'DTO');if(entry&&(raw.length!==entry.bytes||crypto.createHash('sha256').update(raw).digest('hex')!==entry.sha256))throw Error('DTO source SHA mismatch');const input=JSON.parse(raw);
    if(input.schema!=='country-risk-observations-v2'||input.edition_date!==day||Date.parse(input.window.end_utc)-Date.parse(input.window.start_utc)!==48*3600000||input.window.time_field!=='DATEADDED'||new Date(input.cutoff_utc).getUTCHours()!==cutoffHour)throw Error('Historical population/window mismatch');
    const observed=aggregateObservation(input);
    history[day]={method:METHOD,coverage:input.source_status,cutoff_utc:input.cutoff_utc,window:input.window,
        input_sha256:crypto.createHash('sha256').update(raw).digest('hex'),source_manifest_sha256:input.source_manifest_sha256,
        countries:observed.data,quarters:observed.quarters,offsets:observed.offsets,source_coverage:input.coverage,
        reconstruction:'Retrospective same-population archive computation; not a published-at-that-time prediction'};
    report.push({date:day,status:input.source_status,available_slots:observed.offsets.length,input_sha256:history[day].input_sha256});
}
const historyBytes=JSON.stringify(history)+'\n';if(Buffer.byteLength(historyBytes)>512*1024*1024)throw Error('History output byte limit');
fs.mkdirSync(path.dirname(historyPath),{recursive:true});fs.writeFileSync(historyPath+'.pending',historyBytes);fs.renameSync(historyPath+'.pending',historyPath);
fs.writeFileSync(option('--report')||'.local/baseline-reconstruction.json',JSON.stringify({edition:date,cutoff_hour_utc:cutoffHour,reference_dates:calendarDates(date,14),days:report,method:METHOD},null,2)+'\n');
console.log(JSON.stringify({status:'reconstructed',days:report.length,complete_days:report.filter(row=>row.status==='complete').length,reference:'Previous 14 calendar dates; paired observations are separately labelled'}));
