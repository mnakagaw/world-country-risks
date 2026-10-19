"""Run fake stages only in task-owned fixtures; never publish or schedule."""
import unittest,tempfile,json,sys,copy
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import synced_cycle as cycle
from execbrief_sync import Waiting

class Resume(unittest.TestCase):
    def setUp(self):
        # Keep rapid atomic-write logic fixtures off the live OneDrive sync tree.
        self.temp=tempfile.TemporaryDirectory(prefix='countryrisks-cycle-fixture-');self.root=Path(self.temp.name);self.events=[];self.now=datetime(2026,10,14,22,tzinfo=timezone.utc)
        self.policy={'enabled':True,'sync_effective_date':'2026-10-15','series_root':str(self.root/'series'),'max_daily_checks':84,'node':'fixture-node','credential_file':'never-read-by-fixture'};self.config=self.root/'controller.json';self.config.write_text(json.dumps(self.policy))
        self.binding={'bundle_id':'accepted-15-source-v1','date':'2026-10-15','cutoff_utc':'2026-10-14T18:00:00Z','execbrief_release':'release-15'};self.bundle=self.root/'bundle';self.bundle.mkdir()
        self.original=cycle.ROOT;cycle.ROOT=self.root;self.p1=patch.object(cycle,'method_epoch',return_value='calculation-v1');self.p1.start();self.p2=patch('sync_article_context.export',side_effect=lambda policy,bundle,p:Path(p).write_text('{}'));self.p2.start();self.p3=patch('handoff_v2.save',return_value={'status':'verified'});self.p3.start()
        p=self.root/'public/data/v2/latest.json';p.parent.mkdir(parents=True);p.write_text('{"snapshot_id":"previous_verified"}')
    def tearDown(self):self.p3.stop();self.p2.stop();self.p1.stop();cycle.ROOT=self.original;self.temp.cleanup()
    def gate(self,*args):return self.bundle,copy.deepcopy(self.binding)
    def runner(self,command,log,timeout):
        name=log.stem;self.events.append(name)
        if name=='build' and getattr(self,'fail_once',False):self.fail_once=False;raise RuntimeError('fixture_build_failure')
        if name=='source':Path(command[command.index('--output')+1]).write_text('{"schema":"country-risk-observations-v2"}')
        elif name=='generate':(self.root/'public/data/v2/latest.json').write_text(json.dumps({'snapshot_id':'snapshot-'+self.binding['bundle_id']}))
        elif name=='build':
            d=self.root/'dist';(d/'data/v2').mkdir(parents=True,exist_ok=True);(d/'index.html').write_text('fixture');(d/'data/v2/latest.json').write_bytes((self.root/'public/data/v2/latest.json').read_bytes());(d/'data/v2/manifest.json').write_text('{}')
        elif name=='publish':
            p=self.root/'.local/releases/20261015T000000Z/receipt.json';p.parent.mkdir(parents=True,exist_ok=True);p.write_text('{"status":"verified","files":{}}')
        log.write_text('fake stage: no network, source collection or live writes')
    def call(self,gate=None,now=None):return cycle.cycle(self.config,now or self.now,gate or self.gate,self.runner)
    def test_waiting_parent_keeps_previous_publication(self):
        def wait(*a):raise Waiting('parent_unfinished')
        self.assertEqual(self.call(wait)['status'],'waiting_execbrief_daily');self.assertEqual(self.events,[]);self.assertEqual(json.loads((self.root/'public/data/v2/latest.json').read_bytes())['snapshot_id'],'previous_verified')
    def test_failure_resumes_same_stage_and_same_inputs_reuse(self):
        self.fail_once=True;self.assertEqual(self.call()['status'],'retry_sync_stage');self.assertEqual(self.events,['source','generate','build'])
        self.assertEqual(self.call()['status'],'verified');self.assertEqual(self.events,['source','generate','build','build','publish']);self.assertTrue(self.call()['reused']);self.assertEqual(len(self.events),5)
    def test_real_stage_times_failures_and_reuse_are_recorded_without_reexecution(self):
        self.fail_once=True;failed=self.call();self.assertEqual(failed['stage_attempts']['build'][0]['status'],'failed')
        result=self.call();self.assertEqual(result['reuse_counts']['source'],1);self.assertEqual(result['reuse_counts']['generate'],1)
        for name in ['source','generate','build','publish','handoff']:
            stage=result['stages'][name];self.assertGreaterEqual(datetime.fromisoformat(stage['finished_at_utc']),datetime.fromisoformat(stage['started_at_utc']));self.assertGreaterEqual(stage['elapsed_seconds'],0)
        started=result['stages']['source']['started_at_utc'];again=self.call();self.assertEqual(again['stages']['source']['started_at_utc'],started);self.assertEqual(again['reuse_counts']['complete_cycle'],1);self.assertEqual(self.events.count('source'),1);self.assertEqual(len(again['stage_attempts']['build']),2)
    def test_source_metrics_are_linked_to_the_actual_attempt(self):
        def runner(command,log,timeout):
            started=cycle.utc();self.runner(command,log,timeout)
            if log.stem=='source':(log.parent/'source-metrics.json').write_text(json.dumps({'started_at_utc':started,'finished_at_utc':cycle.utc(),'reuse_counts':{'baseline_dto_existing_cache':13}}))
        result=cycle.cycle(self.config,self.now,self.gate,runner);self.assertEqual(result['stages']['source']['performance']['reuse_counts']['baseline_dto_existing_cache'],13)
    def test_failed_attempt_does_not_claim_an_old_attempts_metrics(self):
        def runner(command,log,timeout):
            (log.parent/'source-metrics.json').write_text('{"started_at_utc":"2020-01-01T00:00:00+00:00"}');raise RuntimeError('fixture early failure')
        result=cycle.cycle(self.config,self.now,self.gate,runner);attempt=result['stage_attempts']['source'][0];self.assertEqual(attempt['status'],'failed');self.assertNotIn('performance',attempt);self.assertEqual(attempt['performance_status'],'not_available_for_this_attempt')
    def test_same_date_different_release_or_selected_input_is_new_identity(self):
        self.assertEqual(self.call()['status'],'verified');self.binding['bundle_id']='accepted-15-source-v2';self.binding['execbrief_release']='release-15-r1';self.assertEqual(self.call()['status'],'verified');self.assertEqual(self.events.count('source'),2)
    def test_completed_source_SHA_corruption_is_not_reused(self):
        self.assertEqual(self.call()['status'],'verified');source=next((self.root/'series/cycles').rglob('source.json'));source.write_text('tampered fixture');r=self.call();self.assertEqual(r['status'],'retry_sync_stage');self.assertEqual(r['reason'],'completed_input_or_publication_receipt_SHA_mismatch');self.assertEqual(self.events.count('publish'),1)
    def test_effective_date_does_not_replace_original05_today(self):
        self.assertEqual(self.call(now=datetime(2026,10,14,12,tzinfo=timezone.utc))['status'],'awaiting_sync_effective_date');self.assertEqual(self.events,[])
    def test_history_recovery_preserves_current_pointer_and_uses_separate_receipt(self):
        self.binding.update(date='2026-10-16',cutoff_utc='2026-10-15T18:00:00Z',historical_recovery={'countryrisks_published_at_original_date':False})
        before=(self.root/'public/data/v2/latest.json').read_bytes()
        def runner(command,log,timeout):
            if log.stem=='generate':
                self.assertIn('--historical',command);d=self.root/'public/data/v2';(d/'recovered.json').write_text('{"snapshot_id":"recovered16","date":"2026-10-16"}');(d/'manifest.json').write_text('{"2026-10-16":{"path":"recovered.json"}}');self.events.append('generate');log.write_text('fixture')
            else:self.runner(command,log,timeout)
        def gate(*args,**kwargs):
            self.assertEqual(args[1],'2026-10-16');self.assertEqual(args[2].isoformat(),'2026-10-15T18:00:00+00:00');self.assertEqual(kwargs['historical_latest_path'],'original-bound-pointer');return self.gate()
        result=cycle.cycle(self.config,datetime(2026,10,19,3,tzinfo=timezone.utc),gate,runner,recovery={'date':'2026-10-16','latest_edition_path':'original-bound-pointer'})
        self.assertEqual(result['status'],'verified');self.assertEqual((self.root/'public/data/v2/latest.json').read_bytes(),before);self.assertTrue((self.root/'series/recovery-requests/2026-10-16/receipt.json').exists());self.assertFalse((self.root/'series/requests/2026-10-16/receipt.json').exists())
    def test_retries_are_bounded_and_expired_date_keeps_previous(self):
        self.policy['max_daily_checks']=1;self.config.write_text(json.dumps(self.policy))
        def wait(*a):raise Waiting('parent_unfinished')
        self.assertEqual(self.call(wait)['status'],'waiting_execbrief_daily');self.assertEqual(self.call(wait)['status'],'expired_execbrief_daily');self.assertEqual(self.events,[])
        self.assertEqual(self.call(now=datetime(2026,10,15,15,tzinfo=timezone.utc))['status'],'expired_execbrief_daily')

if __name__=='__main__':unittest.main()
