"""Isolated queue/native transport fixtures; no accepted source or real publication."""
import copy,gzip,importlib.util,json,os,sys,tempfile,unittest
from pathlib import Path
from datetime import datetime,timedelta,timezone
from hashlib import sha256
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import source_revision_queue as queue
import source_revision_adapter as adapter
from cycle_lock import publication_lock
from execbrief_sync import canonical,closed_edition

RUNTIME=Path.home()/'Documents/ExecBrief-Periodic/runtime/periodic_worker.py'

def save(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);raw=canonical(value)+b'\n';path.write_bytes(raw);return sha256(raw).hexdigest()

class Fixture:
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='wcr-source-revision-');self.root=Path(self.temp.name)
        self.now=datetime.now(timezone.utc);self.day,self.cutoff=closed_edition(self.now)
        self.policy={'enabled':True,'sync_effective_date':'2026-10-15','series_root':str(self.root/'series'),'execbrief_root':str(self.root/'producer')}
        self.bundle='b'*64;self.parent='a'*64
        receipt=self.root/'series/inputs'/self.bundle/'publication-receipt.json';publication=save(receipt,{'verified':True,'fixture_only':True})
        binding={'bundle_id':self.bundle,'publication_receipt_sha256':publication,'cutoff_utc':self.cutoff.isoformat().replace('+00:00','Z')}
        save(receipt.parent/'manifest.json',{'binding':binding,'files':{'publication-receipt.json':publication}})
        parent={'date':self.day,'snapshot_id':self.parent,'cutoff_series':'execbrief-03-v1','cutoff_utc':binding['cutoff_utc'],'upstream_sync':binding,'fixture_only':True}
        parent_sha=save(self.root/'public/data/v2'/(self.parent+'.json'),parent)
        save(self.root/'public/data/v2/manifest.json',{self.day:{'snapshot_id':self.parent,'path':self.parent+'.json','sha256':parent_sha}})
        self.source=self.root/'producer/.daily-work/source-supplements/fixture.json';source_sha=save(self.source,{'fixture_only':True,'not_a_production_acceptance':True})
        self.request={'schema':'wcr-source-revision-request-v1','id':'fixture_source_r1','date':self.day,'requested_at_utc':self.now.isoformat(),'expires_at_utc':(self.now+timedelta(days=2)).isoformat(),
            'parent':{'snapshot_id':self.parent,'snapshot_sha256':parent_sha,'upstream_bundle_id':self.bundle,'publication_receipt_sha256':publication},
            'source_revision_receipt':{'path':str(self.source),'sha256':source_sha}}
        self.original=(self.root/'public/data/v2/manifest.json').read_bytes();self.calls=0
    def tearDown(self):self.temp.cleanup()
    def register(self,request=None):return queue.register(self.root,self.policy,request or self.request,self.now)
    def run_request(self,consumer=adapter.consume_revision,now=None):
        ref=self.register();return adapter.execute(self.root,self.policy,ref['id'],ref['request_sha256'],now or self.now,consumer)
    def proof(self,policy,request):
        self.calls+=1;identifier='c'*64
        accepted=self.cutoff+(self.now-self.cutoff)/2
        snapshot={'date':self.day,'snapshot_id':identifier,'cutoff_series':'execbrief-03-v1','cutoff_utc':self.cutoff.isoformat().replace('+00:00','Z'),
            'upstream_sync':{'source_revision':{'parent_snapshot_id':self.parent,'accepted_receipt_sha256':request['source_revision_receipt']['sha256'],'known_after_original_cutoff':True,'accepted_at_utc':accepted.isoformat()}},'fixture_only':True}
        checksum=save(self.root/'public/data/v2'/(identifier+'.json'),snapshot)
        publication=self.root/'fixture-publication.json';published=save(publication,{'status':'verified','fixture_only':True,'files':{'data/v2/'+identifier+'.json':{'sha256':checksum,'http_verified':True}}})
        nas=self.root/'fixture-NAS-manifest.json';stored=save(nas,{'snapshot_id':identifier,'fixture_only':True,'files':{'snapshot.json':{'sha256':checksum}}})
        return {'snapshot_id':identifier,'snapshot_sha256':checksum,'publication_receipt':str(publication),'publication_sha256':published,'nas_manifest':str(nas),'nas_manifest_sha256':stored}

class Revision(Fixture,unittest.TestCase):
    def test_registration_is_not_acceptance_and_default_gate_cannot_publish(self):
        result=self.run_request();self.assertEqual(result['status'],'pending');self.assertFalse(result['source_accepted']);self.assertFalse(result['publication_verified'])
        self.assertEqual(self.original,(self.root/'public/data/v2/manifest.json').read_bytes());self.assertEqual(self.calls,0)
    def test_same_request_reuses_control_without_resetting_backoff(self):
        ref=self.register();self.run_request();before=(queue.queue_root(self.root)/ref['id']/'state.json').read_bytes();self.register()
        self.assertEqual(before,(queue.queue_root(self.root)/ref['id']/'state.json').read_bytes())
        result=self.run_request();self.assertEqual(result['status'],'deferred');self.assertEqual(self.calls,0)
    def test_immutable_id_cannot_be_rebound_to_different_receipt(self):
        self.register();changed=copy.deepcopy(self.request);changed['source_revision_receipt']['sha256']='d'*64
        with self.assertRaisesRegex(queue.InvalidRequest,'immutable_request_conflict'):self.register(changed)
    def test_completed_hint_reuses_full_proof_without_second_publish(self):
        first=self.run_request(self.proof);second=self.run_request(self.proof)
        self.assertEqual(first['status'],'completed');self.assertTrue(second['reused']);self.assertEqual(self.calls,1)
        self.assertEqual(self.original,(self.root/'public/data/v2/manifest.json').read_bytes())
    def test_corrupted_completed_publication_cannot_be_reported_verified(self):
        self.run_request(self.proof);(self.root/'fixture-publication.json').write_text('{}')
        with self.assertRaisesRegex(queue.InvalidRequest,'completion_receipt_SHA_mismatch'):self.run_request(self.proof)
    def test_changed_request_or_parent_blocks_before_consumer(self):
        ref=self.register();path=queue.queue_root(self.root)/ref['id']/'request.json';path.write_bytes(path.read_bytes()+b' ')
        with self.assertRaisesRegex(queue.InvalidRequest,'request_SHA_mismatch'):adapter.execute(self.root,self.policy,ref['id'],ref['request_sha256'],self.now,self.proof)
        self.assertEqual(self.calls,0)
    def test_superseded_parent_cannot_replace_a_newer_revision(self):
        ref=self.register();save(self.root/'public/data/v2/manifest.json',{self.day:{'snapshot_id':'d'*64,'sha256':'e'*64}})
        result=adapter.execute(self.root,self.policy,ref['id'],ref['request_sha256'],self.now,self.proof)
        self.assertEqual(result['status'],'blocked');self.assertEqual(result['wait_reason'],'request_parent_already_superseded');self.assertEqual(self.calls,0)
    def test_expired_request_and_attempt_limit_are_terminal(self):
        for reason in ['request_expired','revision_attempt_limit']:
            with self.subTest(reason=reason):
                ref=self.register();path=queue.queue_root(self.root)/ref['id']/'state.json'
                if reason=='revision_attempt_limit':save(path,{'status':'pending','request_sha256':ref['request_sha256'],'attempts':84})
                result=adapter.execute(self.root,self.policy,ref['id'],ref['request_sha256'],self.now+timedelta(days=3) if reason=='request_expired' else self.now,self.proof)
                self.assertEqual(result['status'],'blocked');self.assertEqual(result['wait_reason'],reason)
    def test_same_request_can_finish_after_original_daily_deadline(self):
        result=self.run_request(self.proof,self.now+timedelta(days=1));self.assertEqual(result['status'],'completed')
    def test_newer_current_day_rejects_a_current_only_revision_handler(self):
        newer=(datetime.fromisoformat(self.day)+timedelta(days=1)).date().isoformat()
        latest=self.root/'public/data/v2/latest.json';save(latest,{'date':newer,'fixture_only':True});before=latest.read_bytes()
        result=self.run_request(self.proof,self.now+timedelta(days=1))
        self.assertEqual(result['status'],'pending');self.assertEqual(result['wait_reason'],'historical_revision_pipeline_not_ready')
        self.assertEqual(self.calls,0);self.assertEqual(latest.read_bytes(),before)
    def test_history_only_capability_keeps_newer_latest_and_status_byte_identical(self):
        newer=(datetime.fromisoformat(self.day)+timedelta(days=1)).date().isoformat();paths=[self.root/'public/data/v2'/name for name in ['latest.json','status.json']]
        for path in paths:save(path,{'date':newer,'fixture_only':True})
        before=[p.read_bytes() for p in paths]
        def historical(policy,request):return self.proof(policy,request)
        historical.supports_history_only=True
        result=self.run_request(historical,self.now+timedelta(days=1))
        self.assertEqual(result['status'],'completed');self.assertEqual([p.read_bytes() for p in paths],before)
    def test_history_only_handler_pointer_drift_cannot_be_reported_completed(self):
        latest=self.root/'public/data/v2/latest.json';save(latest,{'date':(datetime.fromisoformat(self.day)+timedelta(days=1)).date().isoformat()})
        def broken(policy,request):
            proof=self.proof(policy,request);save(latest,{'date':self.day});return proof
        broken.supports_history_only=True
        result=self.run_request(broken,self.now+timedelta(days=1))
        self.assertEqual(result['status'],'blocked');self.assertFalse(result['source_accepted']);self.assertEqual(result['wait_reason'],'historical_revision_changed_newer_current_pointer')
    def test_source_receipt_hash_drift_and_missing_proof_do_not_complete(self):
        ref=self.register();self.source.write_text('changed')
        result=adapter.execute(self.root,self.policy,ref['id'],ref['request_sha256'],self.now,self.proof)
        self.assertEqual(result['status'],'blocked');self.assertEqual(self.calls,0)
    def test_bound_receipt_can_resolve_after_producer_cleanup_without_accepting_it(self):
        raw=self.source.read_bytes();checksum=self.request['source_revision_receipt']['sha256']
        self.policy['execbrief_handoff_root']=str(self.root/'producer-NAS')
        obj=Path(self.policy['execbrief_handoff_root'])/'completed-objects-v1/objects'/checksum[:2]/(checksum+'.gz');obj.parent.mkdir(parents=True);obj.write_bytes(gzip.compress(raw));self.source.unlink()
        result=self.run_request();self.assertEqual(result['status'],'pending');self.assertFalse(result['source_accepted'])
        self.assertEqual(result['wait_reason'],'accepted_source_supplement_required')
    def test_per_request_OS_lock_prevents_second_execution(self):
        ref=self.register()
        with publication_lock(queue.queue_root(self.root)/ref['id']/'run.lock') as held:
            self.assertTrue(held);result=adapter.execute(self.root,self.policy,ref['id'],ref['request_sha256'],self.now,self.proof)
        self.assertEqual(result['status'],'deferred');self.assertEqual(self.calls,0)
    def test_control_bounds_traversal_unknown_fields_and_timestamps(self):
        variants=[('id','../escape'),('requested_at_utc',self.now.replace(tzinfo=None).isoformat()),('expires_at_utc',(self.now+timedelta(days=8)).isoformat())]
        for key,value in variants:
            request=copy.deepcopy(self.request);request[key]=value
            with self.subTest(key=key),self.assertRaises(queue.InvalidRequest):self.register(request)
        request=copy.deepcopy(self.request);request['argv']=['never-execute']
        with self.assertRaises(queue.InvalidRequest):self.register(request)
        path=self.root/'oversized.json';path.write_bytes(b'x'*(queue.LIMIT+1))
        with self.assertRaises(queue.InvalidRequest):queue.control(path)
        request=copy.deepcopy(self.request);request['source_revision_receipt']['path']=str(self.root/'outside-producer.json')
        with self.assertRaises(queue.InvalidRequest):self.register(request)
    def test_native_identity_guard_rejects_wrong_job_or_PID(self):
        native=self.root/'native';runtime=self.root/'runtime.py';runtime.write_text("def process_identity(pid):return 'fixture-owner'\n")
        active={'job':'countryrisks-daily','kind':'native_continuation','id':self.request['id'],'request_sha256':'d'*64,'process_id':123,'process_identity':'fixture-owner'}
        save(native/'active.json',active);adapter.native_owner(native,runtime,self.request['id'],'d'*64,parent_pid=123)
        with self.assertRaises(queue.InvalidRequest):adapter.native_owner(native,runtime,self.request['id'],'d'*64,parent_pid=124)
        active['process_identity']='reused-PID';save(native/'active.json',active)
        with self.assertRaises(queue.InvalidRequest):adapter.native_owner(native,runtime,self.request['id'],'d'*64,parent_pid=123)
    def test_queue_is_bounded_and_terminal_hints_leave_the_pending_frontier(self):
        for number in range(queue.MAX_ITEMS):
            request=copy.deepcopy(self.request);request['id']='fixture_'+str(number);self.register(request)
        extra=copy.deepcopy(self.request);extra['id']='fixture_extra'
        with self.assertRaisesRegex(queue.InvalidRequest,'queue_full'):self.register(extra)
        for state in queue.queue_root(self.root).glob('*/state.json'):
            value=json.loads(state.read_bytes());value['status']='blocked';queue.atomic(state,value)
        self.register(extra);index=queue.control(queue.queue_root(self.root)/'pending.json')[1]
        self.assertEqual(len(index['items']),1);self.assertEqual(index['items'][0]['id'],'fixture_extra')
        self.assertEqual(len(list(queue.queue_root(self.root).glob('*/request.json'))),33)
    def test_completion_requires_late_source_label_and_unchanged_0300_cutoff(self):
        for change in ['cutoff','late_label']:
            request=copy.deepcopy(self.request);request['id']='fixture_'+change;ref=self.register(request)
            def broken(policy,request):
                proof=self.proof(policy,request);path=self.root/'public/data/v2'/('c'*64+'.json');value=json.loads(path.read_bytes())
                if change=='cutoff':value['cutoff_utc']=(self.cutoff+timedelta(hours=2)).isoformat()
                else:value['upstream_sync']['source_revision']['known_after_original_cutoff']=False
                proof['snapshot_sha256']=save(path,value);return proof
            result=adapter.execute(self.root,self.policy,ref['id'],ref['request_sha256'],self.now,broken)
            self.assertEqual(result['status'],'blocked');self.assertFalse(result['source_accepted'])

class NativeTransport(Fixture,unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec=importlib.util.spec_from_file_location('wcr_native_fixture_runtime',RUNTIME)
        cls.native=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.native)
    def integration(self,completed=False):
        ref=self.register();state_root=self.root/'native-state';job_root=state_root/'countryrisks-daily'
        original={'slot':'original-daily-slot','terminal':True,'last_status':'completed'};save(job_root/'state.json',original);before=(job_root/'state.json').read_bytes()
        self.policy.update(native_job_root=str(job_root),native_runtime=str(RUNTIME));save(self.root/'.local/controller.json',self.policy)
        helper=self.root/'fixture-entry.py'
        text="import sys,json\nfrom pathlib import Path\nsys.path.insert(0,"+repr(str(ROOT/'scripts'))+")\nimport source_revision_adapter as a\na.ROOT=Path("+repr(str(self.root))+")\n"
        if completed:
            proof=self.proof(self.policy,self.request);save(self.root/'fixture-proof.json',proof)
            text+="original=a.execute\ndef fixture_execute(root,policy,identifier,checksum):return original(root,policy,identifier,checksum,consumer=lambda p,r:json.loads((root/'fixture-proof.json').read_bytes()))\na.execute=fixture_execute\n"
        helper.write_text(text+"a.main()\n")
        job={'id':'countryrisks-daily','cwd':str(self.root),'continuation':{'queue_root':str(queue.queue_root(self.root)),'retry_seconds':900,
            'argv':['{python}','-X','utf8','-B',str(helper),'--request','{request}','--request-sha256','{request_sha256}','--result','{result}','--native-job-root',str(job_root),'--native-runtime',str(RUNTIME)]}}
        result=self.native.execute_continuation({'state_root':str(state_root),'python':sys.executable},job,ref)
        self.assertEqual(result['status'],'completed' if completed else 'pending');self.assertFalse(result['ai_started'])
        self.assertEqual(before,(job_root/'state.json').read_bytes());self.assertFalse((job_root/'active.json').exists())
        with publication_lock(job_root/'run.lock') as free:self.assertTrue(free)
        return job,job_root
    def test_real_native_continuation_can_defer_after_normal_completion(self):self.integration(False)
    def test_real_native_continuation_can_complete_without_resetting_daily(self):
        job,job_root=self.integration(True)
        self.assertIsNone(self.native.continuation_signal(job,job_root,datetime.now(timezone.utc)))
    def test_empty_queue_does_not_wake_existing_job(self):
        job={'continuation':{'queue_root':str(queue.queue_root(self.root))}}
        self.assertIsNone(self.native.continuation_signal(job,self.root/'native-state',self.now))
    def test_actual_tick_accepts_hook_but_empty_queue_does_not_start_a_job(self):
        job={'id':'countryrisks-daily','cwd':str(self.root),'enabled':True,'hours':[3],'minutes':[20],'argv':['{python}','never-invoked'],
             'continuation':{'queue_root':str(queue.queue_root(self.root)),'argv':['{python}','fixture','{request}','{request_sha256}']}}
        self.native.valid_job(job)
        state_root=self.root/'tick-state';save(state_root/job['id']/'state.json',{'slot':self.native.due_slot(job,self.now),'terminal':True})
        profile={'enabled':True,'jobs':[job],'state_root':str(state_root),'activated_at_utc':(self.now-timedelta(days=1)).isoformat(),'python':sys.executable}
        self.assertEqual(self.native.tick(profile,self.root/'never-installed-profile.json',self.now,plan=True),[])
        self.register();plan=self.native.tick(profile,self.root/'never-installed-profile.json',self.now,plan=True)
        self.assertEqual([row['status'] for row in plan],['would_resume_native'])
    def test_real_native_run_lock_rejects_second_owner(self):
        state_root=self.root/'native-state';job_root=state_root/'countryrisks-daily'
        with self.native.lock(job_root/'run.lock'):
            with self.assertRaises(OSError):self.native.execute_continuation({'state_root':str(state_root)}, {'id':'countryrisks-daily'}, {'id':'fixture','request_sha256':'a'*64})

if __name__=='__main__':unittest.main()
