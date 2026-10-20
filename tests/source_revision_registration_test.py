"""One-shot producer registration fixtures, never production source receipts."""
import copy,json,sys,unittest
from hashlib import sha256
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from source_revision_test import Fixture,save
import register_source_revision as cli
import source_revision_queue as queue
import source_revision_adapter as adapter

class ProducerPush(Fixture,unittest.TestCase):
    def push(self,path=None,checksum=None,now=None,parent=None):
        return cli.register_hint(self.root,self.policy,self.day,parent or self.request['parent']['publication_receipt_sha256'],
            path or self.source,checksum or self.request['source_revision_receipt']['sha256'],now or self.now)
    def second_receipt(self):
        path=self.source.with_name('fixture-r2.json');checksum=save(path,{'fixture_only':True,'revision':2});return path,checksum
    def test_first_hint_is_seven_fields_and_is_not_source_acceptance(self):
        result=self.push();self.assertEqual(result['status'],'registered');self.assertFalse(result['source_accepted']);self.assertFalse(result['new_publication'])
        path=queue.queue_root(self.root)/result['id']/'request.json';raw,request=queue.control(path)
        self.assertEqual(len(request),7);self.assertEqual(request['parent'],self.request['parent']);self.assertEqual(len(result['id']),80)
        self.assertEqual(self.original,(self.root/'public/data/v2/manifest.json').read_bytes())
    def test_repeated_same_receipt_keeps_id_creation_expiry_and_backoff(self):
        result=self.push();folder=queue.queue_root(self.root)/result['id'];before={n:(folder/n).read_bytes() for n in ['request.json','state.json']}
        again=self.push(now=self.now+timedelta(hours=1));self.assertEqual(again['status'],'already_known');self.assertFalse(again['registered'])
        self.assertEqual(before,{n:(folder/n).read_bytes() for n in before})
    def test_one_pending_per_edition_coalesces_without_rewriting_upstream(self):
        first=self.push();path,checksum=self.second_receipt();raw=path.read_bytes()
        second=self.push(path,checksum);self.assertEqual(second['status'],'coalesced_pending');self.assertEqual(second['pending_id'],first['id'])
        self.assertEqual(len(list(queue.queue_root(self.root).glob('*/request.json'))),1);self.assertEqual(path.read_bytes(),raw)
    def test_next_capture_can_register_latest_after_previous_completion(self):
        first=self.push();adapter.execute(self.root,self.policy,first['id'],first['request_sha256'],self.now,self.proof)
        path,checksum=self.second_receipt();second=self.push(path,checksum,now=self.now+timedelta(minutes=15))
        self.assertEqual(second['status'],'registered');self.assertNotEqual(first['id'],second['id'])
        rows=queue.control(queue.queue_root(self.root)/'pending.json')[1]['items'];self.assertEqual([r['id'] for r in rows],[second['id']])
        self.assertEqual(self.push()['status'],'already_known')
    def test_same_latest_hint_coalesced_during_work_registers_after_completion(self):
        first=self.push();path,checksum=self.second_receipt();original=path.read_bytes()
        for minute in [1,2]:
            deferred=self.push(path,checksum,now=self.now+timedelta(minutes=minute));self.assertEqual(deferred['status'],'coalesced_pending');self.assertFalse(deferred['registered'])
        adapter.execute(self.root,self.policy,first['id'],first['request_sha256'],self.now,self.proof)
        latest=self.push(path,checksum,now=self.now+timedelta(minutes=15));self.assertEqual(latest['status'],'registered')
        request=queue.control(queue.queue_root(self.root)/latest['id']/'request.json')[1]
        self.assertEqual(request['source_revision_receipt']['sha256'],checksum);self.assertEqual(path.read_bytes(),original)
        self.assertEqual(self.push(path,checksum,now=self.now+timedelta(minutes=16))['status'],'already_known')
    def test_source_SHA_wrong_parent_and_mutable_latest_cannot_create_controls(self):
        for call in [lambda:self.push(checksum='f'*64),lambda:self.push(parent='f'*64),lambda:self.push(path=self.source.with_name('latest.json'))]:
            with self.subTest(call=call),self.assertRaises(queue.InvalidRequest):call()
        self.assertFalse((queue.queue_root(self.root)/'pending.json').exists())
    def test_cli_missing_receipt_is_nonfatal_and_registers_nothing(self):
        save(self.root/'.local/controller.json',self.policy);argv=['fixture','--date',self.day,'--expected-parent-publication-sha256',self.request['parent']['publication_receipt_sha256'],
            '--receipt-path',str(self.source.with_name('not-created.json')),'--receipt-sha256','f'*64]
        with patch.object(cli,'ROOT',self.root),patch.object(sys,'argv',argv):cli.main()
        self.assertFalse((queue.queue_root(self.root)/'pending.json').exists())
    def test_registrar_uses_the_current_date_record_with_caller_bound_publication(self):
        first=self.push();adapter.execute(self.root,self.policy,first['id'],first['request_sha256'],self.now,self.proof)
        original=json.loads((self.root/'public/data/v2'/(self.parent+'.json')).read_bytes());new=copy.deepcopy(original);new['snapshot_id']='e'*64;new['upstream_sync']['bundle_id']='d'*64
        publication=new['upstream_sync']['publication_receipt_sha256'];b=self.root/'series/inputs'/('d'*64);save(b/'publication-receipt.json',{'verified':True,'fixture_only':True})
        save(b/'manifest.json',{'binding':new['upstream_sync'],'files':{'publication-receipt.json':publication}})
        checksum=save(self.root/'public/data/v2'/('e'*64+'.json'),new);save(self.root/'public/data/v2/manifest.json',{self.day:{'snapshot_id':'e'*64,'path':'e'*64+'.json','sha256':checksum}})
        path,new_sha=self.second_receipt();second=self.push(path,new_sha)
        request=queue.control(queue.queue_root(self.root)/second['id']/'request.json')[1]
        self.assertEqual(request['parent']['snapshot_id'],'e'*64);self.assertEqual(request['parent']['upstream_bundle_id'],'d'*64)
        self.assertEqual(sha256((self.root/'public/data/v2'/(self.parent+'.json')).read_bytes()).hexdigest(),self.request['parent']['snapshot_sha256'])
    def test_duplicate_receipt_cannot_bypass_allowed_producer_locator(self):
        self.push()
        with self.assertRaises(queue.InvalidRequest):self.push(path=self.root/'outside-producer.json')

if __name__=='__main__':unittest.main()
