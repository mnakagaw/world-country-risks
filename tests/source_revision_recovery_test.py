"""Bounded explicit recovery registers a new generation, never resets old history."""
from pathlib import Path
from hashlib import sha256
from datetime import timedelta
from unittest.mock import patch
import json,copy,unittest
import source_supplement_test as fixture
import source_revision_queue as queue
import source_revision_recovery as repair
from source_revision_test import save

class Recovery(fixture.ContractFixture,unittest.TestCase):
    def setUp(self):
        super().setUp();queue.register(self.root,self.policy,self.request,self.now);self.old=queue.queue_root(self.root)/self.request['id'];self.blocked={'status':'blocked','request_sha256':sha256((self.old/'request.json').read_bytes()).hexdigest(),'attempts':3,'source_accepted':False,'wait_reason':'unreviewed_source_supplement_validator'};queue.atomic(self.old/'state.json',self.blocked);self.oldraw=(self.old/'state.json').read_bytes();self.oldsha=sha256(self.oldraw).hexdigest();self.oldrequest=(self.old/'request.json').read_bytes();self.review=self.root/'review.json'
        graph={n:sha256((repair.CODE_ROOT/'scripts'/n).read_bytes()).hexdigest() for n in ['source_supplement_gate.py','source_revision_cycle.py','sync_article_context.py']}
        self.evidence={'kind':'real-formal-source-and-bounded-F-context-validation-v1','code_sha256':graph['source_supplement_gate.py'],'code_graph':graph,'request_sha256':self.blocked['request_sha256'],'receipt_sha256':self.request['source_revision_receipt']['sha256'],'persist':False,'Google_projection_and_article_interpretations_unchanged':True};save(self.review,self.evidence)
    def call(self,**kwargs):return repair.recover(self.root,self.policy,self.request['id'],kwargs.get('state_sha',self.oldsha),'e'*64,self.review,kwargs.get('review_sha',sha256(self.review.read_bytes()).hexdigest()),kwargs.get('now',self.now))
    def test_new_generation_inherits_expiry_and_attempts_and_keeps_old_bytes(self):
        result=self.call();self.assertTrue(result['registered']);new=queue.queue_root(self.root)/result['id'];request=queue.control(new/'request.json')[1];state=queue.control(new/'state.json')[1]
        self.assertEqual({**request,'id':self.request['id']},self.request);self.assertEqual(state['attempts'],3);self.assertEqual((self.old/'state.json').read_bytes(),self.oldraw);self.assertEqual((self.old/'request.json').read_bytes(),self.oldrequest)
        again=self.call();self.assertEqual(again['status'],'already_registered_recovery');self.assertFalse(again['registered']);self.assertEqual(queue.control(new/'state.json')[1]['attempts'],3)
    def test_wrong_state_review_or_source_binding_cannot_register(self):
        for kwargs in [{'state_sha':'0'*64},{'review_sha':'0'*64}]:
            with self.assertRaises(queue.InvalidRequest):self.call(**kwargs)
        self.evidence['receipt_sha256']='0'*64;save(self.review,self.evidence)
        with self.assertRaises(queue.InvalidRequest):self.call()
    def test_expired_request_and_exhausted_attempt_credit_are_not_extended(self):
        with self.assertRaises(queue.InvalidRequest):self.call(now=self.now+timedelta(days=2))
        self.blocked['attempts']=84;queue.atomic(self.old/'state.json',self.blocked);self.oldsha=sha256((self.old/'state.json').read_bytes()).hexdigest()
        with self.assertRaisesRegex(queue.InvalidRequest,'budget_exhausted'):self.call()
    def test_crash_before_registration_keeps_inherited_credit_on_resume(self):
        with patch.object(repair.queue,'register',side_effect=OSError('fixture stop before registration')),self.assertRaises(OSError):self.call()
        result=self.call();self.assertEqual(queue.control(queue.queue_root(self.root)/result['id']/'state.json')[1]['attempts'],3);self.assertEqual((self.old/'state.json').read_bytes(),self.oldraw)
    def test_crash_after_request_write_repairs_missing_index_without_reseeding(self):
        real=queue.atomic
        def crash(path,value):
            if path==queue.queue_root(self.root)/'pending.json':raise OSError('fixture request written; index not written')
            return real(path,value)
        with patch.object(queue,'atomic',side_effect=crash),self.assertRaises(OSError):self.call()
        new=next(p for p in queue.queue_root(self.root).iterdir() if p.is_dir() and p.name!=self.request['id']);self.assertTrue((new/'request.json').exists());before=(new/'state.json').read_bytes()
        proof=self.root/'.local/source-revision-recovery'/new.name/'proof.json';value=queue.control(proof)[1];value['recovery_operator_sha256']='1deaa21f252f193c826fe54a56beae0510c786a2e5e4e58a69981d1251615ac5';queue.atomic(proof,value);sealed=proof.read_bytes()
        result=self.call();self.assertTrue(result['registered']);self.assertEqual((new/'state.json').read_bytes(),before);self.assertEqual(proof.read_bytes(),sealed)
        self.assertTrue(any(row['id']==new.name for row in queue.control(queue.queue_root(self.root)/'pending.json')[1]['items']))
    def test_progressed_state_without_index_is_not_reset(self):
        result=self.call();new=queue.queue_root(self.root)/result['id'];state=queue.control(new/'state.json')[1];state.update(status='running',attempts=4);queue.atomic(new/'state.json',state);queue.atomic(queue.queue_root(self.root)/'pending.json',{'items':[]});before=(new/'state.json').read_bytes()
        with self.assertRaisesRegex(queue.InvalidRequest,'progressed_without_index'):self.call()
        self.assertEqual((new/'state.json').read_bytes(),before)
    def test_changed_current_parent_is_rejected(self):
        save(self.root/'public/data/v2/manifest.json',{self.day:{'snapshot_id':'c'*64,'sha256':'d'*64}})
        with self.assertRaises(queue.InvalidRequest):self.call()
    def test_live_same_day_work_is_coalesced_and_not_restarted(self):
        pending={**self.request,'id':'other_pending'};queue.register(self.root,self.policy,pending,self.now);before=queue.control(queue.queue_root(self.root)/'other_pending/state.json')[0];result=self.call();self.assertFalse(result['registered']);self.assertEqual(result['status'],'coalesced_existing_work');self.assertEqual(queue.control(queue.queue_root(self.root)/'other_pending/state.json')[0],before)

if __name__=='__main__':unittest.main()
