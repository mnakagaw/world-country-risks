"""Staged revision transaction in isolated fixtures, with fake network publication."""
from pathlib import Path
from datetime import timedelta
from unittest.mock import patch
import json,unittest,shutil
from source_supplement_test import ContractFixture,ref
from source_revision_test import save
import source_revision_cycle as cycle
import source_revision_adapter as adapter
from execbrief_sync import Waiting

class RevisionCycle(ContractFixture,unittest.TestCase):
    def setUp(self):
        super().setUp();self.external=self.root/'external';self.events=[];self.calls=0
        save(self.series/'v2-history.json',{});save(self.series/'baseline-sources'/(self.day+'.json'),{'fixture_only':True})
        save(Path(self.policy['handoff_root'])/'daily-latest.json',{'path':'daily/'+self.day+'/'+self.parent,'snapshot_id':self.parent})
        self.patches=[patch.object(cycle,'ROOT',self.root),patch.object(cycle,'method_epoch',return_value='fixture-method'),patch.object(cycle,'external_root',return_value=self.external),
            patch.object(cycle,'daily_paths',side_effect=self.paths),patch.object(cycle,'c_plan',return_value={'writer_chain':{},'fixture_only':True}),patch('sync_article_context.export',side_effect=lambda p,b,o:Path(o).write_bytes(b'{}'))]
        for p in self.patches:p.start()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        super().tearDown()
    def paths(self,root,policy,day,key,**kwargs):
        base=self.external/'world-country-risks/daily'/day/key;return base/'dist',base/'publications'
    def runner(self,command,log,timeout):
        self.events.append(log.stem);base=log.parent;log.write_bytes(b'fixture only: no network or collector')
        if log.stem=='source':
            config=json.loads(Path(command[command.index('--config')+1]).read_bytes())
            self.assertTrue(Path(config['series_root']).is_relative_to(self.external));self.assertTrue(Path(command[command.index('--output')+1]).is_relative_to(self.external))
            save(Path(command[command.index('--output')+1]),{'schema':'fixture-source','fixture_only':True})
        elif log.stem=='generate':
            generated=Path(command[command.index('--output-dir')+1]);source=json.loads((base/'source.json').read_bytes());binding=source['upstream_sync'];identifier='c'*64
            value={'snapshot_id':identifier,'date':self.day,'cutoff_series':'execbrief-03-v1','cutoff_utc':self.binding['cutoff_utc'],'upstream_sync':binding,'fixture_only':True}
            checksum=save(generated/(identifier+'.json'),value);records=json.loads((generated/'manifest.json').read_bytes());old=records[self.day]
            record={'snapshot_id':identifier,'path':identifier+'.json','sha256':checksum,'revisions':[{'snapshot_id':old['snapshot_id'],'path':old['path'],'sha256':old['sha256'],'kind':'original'},{'snapshot_id':identifier,'path':identifier+'.json','sha256':checksum,'kind':'late_source_revision','accepted_at_utc':self.at.isoformat()}]};records[self.day]=record;save(generated/'manifest.json',records)
            if '--historical' not in command:save(generated/'latest.json',value);save(generated/'status.json',{'date':self.day,'snapshot_id':identifier})
        elif log.stem=='build':
            if getattr(self,'fail_build',False):self.fail_build=False;raise Waiting('fixture-build-failure')
            dist=Path(command[command.index('--outDir')+1]);shutil.copytree(self.root/'public',dist,dirs_exist_ok=True);(dist/'index.html').write_bytes(b'fixture')
        elif log.stem=='publish':
            self.calls+=1;dist=Path(command[command.index('--dist')+1]);release=Path(command[command.index('--release-root')+1])/'fixture';files={p.relative_to(dist).as_posix():{'sha256':ref(p)['sha256'],'http_verified':True} for p in dist.rglob('*') if p.is_file()};save(release/'receipt.json',{'status':'verified','files':files,'fixture_only':True})
    def call(self):return cycle.consume(self.policy,self.request,self.runner)
    def test_current_revision_keeps_original_publishes_once_and_promotes_after_proof(self):
        proof=self.call();self.assertEqual(proof['snapshot_id'],'c'*64);self.assertEqual(self.events,['source','generate','build','publish']);self.assertEqual(self.calls,1)
        public=self.root/'public/data/v2';self.assertEqual((public/(self.parent+'.json')).read_bytes(),self.original_public[self.parent+'.json']);self.assertEqual(json.loads((public/'latest.json').read_bytes())['snapshot_id'],'c'*64)
        self.assertEqual(cycle.recover(self.root,self.policy,self.request),proof);self.assertEqual(self.calls,1);adapter.completed_proof(self.root,self.request,proof)
    def test_failure_resumes_build_without_repeating_source_or_generation(self):
        self.fail_build=True
        with self.assertRaisesRegex(Waiting,'fixture-build-failure'):self.call()
        self.assertEqual((self.root/'public/data/v2/latest.json').read_bytes(),self.original_public['latest.json']);self.call()
        self.assertEqual(self.events,['source','generate','build','build','publish']);self.assertEqual(self.calls,1)
    def test_later_day_history_only_preserves_current_and_NAS_current(self):
        public=self.root/'public/data/v2';newer=(__import__('datetime').datetime.fromisoformat(self.day)+timedelta(days=1)).date().isoformat()
        for name in ['latest.json','status.json']:save(public/name,{'date':newer,'snapshot_id':'e'*64})
        nas=Path(self.policy['handoff_root'])/'daily-latest.json';save(nas,{'path':'daily/'+newer+'/'+'e'*64,'snapshot_id':'e'*64})
        before=[(public/'latest.json').read_bytes(),(public/'status.json').read_bytes(),nas.read_bytes()];self.call()
        self.assertEqual(before,[(public/'latest.json').read_bytes(),(public/'status.json').read_bytes(),nas.read_bytes()])
        self.assertEqual(json.loads((public/'manifest.json').read_bytes())[self.day]['snapshot_id'],'c'*64)
    def test_crash_after_verified_NAS_recovers_without_source_or_republication(self):
        original=cycle.finalize
        with patch.object(cycle,'finalize',side_effect=OSError('fixture crash after checkpoint')):
            with self.assertRaises(OSError):self.call()
        self.assertEqual(self.calls,1);self.assertEqual(json.loads((self.root/'public/data/v2/latest.json').read_bytes())['snapshot_id'],self.parent)
        proof=cycle.recover(self.root,self.policy,self.request);self.assertEqual(proof['snapshot_id'],'c'*64);self.assertEqual(self.calls,1)
    def test_output_cap_defers_without_truncating_original_or_relabeling_missing_data(self):
        target=self.root/'public/data/v2/latest.json';before=target.read_bytes()
        with self.assertRaisesRegex(Waiting,'output_limit'):cycle.replace(target,b'12345',4)
        self.assertEqual(target.read_bytes(),before)
    def test_forged_completion_outside_registered_F_is_rejected(self):
        proof=self.call();candidate=json.loads(cycle.candidate_path(self.root,self.request).read_bytes());candidate['generated_dir']=str(self.root/'outside/generated-v2')
        with self.assertRaises(adapter.InvalidRequest):cycle.finalize(self.root,self.policy,self.request,candidate)
    def test_source_resource_wait_uses_only_fresh_attempt_metrics(self):
        from types import SimpleNamespace
        from datetime import datetime,timezone
        base=self.external/'process-fixture';base.mkdir(parents=True);log=base/'source.log'
        for fresh in [True,False]:
            def child(*args,**kwargs):
                save(base/'source-metrics.json',{'error_type':'StorageDeferred','started_at_utc':datetime.now(timezone.utc).isoformat() if fresh else '2020-01-01T00:00:00+00:00'})
                return SimpleNamespace(returncode=1,stdout=b'',stderr=b'fixture resource limit')
            with patch.object(cycle.subprocess,'run',side_effect=child),self.assertRaisesRegex(Waiting,'revision_source_resource_deferred' if fresh else 'revision_stage_failed'):
                cycle.run(['never-executed'],log,1)

if __name__=='__main__':unittest.main()
