"""The decorated-reference repair retains old history and exact rejection scope."""
from pathlib import Path
from hashlib import sha256
from unittest.mock import patch
import json,unittest
import source_revision_recovery_test as original
import source_revision_recovery as repair
import source_revision_queue as queue
from source_revision_test import save

class PriorityRecovery(original.Recovery):
    def setUp(self):
        super().setUp();self.code=self.root/'code';(self.code/'scripts').mkdir(parents=True)
        for name in ['source_revision_cycle.py','sync_article_context.py']:(self.code/'scripts'/name).write_bytes((repair.CODE_ROOT/'scripts'/name).read_bytes())
        (self.code/'scripts/source_supplement_gate.py').write_text('reviewed different gate fixture')
        self.prior='90c2bde626c4aeba5ceba3ed865407979d0f381ecff78feda4da0b852d816f51';self.blocked['wait_reason']='invalid_original_reference';queue.atomic(self.old/'state.json',self.blocked);self.oldraw=(self.old/'state.json').read_bytes();self.oldsha=sha256(self.oldraw).hexdigest()
        graph={n:sha256((self.code/'scripts'/n).read_bytes()).hexdigest() for n in ['source_supplement_gate.py','source_revision_cycle.py','sync_article_context.py']};self.evidence.update(code_sha256=graph['source_supplement_gate.py'],code_graph=graph,repair_reason='frozen_daily_decorated_original_reference',prior_gate_sha256=self.prior);save(self.review,self.evidence)
    def call(self,**kwargs):
        with patch.object(repair,'CODE_ROOT',self.code):return repair.recover(self.root,self.policy,self.request['id'],kwargs.get('state_sha',self.oldsha),kwargs.get('prior',self.prior),self.review,kwargs.get('review_sha',sha256(self.review.read_bytes()).hexdigest()),kwargs.get('now',self.now))
    def test_other_prior_gate_or_missing_explicit_reason_is_rejected(self):
        with self.assertRaisesRegex(queue.InvalidRequest,'reason_not_reviewed'):self.call(prior='a'*64)
        self.evidence.pop('repair_reason');save(self.review,self.evidence)
        with self.assertRaisesRegex(queue.InvalidRequest,'reason_not_reviewed'):self.call()
    def test_frozen_raw_transfer_reason_requires_its_own_marker_and_preserves_credit(self):
        self.blocked['wait_reason']='english_priority_original_binding_mismatch';queue.atomic(self.old/'state.json',self.blocked);self.oldraw=(self.old/'state.json').read_bytes();self.oldsha=sha256(self.oldraw).hexdigest()
        with self.assertRaisesRegex(queue.InvalidRequest,'reason_not_reviewed'):self.call()
        self.evidence['repair_reason']='frozen_original_raw_identity_without_recent_transfer';save(self.review,self.evidence);result=self.call();self.assertTrue(result['registered']);self.assertEqual(queue.control(queue.queue_root(self.root)/result['id']/'state.json')[1]['attempts'],3);self.assertEqual((self.old/'state.json').read_bytes(),self.oldraw)
