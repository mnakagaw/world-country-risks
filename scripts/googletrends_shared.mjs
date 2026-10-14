// Read-only consumer. The single RSS producer is SecurityWatch general15.
export async function fetchGoogleTrends({geos=['US','GB','IN','BR','JP'],limitPerGeo=5,outLimit=6}={}){
  const results=[];
  for(let start=0;start<geos.length;start+=4){
    const batch=await Promise.all(geos.slice(start,start+4).map(async country=>{
      try{
        const response=await fetch('https://securitywatch.jp/world-alert/country-interest.php?country='+encodeURIComponent(country),{signal:AbortSignal.timeout(8000)});
        if(!response.ok)return [];
        const value=await response.json();
        if(value.producer!=='securitywatch-general15')throw new Error('Unexpected shared producer');
        return (value.country_data?.topics||[]).slice(0,limitPerGeo).map(t=>({title:t.raw_query,link:t.google_url,
          geo:country,iso2:country,category:t.category,is_political:t.category==='politics',
          source:'google-trends-shared-v1',snapshot_id:value.snapshot_id,observation_id:t.observation_id,
          provider_pubdate_utc:t.provider_pubdate_utc,source_status:value.country_data.source_status,
          traffic_label_raw:t.largest_observed_traffic_bucket}));
      }catch{return [];}
    }));results.push(...batch.flat());
  }
  return [...new Map(results.map(t=>[t.iso2+':'+t.title.normalize('NFKC'),t])).values()].slice(0,outLimit);
}
export async function classifyTrendsGemini(_model,items){return items;}
