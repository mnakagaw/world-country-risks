import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const url=process.argv[2]||'http://127.0.0.1:4173/',tag=process.argv[3]||'local',out=path.resolve('.local/rindex-v202-evidence');fs.mkdirSync(out,{recursive:true});
const snapshot=JSON.parse(fs.readFileSync('public/data/v2/latest.json')),colors={red:'#ee2c2c',orange:'#f57c00',yellow:'#dca01d',green:'#388e3c',unknown:'#3d4654'};
const level=(c,m)=>m==='surge_r'?c.rindex_evaluation.level:m==='raw'?c.evaluation.initial_level:c.monitoring_level;
const context=await chromium.launchPersistentContext(path.resolve('work/edge-rindex-v202'),{headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:390,height:844},locale:'ja-JP',timezoneId:'Asia/Tokyo'});
const page=await context.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(()=>{localStorage.setItem('rw_view_mode','surge_r');localStorage.setItem('rw_lang','ja');localStorage.setItem('rw_theme','dark');});
async function popup(iso,mode){
 await page.locator(`.heat-list-item[data-country="${iso}"]`).click();const p=page.locator('.country-popup--pinned');await p.waitFor();
 assert.equal(await p.getAttribute('data-monitoring-level'),level(snapshot.countries[iso],mode));assert.equal(await p.getAttribute('data-snapshot-id'),snapshot.snapshot_id);assert.doesNotMatch(await p.innerText(),/undefined|NaN/);
 if(iso==='NL'){assert.match(await p.locator('.confirmed-impacts').innerText(),/Ahold/);assert.match(await p.locator('.confirmed-impacts').innerText(),/2026-10-12/);}
 return p;
}
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.locator(`.app[data-snapshot-id="${snapshot.snapshot_id}"]`).waitFor({timeout:120000});assert.equal(await page.locator('.app').getAttribute('data-view-mode'),'surge_r');await page.locator('path[data-country="US"]').first().waitFor({state:'attached',timeout:120000});
 for(const [size,viewport] of [['mobile',{width:390,height:844}],['desktop',{width:1440,height:1000}]]){
  await page.setViewportSize(viewport);
  for(const lang of ['ja','en','es']){
   await page.locator('.lang-btn').filter({hasText:lang==='ja'?'日本語':lang.toUpperCase()}).click();
   for(const [index,mode] of ['surge_r','raw','monitoring'].entries()){
    await page.locator('.view-mode-btn').nth(index).click();assert.equal(await page.locator('.app').getAttribute('data-view-mode'),mode);
    const controls=await page.locator('.lang-btn,.view-mode-btn,.theme-btn').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {label:n.innerText,left:r.left,right:r.right,limit:innerWidth};}));for(const c of controls)assert.ok(c.left>=0&&c.right<=c.limit,`${size} ${lang} clipped: ${c.label}`);
    for(const [value,count] of Object.entries(snapshot.mode_counts[mode]))assert.match(await page.locator(`.alert-count--${value}`).innerText(),new RegExp(`^${count}\\b`));
    const paths=await page.locator('path[data-country]').evaluateAll(nodes=>nodes.map(n=>({iso:n.dataset.country,fill:n.getAttribute('fill')})));for(const p of paths)if(snapshot.countries[p.iso])assert.equal(p.fill,colors[level(snapshot.countries[p.iso],mode)],`${p.iso} ${mode}`);
    await page.locator('.country-search input').fill('');
    for(const value of ['red','orange','yellow','green','unknown']){
     await page.locator('.level-filter select').selectOption(value);const rows=await page.locator('.heat-list-item').evaluateAll(nodes=>nodes.map(n=>({iso:n.dataset.country,level:n.dataset.monitoringLevel})));
     assert.ok(snapshot.mode_counts[mode][value]===0?rows.length===0:rows.length>0);for(const r of rows)assert.equal(r.level,value);
     if(rows.length){const p=await popup(rows[0].iso,mode);await p.locator('.modal-close').click();}checks.push({size,lang,mode,level:value,mapCountsListPopup:true});
    }
    await page.locator('.level-filter select').selectOption('all');
    for(const iso of ['US','JP','NL']){
     await page.locator('.country-search input').fill(iso);const p=await popup(iso,mode);if(lang==='ja')await page.screenshot({path:path.join(out,`${tag}-${size}-${mode}-${iso}.png`)});await p.locator('.modal-close').click();checks.push({size,lang,mode,country:iso,level:level(snapshot.countries[iso],mode)});
    }
    await page.locator('.country-search input').fill('');await page.locator('.app-header').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(out,`${tag}-${size}-${lang}-${mode}.png`)});
   }
  }
 }
 const weekly=JSON.parse(fs.readFileSync('public/data/history/weekly_5y/index.json'));await page.goto(url+'#/country/US',{waitUntil:'domcontentloaded'});const section=page.locator(`[data-weekly-epoch="${weekly.epoch}"]`);await section.waitFor({timeout:120000});assert.equal(await section.locator('tbody tr').count(),4);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,`${tag}-browser.json`),JSON.stringify({url,snapshot_id:snapshot.snapshot_id,mode_counts:snapshot.mode_counts,checks,page_errors:errors},null,2));console.log(JSON.stringify({status:'verified',tag,checks:checks.length,snapshot:snapshot.snapshot_id}));
}finally{await context.close();}
