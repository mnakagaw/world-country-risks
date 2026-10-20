import test from 'node:test';import assert from 'node:assert/strict';
const {coverageText}=await import(process.env.WCR_COVERAGE_MODULE||'../src/coverage-text.js');
test('published slot counts distinguish aggregation from raw presence and safety',()=>{
 for(const language of ['ja','en','es']){
  const value=coverageText({available_slots:82,expected_slots:192},language);assert.match(value.summary,/82\/192/);assert.ok(value.detail.length>40);assert.ok(value.help);
 }
 assert.match(coverageText({available_slots:82,expected_slots:192},'en').detail,/Raw-file presence, normalization, formal acceptance and publication are separate/);
});
test('missing or impossible coverage does not acquire a fabricated count',()=>{
 for(const value of [null,{}, {available_slots:null,expected_slots:192},{available_slots:-1,expected_slots:192},{available_slots:193,expected_slots:192},{available_slots:0,expected_slots:0}])assert.equal(coverageText(value),null);
 assert.match(coverageText({available_slots:0,expected_slots:192}).summary,/0\/192/);
});
