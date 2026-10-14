(() => {
  'use strict';
  const api='https://securitywatch.jp/world-alert/country-interest.php';
  const daily=document.body.dataset.interestMode==='daily';
  const $=id=>document.getElementById(id),grid=$('interest-cards'),status=$('interest-status'),date=$('interest-date'),time=$('interest-time'),search=$('interest-search'),country=$('interest-country'),detail=$('interest-detail');
  if(!grid)return;
  const A=window.CountryInterestAttention,names=new Intl.DisplayNames(['ja'],{type:'region'});
  const label=code=>{try{return names.of(code)||code;}catch{return code;}};
  const text=(tag,value,parent)=>{const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;};
  const stamp=value=>value?new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+' JST':'未観測';
  const jstDay=value=>new Date(Date.parse(value)+32400000).toISOString().slice(0,10);
  const source={ok:'取得成功',empty:'空の応答',failed:'取得失敗',unsupported:'取得非対応',not_observed:'未観測',stale:'再確認待ち'};
  const initial=new URLSearchParams(location.search);country.dataset.requested=(initial.get('country')||'').toUpperCase();date.value=initial.get('day')||'';
  if(daily){$('interest-cadence').textContent='24時間集計 · 毎日03:00 JST締め';time.closest('label').hidden=true;}
  let cards=[],meta=null,version=0,loading=false,catalog=null,lastLoad=0,attentionRequest=0,detailRequest=0;
  async function get(query){const response=await fetch(api+'?'+new URLSearchParams(query),{cache:'no-store'});const value=await response.json();if(!response.ok)throw Error(value.source_status||'HTTP '+response.status);return value;}
  function query(){const value={view:'cards',mode:daily||time.value==='daily'?'daily':'live',limit:'12'};if(date.value)value.day=date.value;if(!daily&&time.value&&time.value!=='daily')value.at=time.value;return value;}
  function safeLink(label,url,parent){try{const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))return;const a=text('a',label,parent);a.href=parsed;a.target='_blank';a.rel='noopener noreferrer';}catch{}}
  function render(){
    if(!meta)return;grid.replaceChildren();
    const q=search.value.trim().toLocaleLowerCase('ja'),code=country.value;
    const selected=cards.filter(c=>(!code||c.country===code)&&(!q||label(c.country).toLocaleLowerCase('ja').includes(q)||c.country.toLowerCase().includes(q)||c.top5.some(t=>t.raw_query.toLocaleLowerCase('ja').includes(q))));
    const stale=meta.delivery_state==='stale';
    status.textContent=`${selected.length}/${cards.length}国・地域 · ${meta.mode==='daily'?'24時間集計':'15分更新'} · ${meta.delivery_state==='historical'?(meta.projection_mode==='historical_backfill'?'保存観測から再構成した過去時点':'保存した過去時点'):meta.delivery_state==='sealed'?'日次固定版':stale?'取得が古いため再確認待ち':'最新観測'}${meta.provider_status?.status==='rate_limited'?' · Google取得頻度制限・再確認待ち':''} · ${stamp(meta.window.start_utc)} → ${stamp(meta.window.end_utc)}`;
    for(const c of selected){
      const card=text('article','',grid);card.className='interest-country-card';card.dataset.country=c.country;
      const head=text('header','',card);text('h2',label(c.country),head);text('span',c.country,head);
      text('p',`${source[c.source_status]||c.source_status}${stale?' · 配信再確認待ち':''} · 観測 ${c.coverage.successful_slots??0}/96枠`,card).className='interest-source';
      const list=text('ol','',card);
      for(const t of c.top5){
        const li=text('li','',list);const b=text('button',t.raw_query,li);b.type='button';b.className='interest-topic';b.addEventListener('click',()=>showSeries(c.country,t));
        const attention=t.attention; if(attention){li.classList.add('interest-hazard');text('span',A?.kinds[attention.kind]||'災害・事故',li).className='interest-badge interest-hazard-badge';}
        const changed=meta.mode==='daily'?t.bucket_increased_in_window:t.change?.status==='bucket_increased';
        const fresh=t.change?.status==='new_observation';
        if(changed){li.classList.add('interest-rising');text('span','↑ 概算枠が増加',li).className='interest-badge interest-rising-badge';}
        else if(fresh)text('span','新規観測',li).className='interest-badge';
        text('small',`概算 ${meta.mode==='daily'?t.largest_observed_traffic_bucket:t.traffic_label_raw||t.largest_observed_traffic_bucket||'不明'}`,li);
      }
      if(!c.top5.length)text('p','この時点の検索語は未観測です。データの蓄積を開始しています。',card).className='interest-empty';
      text('small','最終成功 '+stamp(c.last_success),card);
    }
    if(!selected.length)text('p',code&&!cards.some(c=>c.country===code)?'この国・地域は取得非対応です。登録されている国・地域を選んでください。':'表示語の該当なし。保存語の履歴は下の検索から確認できます。',grid);
  }
  async function loadCatalog(){
    const day=date.value,query={view:'catalog'};if(day){query.day=day;query.month=day.slice(0,7);}catalog=await get(query);
    const old=time.value;time.replaceChildren();text('option','最新の保存時点',time).value='';text('option','日次24時間集計（03:00締め）',time).value='daily';
    if(day)for(const slot of catalog.days[day]?.slots||[]){const o=text('option',stamp(slot.at),time);o.value=slot.at;}
    if([...time.options].some(o=>o.value===old))time.value=old;
    const dates=Object.keys(catalog.days);$('interest-history-status').textContent=dates.length?`この月の保存日：${dates.join('、')}。蓄積開始前の値はありません。`:'この月は保存済みの観測がありません。';
  }
  async function load(){
    const token=++version;loading=true;meta=null;cards=[];grid.replaceChildren();attentionRequest++;const a=$('interest-attention');if(a){a.querySelector('[data-attention-items]')?.replaceChildren();a.querySelector('[data-attention-primary]')?.replaceChildren();a.querySelector('[data-attention-status]').textContent='この日の候補を確認しています…';}detailRequest++;detail.hidden=true;$('interest-history-results').replaceChildren();status.textContent='各国の関心を確認しています…';
    try{
      await loadCatalog();const q=query();const first=await get({...q,offset:'0'});if(token!==version)return;
      const collected=[...first.cards];
      // Pin pagination to this exact complete snapshot so a 15-min update cannot mix versions.
      const pinned={...q};if(first.mode==='daily'){pinned.day=jstDay(first.window.end_utc);}else{pinned.at=first.window.end_utc;delete pinned.day;}
      const offsets=[];for(let offset=12;offset<first.total;offset+=12)offsets.push(offset);
      for(let start=0;start<offsets.length;start+=3){
        const pages=await Promise.all(offsets.slice(start,start+3).map(offset=>get({...pinned,offset:String(offset)})));
        if(token!==version)return;
        for(const page of pages){if(page.snapshot_id!==first.snapshot_id)throw Error('更新時点の照合待ち');collected.push(...page.cards);}
      }
      cards=collected;meta=first;lastLoad=Date.now();
      const requested=country.value||country.dataset.requested;country.replaceChildren();text('option','すべての国・地域',country).value='';
      for(const code of first.available_countries){const option=text('option',label(code)+' ('+code+')',country);option.value=code;}if(requested&&!first.available_countries.includes(requested)){const option=text('option',label(requested)+' ('+requested+') · 取得非対応',country);option.value=requested;option.disabled=true;}country.value=requested;
      country.dataset.requested='';render();
      if(token===version)await loadAttention();
    }catch(error){if(token!==version)return;status.textContent='取得を確認できません：'+error.message+'。再確認待ちです。';if(meta){meta.delivery_state='stale';render();status.textContent+=' · 新しい取得に失敗しました。';}}
    finally{if(token===version)loading=false;}
  }
  async function loadAttention(){
    if(!A||!meta||!$('interest-attention'))return;
    const request=++attentionRequest,p={view:'attention',mode:meta.mode};
    if(meta.mode==='daily')p.day=jstDay(meta.window.end_utc);else p.at=meta.window.end_utc;
    if(country.value)p.country=country.value;
    try{const data=await get(p);if(request===attentionRequest)A.render($('interest-attention'),data.attention,data);}
    catch{if(request===attentionRequest)$('interest-attention').querySelector('[data-attention-status]').textContent='候補の取得確認待ちです。';}
  }
  function plot(points,parent,day,window=null){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 740 210');svg.setAttribute('role','img');svg.setAttribute('aria-label','概算検索量の観測時系列。欠測は線で結びません。');parent.append(svg);
    const add=(tag,attrs)=>{const n=document.createElementNS(svg.namespaceURI,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);svg.append(n);return n;};
    const values=points.filter(p=>p.lower_bound!==null),max=Math.max(1,...values.map(p=>p.lower_bound));const origin=window?Date.parse(window.start_utc):Date.parse(day+'T00:00:00+09:00');
    add('line',{x1:36,y1:175,x2:715,y2:175,stroke:'#71839a'});
    for(let h=0;h<=24;h+=6){const n=add('text',{x:36+h/24*679,y:199,'text-anchor':'middle',fill:'#9cadc2','font-size':12});n.textContent=window?new Date(origin+h*3600000).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'numeric'}):h+'時';}
    let prev=null;
    for(const p of values){const point={x:36+(Date.parse(p.observed_at)-origin)/86400000*679,y:175-p.lower_bound/max*145,t:Date.parse(p.observed_at)};
      if(prev&&point.t-prev.t<=1200000)add('line',{x1:prev.x,y1:prev.y,x2:point.x,y2:point.y,stroke:'#ffce68','stroke-width':2});
      const circle=add('circle',{cx:point.x,cy:point.y,r:3,fill:'#ffce68'});const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=stamp(p.observed_at)+' · '+p.bucket;circle.append(title);prev=point;
    }
  }
  async function showSeries(code,topic){
    if(!meta)return;const token=++detailRequest;
    detail.hidden=false;detail.replaceChildren();text('h2',label(code)+' · '+(topic.raw_query||topic.query),detail);text('p','観測履歴を確認しています…',detail);
    const day=date.value||jstDay(meta.window.end_utc);
    try{const data=await get({view:'series',country:code,day,mode:meta.mode,key:topic.normalized_query_key||topic.key});if(token!==detailRequest)return;detail.replaceChildren();text('h2',label(code)+' · '+(topic.raw_query||topic.query),detail);
      text('p',`${day} · ${data.points.length}観測 · 保存時点 ${data.available_snapshots} · 未取得の履歴 ${data.unavailable_snapshots}`,detail);
      if(data.points.length)plot(data.points,detail,day,data.window);else text('p','この日の保存観測点はありません。未掲載・欠測をゼロに置き換えません。',detail);
      const table=text('table','',detail),head=text('tr','',text('thead','',table));text('th','観測時刻（JST）',head);text('th','概算検索量の枠',head);const body=text('tbody','',table);
      for(const p of data.points){const row=text('tr','',body);text('td',stamp(p.observed_at),row);text('td',p.bucket||'不明',row);}
      if(topic.google_url)safeLink('Google Trendsで見る',topic.google_url,detail);
      text('p','概算枠の観測です。15分間の検索件数ではありません。線の途切れ・未掲載は検索ゼロや事件終了を示しません。',detail);
    }catch{if(token!==detailRequest)return;detail.replaceChildren();text('h2','履歴の再確認待ち',detail);text('p','この日・検索語の保存履歴を取得できません。',detail);}
    detail.scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function historySearch(event){
    event.preventDefault();const q=$('interest-history-query').value.trim();if(!q)return;if(!meta){$('interest-history-results').textContent='この日の固定版は未取得です。保存語を確認できません。';return;}
    const day=date.value||(meta?jstDay(meta.window.end_utc):new Date(Date.now()+32400000).toISOString().slice(0,10));const root=$('interest-history-results');root.replaceChildren();text('p','保存語を検索しています…',root);
    try{const params={view:'search',day,q,mode:meta?.mode||'live'};if(country.value)params.country=country.value;const data=await get(params);root.replaceChildren();text('p',`${day} · ${data.total}件の該当から最大20件を表示${data.search_scope==='selected_legacy_topics'?' · 初期版は保存済みの選択語のみ':''}`,root);
      for(const item of data.items){const b=text('button',label(item.country)+' · '+item.query,root);b.type='button';b.addEventListener('click',()=>showSeries(item.country,item));}
      if(!data.items.length)text('p','この日の保存範囲には該当する語がありません。',root);
    }catch{root.replaceChildren();text('p','この日の検索履歴は未観測、または取得確認待ちです。',root);}
  }
  search.addEventListener('input',render);country.addEventListener('change',()=>{render();loadAttention();});date.addEventListener('change',()=>{time.value='';load();});time.addEventListener('change',load);
  $('interest-refresh').addEventListener('click',load);$('interest-latest').addEventListener('click',()=>{date.value='';time.value='';detail.hidden=true;load();});$('interest-controls').addEventListener('submit',e=>{e.preventDefault();render();});$('interest-history-form').addEventListener('submit',historySearch);
  setInterval(()=>{if(!document.hidden&&!date.value&&!loading)load();},daily?86400000:900000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!date.value&&!loading&&Date.now()-lastLoad>(daily?86400000:900000))load();});load();
})();
