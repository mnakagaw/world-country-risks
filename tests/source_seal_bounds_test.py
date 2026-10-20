"""Retain the real-size immutable Google seal without widening other controls."""
from pathlib import Path
from hashlib import sha256
import json,unittest
import source_supplement_test as fixture
from source_revision_test import save
import source_supplement_gate as gate
from source_revision_queue import InvalidRequest
from execbrief_sync import Waiting

class SealBounds(fixture.ContractFixture,unittest.TestCase):
    def test_bound_large_seal_survives_freeze_and_bounded_writer_exactly(self):
        p=self.original/'search-interest-seal.json';raw=p.read_bytes()+b' '*(5*1024**2);p.write_bytes(raw);self.binding['search_interest_seal_sha256']=sha256(raw).hexdigest()
        meta=json.loads((self.original/'manifest.json').read_bytes());meta['binding']=self.binding;meta['files'][p.name]=sha256(raw).hexdigest();save(self.original/'manifest.json',meta)
        public=self.root/'public/data/v2';value=json.loads((public/(self.parent+'.json')).read_bytes());value['upstream_sync']=self.binding;checksum=save(public/(self.parent+'.json'),value);save(public/'latest.json',value);save(public/'manifest.json',{self.day:{'snapshot_id':self.parent,'path':self.parent+'.json','sha256':checksum}});self.request['parent']['snapshot_sha256']=checksum
        folder,binding,blobs=gate.freeze(self.policy,self.request,self.root,persist=False);self.assertEqual(blobs[p.name],raw);limits=[]
        def writer(path,value,limit):limits.append((path.name,limit));path.write_bytes(value)
        gate.write_bundle(folder,blobs,writer);self.assertEqual((folder/p.name).read_bytes(),raw);self.assertIn((p.name,8*1024**2),limits)
        self.assertEqual(binding['search_interest_seal_sha256'],sha256(raw).hexdigest())
    def test_ordinary_control_stays4MiB_and_seal_stays8MiB(self):
        for name,size in [('editorial.json',4*1024**2+1),('search-interest-seal.json',8*1024**2+1)]:
            with self.subTest(name=name),self.assertRaises(Waiting):gate.write_bundle(self.root/'reject'/name, {name:b'x'*size})
    def test_named_seal_exception_cannot_substitute_other_SHA(self):
        self.binding['search_interest_seal_sha256']='f'*64;meta=json.loads((self.original/'manifest.json').read_bytes());meta['binding']=self.binding;save(self.original/'manifest.json',meta)
        public=self.root/'public/data/v2';value=json.loads((public/(self.parent+'.json')).read_bytes());value['upstream_sync']=self.binding;checksum=save(public/(self.parent+'.json'),value);save(public/'manifest.json',{self.day:{'snapshot_id':self.parent,'path':self.parent+'.json','sha256':checksum}});self.request['parent']['snapshot_sha256']=checksum
        with self.assertRaisesRegex(InvalidRequest,'interest_seal_binding_mismatch'):self.freeze()
    def test_complete_bundle_ceiling_includes_new_proof_bytes(self):
        blobs={str(i)+'.json':b'x'*(4*1024**2) for i in range(4)};blobs['new-proof.json']=b'x'
        with self.assertRaisesRegex(Waiting,'complete_revision_bundle_size_limit'):gate.write_bundle(self.root/'oversized-complete',blobs)
        self.assertFalse((self.root/'oversized-complete').exists())
    def test_same_filename_without_bound_manifest_does_not_get_exception(self):
        with self.assertRaisesRegex(InvalidRequest,'large_seal_outside_bound_frozen_bundle'):
            gate.write_bundle(self.root/'arbitrary',{'search-interest-seal.json':b'x'*(5*1024**2)})
    def test_context_bounded_writer_preserves_exact_normal_export_bytes(self):
        import sync_article_context as context
        (self.producer/'engine').mkdir();(self.producer/'engine/gdelt.py').write_text('TRACKING_PARAMETERS=set()\ndef canonical_url(url):return url\n')
        normal=self.root/'normal-context.json';bounded=self.root/'bounded-context.json';context.export(self.policy,self.original,normal)
        import source_revision_cycle as cycle
        context.export(self.policy,self.original,bounded,writer=lambda p,b:cycle.replace(p,b,16*1024**2))
        self.assertEqual(normal.read_bytes(),bounded.read_bytes())
        before=bounded.read_bytes()
        with self.assertRaises(Waiting):cycle.replace(bounded,b'x'*(16*1024**2+1),16*1024**2)
        self.assertEqual(bounded.read_bytes(),before)
    def test_context_writer_rejects_C_and_checks_pending_before_replace(self):
        from unittest.mock import patch
        import source_revision_cycle as cycle
        target=self.root/'context.json'
        with patch.object(cycle,'external_root',return_value=self.root/'external'),self.assertRaises(InvalidRequest):cycle.write_context(target,b'{}')
        self.assertFalse(target.exists());target.write_bytes(b'original');real=Path.read_bytes
        def corrupt(path):return b'corrupt' if path.name.endswith('.revision-pending') else real(path)
        with patch.object(Path,'read_bytes',corrupt),self.assertRaisesRegex(InvalidRequest,'pending_readback'):cycle.replace(target,b'new',100)
        self.assertEqual(target.read_bytes(),b'original')

if __name__=='__main__':unittest.main()
