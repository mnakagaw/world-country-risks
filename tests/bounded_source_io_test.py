"""Small isolated source objects and write ceilings, never a production rebuild."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
from hashlib import sha256
from types import SimpleNamespace
from unittest.mock import patch
import json,sys,tempfile,unittest,duckdb
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import bounded_source_io as bounded
import export_shared_gdelt as adapter
import storage_placement as placement

class BoundedSource(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='wcr-bounded-source-');self.root=Path(self.tmp.name)
        self.repo=self.root/'repo';self.repo.mkdir();self.archive=self.root/'archive';(self.archive/'normalized').mkdir(parents=True)
        self.source=self.archive/'normalized/input.parquet';self.source.write_bytes(b'fixture immutable object')
        self.sha=sha256(self.source.read_bytes()).hexdigest();self.start=datetime(2026,10,1,tzinfo=timezone.utc)
        self.row={'slot':self.start.isoformat(),'path':str(self.source),'sha256':self.sha,'rows_rejected':0}
        self.candidates={self.start.isoformat():[self.row]};self.verified={}
    def tearDown(self):self.tmp.cleanup()
    def artifacts(self,io,materialize=False):
        return adapter.artifacts(self.archive,self.start,self.start+timedelta(minutes=15),candidates=self.candidates,
          verified=self.verified,strict_candidates=True,source_io=io,materialize=materialize)
    def test_hash_only_epoch_pass_writes_no_read_object(self):
        io=bounded.SourceIO(self.repo);rows=self.artifacts(io)
        self.assertEqual(rows,[{**self.row,'status':'available'}]);self.assertFalse(io.objects.exists())
        self.assertEqual(io.summary()['source_hash_only_bytes'],self.source.stat().st_size)
        self.assertEqual(io.summary()['hash_only_verified_objects'],1)
        self.assertEqual(self.artifacts(io),rows);self.assertEqual(io.summary()['source_full_sha_reads'],1)
    def test_hash_only_then_export_materializes_verified_object_on_external_project(self):
        external=self.root/'registered-external';external.mkdir();calls=[]
        def identity(additional):calls.append(additional);return external
        with patch.object(bounded.shutil,'disk_usage',return_value=SimpleNamespace(free=100*bounded.GIB)):
            io=bounded.SourceIO(self.repo,{'external_storage':True},external_guard=identity)
            rows=self.artifacts(io);self.assertFalse(io.objects.exists())
            ready=io.materialize_rows(rows,self.verified,self.archive);target=Path(ready[0]['read_path'])
            self.assertTrue(target.is_relative_to(external/'world-country-risks'))
            self.assertEqual(target.read_bytes(),self.source.read_bytes());self.assertFalse((self.repo/'work/archive-objects').exists())
            summary=io.summary();self.assertEqual(summary['source_full_sha_reads'],2);self.assertEqual(summary['private_objects_written'],1)
            self.assertGreaterEqual(len(calls),2);self.assertEqual(calls[0],bounded.OBJECT_RUN_LIMIT+2*bounded.DTO_RUN_LIMIT)
            # A new process validates both original source and persistent copy.
            later=bounded.SourceIO(self.repo,{'external_storage':True},external_guard=identity)
            self.assertEqual(later.verify(self.source,self.sha,{}),str(target));self.assertEqual(later.summary()['private_objects_reused'],1)
    def test_resource_excess_is_not_a_missing_source(self):
        io=bounded.SourceIO(self.repo)
        with patch.object(bounded,'OBJECT_LIMIT',4),self.assertRaises(bounded.StorageDeferred):self.artifacts(io)
        self.assertFalse(io.objects.exists())
    def test_external_DTO_copy_readback_and_frozen_history_paths(self):
        external=self.root/'registered-external';external.mkdir();history=external/'world-country-risks/run/series/v2-history.json'
        policy={'external_storage':True,'source_io':{'history_path':str(history),'report_path':str(history.with_name('report.json'))}}
        with patch.object(bounded.shutil,'disk_usage',return_value=SimpleNamespace(free=100*bounded.GIB)):
            io=bounded.SourceIO(self.repo,policy,external_guard=lambda additional:external)
            self.assertEqual(io.history_path,history);source=self.repo/'prior.json';source.write_bytes(b'{"fixture":true}\n')
            target=io.dto_folder/'2026-10-01.json';io.copy(source,target)
            self.assertEqual(target.read_bytes(),source.read_bytes());self.assertEqual(io.summary()['dto_bytes_written'],source.stat().st_size)
    def test_same_length_source_drift_and_outside_source_fail_sha_containment(self):
        io=bounded.SourceIO(self.repo);self.source.write_bytes(b'x'*self.source.stat().st_size)
        rows=self.artifacts(io);self.assertEqual(rows[0]['status'],'missing')
        outside=self.root/'outside.parquet';outside.write_bytes(b'outside')
        self.candidates[self.start.isoformat()]=[{**self.row,'path':str(outside),'sha256':sha256(outside.read_bytes()).hexdigest()}]
        self.assertEqual(self.artifacts(io)[0]['status'],'missing');self.assertFalse(io.objects.exists())
    def test_output_limit_preserves_original_and_removes_only_own_pending(self):
        io=bounded.SourceIO(self.repo);target=self.repo/'output.json';target.write_bytes(b'original')
        with self.assertRaises(bounded.StorageDeferred):io.atomic_json(target,{'large':'x'*100},16)
        self.assertEqual(target.read_bytes(),b'original');self.assertEqual(list(self.repo.glob('*.pending')),[])
        self.assertEqual(io.local.pending,0)
    def test_duckdb_spill_is_local_explicitly_limited_and_scoped_cleanup(self):
        io=bounded.SourceIO(self.repo);settings=io.duckdb_settings();spill=Path(settings['temp_directory'])
        self.assertTrue(spill.is_relative_to(self.repo/'work/source-spill'))
        db=duckdb.connect(':memory:')
        try:
            for key,value in settings.items():db.execute('SET '+key+' = ?',[value])
            self.assertEqual(db.execute("SELECT current_setting('max_temp_directory_size')").fetchone()[0],'512.0 MiB')
        finally:db.close();io.close()
        self.assertFalse(spill.exists())
    def test_disk_reserve_refusal_keeps_budget_state_consistent(self):
        ledger=bounded.WriteLedger(self.root,100,20)
        with patch.object(bounded.shutil,'disk_usage',return_value=SimpleNamespace(free=25)):
            with self.assertRaises(bounded.StorageDeferred):
                with ledger.reservation(10,'objects',100):pass
        self.assertEqual(ledger.pending,0);self.assertEqual(ledger.buckets,{})

class Admission(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='wcr-c-plan-');self.repo=Path(self.tmp.name);(self.repo/'scripts').mkdir()
        self.chain={}
        for name in ['scripts/source_revision_cycle.py','scripts/bounded_source_io.py']:
            (self.repo/name).write_bytes(b'fixture reviewed implementation');self.chain[name]=sha256((self.repo/name).read_bytes()).hexdigest()
        self.plan={'kind':'wcr-bounded-c-write-plan-v1','writer_chain':self.chain,
          'spill_limit_bytes':placement.BOUNDED_SPILL_BYTES,'writes':[{'path':str(self.repo/'.local/request.json'),'max_bytes':4096}]}
        self.chain_sha=sha256(json.dumps(self.chain,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    def tearDown(self):self.tmp.cleanup()
    def test_unreviewed_declaration_cannot_lower_headroom(self):
        with self.assertRaisesRegex(OSError,'not been reviewed'):placement.bounded_c_peak(self.repo,self.plan,1000,2)
        self.assertEqual(placement.DEFAULT_C_PEAK_BYTES,8*bounded.GIB)
    def test_reviewed_chain_counts_hydration_spill_double_pending_and_allowances(self):
        with patch.object(placement,'REVIEWED_C_WRITE_CHAINS',frozenset([self.chain_sha])):
            peak=placement.bounded_c_peak(self.repo,self.plan,1000,2)
        self.assertEqual(peak['peak_additional_bytes'],1000+2*65536+placement.BOUNDED_SPILL_BYTES+2*4096+2*65536+placement.BOUNDED_MISC_BYTES)
    def test_changed_writer_and_unscoped_paths_refuse(self):
        with patch.object(placement,'REVIEWED_C_WRITE_CHAINS',frozenset([self.chain_sha])):
            (self.repo/'scripts/source_revision_cycle.py').write_bytes(b'changed')
            with self.assertRaisesRegex(OSError,'SHA changed'):placement.bounded_c_peak(self.repo,self.plan,0,0)
            (self.repo/'scripts/source_revision_cycle.py').write_bytes(b'fixture reviewed implementation')
            self.plan['writes'][0]['path']=str(self.repo.parent/'other-task.json')
            with self.assertRaisesRegex(OSError,'path invalid'):placement.bounded_c_peak(self.repo,self.plan,0,0)
    def test_only_the_existing_scoped_queue_state_is_allowed(self):
        with patch.object(placement,'REVIEWED_C_WRITE_CHAINS',frozenset([self.chain_sha])):
            self.plan['writes']=[{'path':str(self.repo/'.daily-work/source-revisions/revision_1/state.json'),'max_bytes':65536}]
            self.assertEqual(placement.bounded_c_peak(self.repo,self.plan,0,0)['c_planned_files'],1)
            for name in ['index.json','request.json','other.json']:
                self.plan['writes'][0]['path']=str(self.repo/'.daily-work/source-revisions/revision_1'/name)
                with self.assertRaisesRegex(OSError,'path invalid'):placement.bounded_c_peak(self.repo,self.plan,0,0)

if __name__=='__main__':unittest.main()
