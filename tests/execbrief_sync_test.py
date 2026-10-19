"""Isolated synchronization contracts; no live writes, collection or scheduler."""
import unittest,json,copy,tempfile,sys,os
from pathlib import Path
from datetime import datetime,timedelta,timezone
from hashlib import sha256
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from execbrief_sync import freeze_inputs,Waiting,closed_edition,canonical,ROOT_RELEASE_REMAINING
from cycle_lock import publication_lock
from sync_article_context import export as context_export

def raw(v):return json.dumps(v).encode()
def sha(b):return sha256(b).hexdigest()
class Gate(unittest.TestCase):
    def setUp(self):
        base=ROOT/'work/sync-fixtures';base.mkdir(parents=True,exist_ok=True);self.temp=tempfile.TemporaryDirectory(dir=base);self.root=Path(self.temp.name);self.producer=self.root/'producer';self.day='2026-10-15';self.cutoff=datetime(2026,10,14,18,tzinfo=timezone.utc);self.work=self.producer/'.daily-work'/self.day;self.work.mkdir(parents=True)
        self.policy={'execbrief_root':str(self.producer),'execbrief_handoff_root':str(self.root/'NAS'),'interest_root':str(self.root/'interest')}
        def put(p,value):p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw(value));return p.read_bytes()
        self.put=put
        gkg={'run_date':self.day,'cutoff_utc':'2026-10-14T18:00:00Z','dataset_hash':'raw-epoch','retained_events_mentions':{'manifest_references':[]}}
        g=put(self.work/'gkg-run-manifest-v1.json',gkg)
        ed={'date':self.day,'information_cutoff_utc':gkg['cutoff_utc'],'gkg_manifest_sha256':sha(g),'gdelt_dataset_hash':'raw-epoch','stories':[]};edraw=raw(ed);stress=raw({'date':self.day})
        latest={'date':self.day,'edition':'initial','information_cutoff_utc':gkg['cutoff_utc'],'editorial':{'path':'/data/daily-editorial/'+self.day+'.json','sha256':sha(edraw)},'system_stress':{'path':'/data/world-stress/'+self.day+'.json','sha256':sha(stress)}}
        self.remote={'/data/latest-edition.json':raw(latest),latest['editorial']['path']:edraw,latest['system_stress']['path']:stress}
        for n,b in self.remote.items():p=self.producer/'dist'/n.lstrip('/');p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
        final={'run_date':self.day,'content_check_complete':True,'unapplied_findings':0,'checked_at_utc':'2026-10-14T20:00:00Z','accepted_final_editorial_snapshot':{'sha256':sha(edraw)}};f=put(self.work/'final.json',final)
        checks={'passed':True,'inputs_unchanged':True,'editorial_acceptance_unchanged':True,'editorial_acceptance':{'run_date':self.day,'edition_sha256':sha(edraw),'final_receipt':str(self.work/'final.json'),'final_receipt_sha256':sha(f)}};c=put(self.work/'checks.json',checks)
        manifest={'verified':True,'destination':'https://execbrief.net','release':'release-15','files':{n.lstrip('/'):sha(b) for n,b in self.remote.items()}};m=put(self.work/'manifest.json',manifest)
        self.receipt={'verified':True,'exit_code':0,'release':'release-15','manifest_path':str(self.work/'manifest.json'),'manifest_sha256':sha(m),'local_gate':{'checks_receipt':str(self.work/'checks.json'),'checks_receipt_sha256':sha(c)},'verified_at_utc':'2026-10-14T21:00:00Z'};put(self.work/'publication-receipt.json',self.receipt)
        self.seal=self.root/'interest/sealed/20261014T180000Z.json';put(self.seal,{'snapshot_id':'seal-03','window':{'start_utc':'2026-10-13T18:00:00Z','end_utc':'2026-10-14T18:00:00Z','semantics':'[start,end)'}})
    def tearDown(self):self.temp.cleanup()
    def gate(self,fetch=None):return freeze_inputs(self.policy,self.day,self.cutoff,self.root/'frozen',fetch or self.remote.__getitem__)
    def modern(self,change=None):
        checks=json.loads((self.work/'checks.json').read_bytes());ed=checks['editorial_acceptance']['edition_sha256'];stress=sha(self.remote['/data/world-stress/'+self.day+'.json'])
        final={'run_date':self.day,'status':'accepted_exact_source_awaiting_root_release_checks','recorded_at_utc':'2026-10-14T20:00:00Z',
          'projection':{'edition_sha256':ed,'world_stress_sha256':stress},'summary_review':{'pending_apply':0},'remaining':[ROOT_RELEASE_REMAINING],
          'checks':{**{k:'passed' for k in ['edition_schema','stress_schema_and_recalculation','world_and_16_overviews_exact_adoption','JP_DO_accepted_items_and_priority_exact']},'country_author_world_independence_preserved':True},
          'exact_read_boundary':{'rows':[{'canonical_path':str(self.producer/'content/daily-editorial'/(self.day+'.json')),'sha256':ed},{'canonical_path':str(self.producer/'content/world-stress'/(self.day+'.json')),'sha256':stress}]}}
        if change:change(final)
        f=self.put(self.work/'final.json',final);checks['editorial_acceptance']['final_receipt_sha256']=sha(f)
        checks.update(schema_version='release-checks-v1',scope='daily-excluding-live-search',checks={k:{'returncode':0} for k in ['validate','python_tests','syntax']})
        c=self.put(self.work/'checks.json',checks);self.receipt['local_gate']['checks_receipt_sha256']=sha(c);self.put(self.work/'publication-receipt.json',self.receipt)
        return final
    def test_exact_source_acceptance_is_closed_by_bound_root_checks_and_publication(self):
        final=self.modern();folder,binding=self.gate();self.assertNotIn('content_check_complete',final);self.assertEqual(binding['information_confirmed_at_utc'],final['recorded_at_utc']);self.assertEqual((folder/'acceptance.json').read_bytes(),raw(final))
    def projected(self,change=None):
        final=self.modern();final.pop('remaining');final.pop('exact_read_boundary');final.pop('checks')
        final.update(kind='checker-prepublication-final-receipt-v1',status='passed_for_existing_build_and_release_checks',content_check_complete=True)
        p=final['projection'];p['edition_path']=str(self.producer/'content/daily-editorial'/(self.day+'.json'));p['stress_path']=str(self.producer/'content/world-stress'/(self.day+'.json'));p['stress_sha256']=p.pop('world_stress_sha256')
        if change:change(final)
        c=json.loads((self.work/'checks.json').read_bytes());c['editorial_acceptance']['final_receipt_sha256']=sha(self.put(self.work/'final.json',final));self.receipt['local_gate']['checks_receipt_sha256']=sha(self.put(self.work/'checks.json',c));self.put(self.work/'publication-receipt.json',self.receipt)
    def test_published_projection_contract_keeps_both_byte_bindings(self):
        self.projected();self.assertEqual(self.gate()[1]['date'],self.day)
    def incremental(self,change=None):
        final=self.modern();final={'schema':'execbrief-final-incremental-acceptance-v1','accepted':True,'run_date':self.day,'projection':{'edition_sha256':final['projection']['edition_sha256']},'summary_review':{'pending_apply':0,'material_findings':[]},'findings':[],
          'current_files':[{'path':r['canonical_path'],'sha256':r['sha256']} for r in final['exact_read_boundary']['rows']],
          'bounded_verification':{'built_final_SHA_verified':True,'dist_dated_editorial':{'sha256':final['projection']['edition_sha256']}}}
        if change:change(final)
        c=json.loads((self.work/'checks.json').read_bytes());c['editorial_acceptance']['final_receipt_sha256']=sha(self.put(self.work/'final.json',final));self.receipt['local_gate']['checks_receipt_sha256']=sha(self.put(self.work/'checks.json',c));self.put(self.work/'publication-receipt.json',self.receipt)
    def test_incremental_acceptance_binds_current_raw_bytes_not_normalized_text_hash(self):
        self.incremental();self.assertEqual(self.gate()[1]['date'],self.day)
        for change in [lambda f:f.update(accepted=False),lambda f:f['current_files'].pop(),lambda f:f['bounded_verification']['dist_dated_editorial'].update(sha256='0'*64)]:
            self.incremental(change)
            with self.assertRaises(Waiting):self.gate()
    def test_historical_original_pointer_is_SHA_bound_and_never_replaces_current_pointer(self):
        old=self.put(self.work/'old-latest.json',json.loads(self.remote['/data/latest-edition.json']))
        self.remote['/data/latest-edition.json']=raw({'date':'2026-10-19'})
        (self.producer/'dist/data/latest-edition.json').write_bytes(self.remote['/data/latest-edition.json'])
        folder,binding=freeze_inputs(self.policy,self.day,self.cutoff,self.root/'frozen',self.remote.__getitem__,historical_latest_path=self.work/'old-latest.json')
        self.assertEqual((folder/'latest-edition.json').read_bytes(),old);self.assertFalse(binding['historical_recovery']['countryrisks_published_at_original_date'])
        (self.work/'old-latest.json').write_bytes(old+b' ')
        with self.assertRaises(Waiting):freeze_inputs(self.policy,self.day,self.cutoff,self.root/'frozen',self.remote.__getitem__,historical_latest_path=self.work/'old-latest.json')
    def test_projection_pending_wrong_paths_and_hashes_remain_blocked(self):
        changes=[lambda f:f['summary_review'].update(pending_apply=1),lambda f:f['projection'].update(edition_sha256='0'*64),lambda f:f['projection'].update(stress_sha256='0'*64),lambda f:f['projection'].update(edition_path=str(self.producer/'other.json')),lambda f:f['projection'].pop('stress_path'),lambda f:f['summary_review'].update(new_unresolved_material_findings=1),lambda f:f.update(content_check_complete=False)]
        for change in changes:
            with self.subTest(change=changes.index(change)):
                self.projected(change)
                with self.assertRaises(Waiting):self.gate()
    def test_modern_missing_content_proofs_or_unapplied_findings_stay_blocked(self):
        changes=[lambda f:f['summary_review'].pop('pending_apply'),lambda f:f['summary_review'].update(pending_apply=1),lambda f:f.update(remaining=['Review unaccepted content']),lambda f:f['projection'].update(edition_sha256='0'*64),lambda f:f['exact_read_boundary']['rows'].pop(),lambda f:f['exact_read_boundary']['rows'][0].update(sha256='0'*64),lambda f:f['checks'].update(edition_schema='failed'),lambda f:f.update(content_check_complete=False)]
        for change in changes:
            with self.subTest(change=changes.index(change)):
                self.modern(change)
                with self.assertRaises(Waiting):self.gate()
    def test_exact_source_receipt_never_substitutes_for_successful_root_checks(self):
        self.modern();c=json.loads((self.work/'checks.json').read_bytes());c['checks']['validate']['returncode']=1;b=self.put(self.work/'checks.json',c);self.receipt['local_gate']['checks_receipt_sha256']=sha(b);self.put(self.work/'publication-receipt.json',self.receipt)
        with self.assertRaises(Waiting):self.gate()
    def test_after_cutoff_acceptance_is_not_new_information_and_same_bundle_reuses(self):
        a,b=self.gate();c,d=self.gate();self.assertEqual(a,c);self.assertEqual(b,d);self.assertEqual(b['information_confirmed_at_utc'],'2026-10-14T20:00:00Z');self.assertEqual(b['cutoff_utc'],'2026-10-14T18:00:00Z')
    def test_unfinished_or_failed_receipt_cannot_publish(self):
        for key,value in [('verified',False),('exit_code',1)]:
            r=copy.deepcopy(self.receipt);r[key]=value;self.put(self.work/'publication-receipt.json',r)
            with self.assertRaises(Waiting):self.gate()
    def test_previous_date_or_other_cutoff_is_rejected(self):
        for key,value in [('date','2026-10-14'),('information_cutoff_utc','2026-10-14T20:00:00Z')]:
            d=json.loads(self.remote['/data/latest-edition.json']);d[key]=value;remote=dict(self.remote);remote['/data/latest-edition.json']=raw(d)
            with self.assertRaises(Waiting):self.gate(remote.__getitem__)
    def test_SHA_disagreement_or_wrong_local_projection_waits(self):
        original=self.remote['/data/daily-editorial/'+self.day+'.json'];self.remote['/data/daily-editorial/'+self.day+'.json']=original+b' '
        with self.assertRaises(Waiting):self.gate()
        self.remote['/data/daily-editorial/'+self.day+'.json']=original;(self.producer/'dist/data/latest-edition.json').write_bytes(b'{}')
        with self.assertRaises(Waiting):self.gate()
    def test_epoch_change_during_read_waits(self):
        count=0
        def fetch(n):
            nonlocal count
            if n=='/data/latest-edition.json':
                count+=1
                if count==2:return b'{}'
            return self.remote[n]
        with self.assertRaises(Waiting):self.gate(fetch)
    def test_missing_or_other_time_search_seal_waits(self):
        self.seal.unlink()
        with self.assertRaises(Waiting):self.gate()
        self.put(self.seal,{'snapshot_id':'wrong','window':{'end_utc':'2026-10-14T20:00:00Z','start_utc':'2026-10-13T20:00:00Z','semantics':'[start,end)'}})
        with self.assertRaises(Waiting):self.gate()
    def test_OS_lock_prevents_duplicate_and_releases_after_failure(self):
        p=self.root/'publish.lock'
        with publication_lock(p) as first:
            self.assertTrue(first)
            with publication_lock(p) as second:self.assertFalse(second)
        try:
            with publication_lock(p) as acquired:
                self.assertTrue(acquired);raise RuntimeError('fixture')
        except RuntimeError:pass
        with publication_lock(p) as again:self.assertTrue(again)
    def test_closed_cutoff_before_and_after03(self):
        day,end=closed_edition(datetime(2026,10,14,17,59,tzinfo=timezone.utc));self.assertEqual(day,'2026-10-14');self.assertEqual(end.hour,18);self.assertEqual(end.day,13)
        day,end=closed_edition(datetime(2026,10,14,18,0,tzinfo=timezone.utc));self.assertEqual(day,'2026-10-15');self.assertEqual(end.day,14)
    def test_sealed_article_context_excludes_explicit_late_fact_but_keeps_late_verification(self):
        f,b=self.gate();p=self.producer/'engine/gdelt.py';p.parent.mkdir();p.write_text('TRACKING_PARAMETERS=set()\ndef canonical_url(url):return url\n')
        editorial=json.loads((f/'editorial.json').read_bytes());editorial['stories']=[{'id':'accepted-before','url':'https://source.invalid/before','country_codes':['JP'],'published_at_utc':'2026-10-14T17:59:00Z','summary':{'en':'accepted source statement'}},{'id':'late','url':'https://source.invalid/late','country_codes':['JP'],'published_at_utc':'2026-10-14T18:01:00Z'}]
        # Fixture-only manifest, not a mutation of the real sealed upstream bundle.
        fixture=self.root/'context-fixture';fixture.mkdir();self.put(fixture/'editorial.json',editorial);(fixture/'manifest.json').write_bytes((f/'manifest.json').read_bytes());(fixture/'search-interest-seal.json').write_bytes((f/'search-interest-seal.json').read_bytes())
        result=context_export(self.policy,fixture,self.root/'context.json');self.assertEqual(len(result['articles']),1);self.assertEqual(result['explicit_post_cutoff_articles_excluded'],['late']);self.assertIsNone(result['articles'][0]['r_claims'][0]['r']);self.assertEqual(result['new_ai_calls'],0)

if __name__=='__main__':unittest.main()
