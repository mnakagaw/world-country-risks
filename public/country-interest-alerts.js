(() => {
  'use strict';
  const kinds={earthquake:'地震',eruption:'噴火',tsunami:'津波',flood_landslide:'洪水・土砂災害',severe_weather:'暴風・台風',fire:'火災・山火事',serious_accident:'重大事故'};
  const names=new Intl.DisplayNames(['ja'],{type:'region'});
  const label=code=>{try{return names.of(code)||code;}catch{return code;}};
  const el=(tag,value,parent)=>{const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;};
  const date=value=>value?new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+' JST':'未確認';
  function link(text,url,parent){try{const safe=new URL(url);if(!['https:','http:'].includes(safe.protocol))return;const a=el('a',text,parent);a.href=safe;a.target='_blank';a.rel='noopener noreferrer';}catch{}}
  function render(root,attention,meta){
    const status=root.querySelector('[data-attention-status]'),list=root.querySelector('[data-attention-items]'),primary=root.querySelector('[data-attention-primary]');list.replaceChildren();primary?.replaceChildren();
    const stale=meta.delivery_state==='stale'||(meta.delivery_state==='current'&&Date.now()-Date.parse(meta.window.end_utc)>2700000);
    const items=attention.items||[];
    const failed=(attention.source_states?.failed||0)+(attention.source_states?.stale||0);
    status.textContent=`${stale?'取得が古いため再確認待ち · ':''}${attention.candidate_count??items.length}候補から${items.length}件を表示 · 現在確認 ${attention.current_candidate_count??0} · 再確認待ちの国 ${failed} · 観測時点 ${date(meta.window.end_utc)}`;
    for(const [index,item] of items.entries()){
      const card=el('article','',primary&&index<3?primary:list);card.className='search-attention-card';
      const verified=item.verification_status==='verified_event_candidate';
      const pending=stale||item.freshness!=='current';
      const badge=el('span',pending?'再確認待ち':verified?'事象を原文で確認':item.verification_status==='checked_unconfirmed'?'調査済み・事象未確認':'検索急上昇・確認中',card);badge.className='search-attention-badge';
      el('h3',`${kinds[item.kind]||'災害・事故'} · ${item.query}`,card);
      el('p',`検索地域：${label(item.search_country)}${verified?' · 確認した発生地：'+item.event_location:' · 発生地を確認中'}`,card);
      el('small',`初観測 ${date(item.first_observed_at)} · 最終観測 ${date(item.last_observed_at)} · 最大観測概算 ${item.largest_observed_traffic_bucket||'不明'}`,card);
      const links=el('p','',card);links.className='search-attention-links';link('Google Trends',item.google_url,links);
      for(const [i,url] of (verified?item.original_urls:item.related_news_urls||[]).slice(0,2).entries())link(verified?'確認原文 '+(i+1):'関連ニュース '+(i+1),url,links);
      const more=el('a','この国の関心を見る',links);more.href='https://securitywatch.jp/world-alert/country-interest/?country='+encodeURIComponent(item.search_country);
    }
    const more=list.closest('details');if(more)more.hidden=Boolean(primary)&&items.length<=3;
    if(!items.length)el('p',attention.status==='not_yet_projected'?'急上昇候補の表示を準備しています。':'この取得範囲では現在の候補はありません。取得不足や表示なしは安全の判断ではありません。',primary||list);
  }
  window.CountryInterestAttention={render,kinds,label,date};
  for(const root of document.querySelectorAll('[data-search-attention="preview"]')){
    let loading=false,last=0;
    async function load(){if(loading)return;loading=true;last=Date.now();try{const response=await fetch('https://securitywatch.jp/world-alert/country-interest.php?view=attention',{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.source_status||'取得できません');render(root,data.attention,data);}catch{root.querySelector('[data-attention-status]').textContent='急上昇候補の取得を確認できません。再確認待ちです。';root.querySelector('[data-attention-items]').replaceChildren();}finally{loading=false;}}
    root.querySelector('[data-attention-refresh]')?.addEventListener('click',load);
    setInterval(()=>{if(!document.hidden)load();},900000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-last>900000)load();});load();
  }
})();
