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
        base=ROOT/'work/sync-cycle-fixtures';base.mkdir(parents=True,exist_ok=True);self.temp=tempfile.TemporaryDirectory(dir=base);self.root=Path(self.temp.name);self.events=[];self.now=datetime(2026,10,14,22,tzinfo=timezone.utc)
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
    def test_same_date_different_release_or_selected_input_is_new_identity(self):
        self.assertEqual(self.call()['status'],'verified');self.binding['bundle_id']='accepted-15-source-v2';self.binding['execbrief_release']='release-15-r1';self.assertEqual(self.call()['status'],'verified');self.assertEqual(self.events.count('source'),2)
    def test_completed_source_SHA_corruption_is_not_reused(self):
        self.assertEqual(self.call()['status'],'verified');source=next((self.root/'series/cycles').rglob('source.json'));source.write_text('tampered fixture');r=self.call();self.assertEqual(r['status'],'retry_sync_stage');self.assertEqual(r['reason'],'completed_input_or_publication_receipt_SHA_mismatch');self.assertEqual(self.events.count('publish'),1)
    def test_effective_date_does_not_replace_original05_today(self):
        self.assertEqual(self.call(now=datetime(2026,10,14,12,tzinfo=timezone.utc))['status'],'awaiting_sync_effective_date');self.assertEqual(self.events,[])
    def test_retries_are_bounded_and_expired_date_keeps_previous(self):
        self.policy['max_daily_checks']=1;self.config.write_text(json.dumps(self.policy))
        def wait(*a):raise Waiting('parent_unfinished')
        self.assertEqual(self.call(wait)['status'],'waiting_execbrief_daily');self.assertEqual(self.call(wait)['status'],'expired_execbrief_daily');self.assertEqual(self.events,[])
        self.assertEqual(self.call(now=datetime(2026,10,15,15,tzinfo=timezone.utc))['status'],'expired_execbrief_daily')

if __name__=='__main__':unittest.main()
