export const R_TYPES=['R1','R2','R3','R4'];
// A canonical article group can support at most one concurrent domain in the
// country color. Repeated propagation remains in the reporting observations.
export function assignDistinctSupports(types,support){
 const assigned=new Map();
 function match(type,seen){
  for(const key of support[type]?.article_keys || []){
   if(seen.has(key))continue;seen.add(key);
   if(!assigned.has(key) || match(assigned.get(key),seen)){assigned.set(key,type);return true;}
  }return false;
 }
 for(const type of [...types].sort())match(type,new Set());
 return Object.fromEntries([...assigned].map(([key,type])=>[type,key]));
}
export function bundleLevel(types,config){
 const n=new Set(types.filter(type=>R_TYPES.includes(type))).size,c=config.surge_r.bundle_aggregation;
 return n>=c.red_bundles?'red':n>=c.orange_bundles?'orange':n>=c.yellow_min_bundles?'yellow':'green';
}
export function weeklySignalState(item,type){
 if(!item)return 'unknown';const signal=item.weekly_surge_r_by_type?.[type];
 if(signal?.comparison_level==='unknown'||signal?.level==='unknown'||signal?.ratio7===null||item.levels?.[type]==='NoData')return 'unknown';
 if(typeof signal?.is_active==='boolean')return signal.is_active?'on':'off';
 const level=item.levels?.[type];return ['Red','Orange','Yellow','red','orange','yellow'].includes(level)?'on':['None','green','none'].includes(level)?'off':'unknown';
}
// Existing completed-week records are reused. Unknown cannot become an off week.
export function firstLitSummary(history){
 const rows=[...history].sort((a,b)=>a.week.localeCompare(b.week)),first={};
 for(const type of R_TYPES){first[type]=rows.find(row=>weeklySignalState(row,type)==='on')?.week || null;}
 const order=Object.entries(first).filter(([,week])=>week).sort((a,b)=>a[1].localeCompare(b[1])||a[0].localeCompare(b[0]));
 return {first,order,meaning:'First observed activation week in selected method/range; not event onset or proof of causality/recovery'};
}
