import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {chromium}=require('C:/Users/madok/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url=process.argv[2]||'http://127.0.0.1:4173/',tag=process.argv[3]||'local';const out=path.resolve('.local/monitoring-evidence');fs.mkdirSync(out,{recursive:true});
const snapshot=JSON.parse(fs.readFileSync('public/data/v2/latest.json'));const colors={red:'#ee2c2c',orange:'#f57c00',yellow:'#dca01d',green:'#388e3c',unknown:'#3d4654'};
const context=await chromium.launchPersistentContext(path.resolve('work/edge-monitoring-profile'),{headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:390,height:844},locale:'ja-JP',timezoneId:'Asia/Tokyo'});
const page=await context.newPage(),failures=[],results=[];page.on('pageerror',e=>failures.push(e.message));
await context.addInitScript(()=>{localStorage.setItem('rw_view_mode','surge_r');localStorage.setItem('rw_lang','ja');localStorage.setItem('rw_theme','dark');});
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator(`.app[data-snapshot-id="${snapshot.snapshot_id}"]`).waitFor();
 await page.locator('path[data-country="US"]').first().waitFor({state:'attached'});
 for(const [size,viewport] of [['mobile',{width:390,height:844}],['desktop',{width:1440,height:1000}]]){
  await page.setViewportSize(viewport);
  for(const lang of ['ja','en','es']){
   await page.locator('.lang-btn').filter({hasText:lang==='ja'?'日本語':lang.toUpperCase()}).click();
   const controls=await page.locator('.lang-btn,.view-mode-btn,.theme-btn').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {label:n.innerText,left:r.left,right:r.right,limit:innerWidth};}));
   for(const control of controls)assert.ok(control.left>=0 && control.right<=control.limit,`${size} ${lang}: ${control.label} clipped`);
   for(const [index,mode] of ['surge_r','raw','surge'].entries()){
    await page.locator('.view-mode-btn').nth(index).click();
    for(const [level,count] of Object.entries(snapshot.monitoring_counts))assert.match(await page.locator(`.alert-count--${level}`).innerText(),new RegExp(`^${count}\\b`));
    const paths=await page.locator('path[data-country]').evaluateAll(nodes=>nodes.map(n=>({iso:n.dataset.country,fill:n.getAttribute('fill')})));
    for(const item of paths){const row=snapshot.countries[item.iso];if(row)assert.equal(item.fill,colors[row.monitoring_level],`${item.iso} ${mode}`);}
   }
   await page.locator('.view-mode-btn').first().click();
   for(const level of ['red','orange','yellow','green','unknown']){
    await page.locator('.level-filter select').selectOption(level);
    const rows=await page.locator('.heat-list-item').evaluateAll(nodes=>nodes.map(n=>({iso:n.dataset.country,level:n.dataset.monitoringLevel})));
    assert.ok(rows.length,level);for(const row of rows)assert.equal(row.level,level);
    const selected=rows.find(r=>r.iso==='NL')||rows[0];await page.locator(`.heat-list-item[data-country="${selected.iso}"]`).click();
    const popup=page.locator('.country-popup--pinned');await popup.waitFor();assert.equal(await popup.getAttribute('data-monitoring-level'),level);assert.equal(await popup.getAttribute('data-snapshot-id'),snapshot.snapshot_id);
    assert.match(await popup.innerText(),/R1/);assert.doesNotMatch(await popup.innerText(),/undefined|NaN|GATED: low-share/);
    if(selected.iso==='NL'){assert.match(await popup.locator('.confirmed-impacts').innerText(),/Ahold/);assert.match(await popup.locator('.confirmed-impacts').innerText(),/2026-10-12/);}
    if(level==='green'&&size==='mobile'&&lang==='ja')await page.screenshot({path:path.join(out,`${tag}-mobile-green-popup.png`)});
    await popup.locator('.modal-close').click();results.push({size,lang,level,country:selected.iso,mapCountListPopup:true});
   }
   await page.locator('.level-filter select').selectOption('all');await page.locator('.app-header').scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${size} ${lang} overflow`);
   await page.screenshot({path:path.join(out,`${tag}-${size}-${lang}.png`)});
  }
 }
 const weekly=JSON.parse(fs.readFileSync('public/data/history/weekly_5y/index.json'));
 await page.goto(url+'#/country/US',{waitUntil:'domcontentloaded'});const section=page.locator(`[data-weekly-epoch="${weekly.epoch}"]`);await section.waitFor();assert.equal(await section.locator('tbody tr').count(),4);await page.screenshot({path:path.join(out,`${tag}-desktop-weekly.png`)});
 assert.deepEqual(failures,[]);fs.writeFileSync(path.join(out,`${tag}-browser.json`),JSON.stringify({url,snapshot_id:snapshot.snapshot_id,counts:snapshot.monitoring_counts,checks:results,page_errors:failures},null,2));console.log(JSON.stringify({status:'verified',tag,checks:results.length,snapshot:snapshot.snapshot_id}));
}finally{await context.close();}
