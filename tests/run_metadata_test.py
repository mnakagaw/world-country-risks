"""Small isolated NAS-contract fixtures; no live reconstruction/publication."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timedelta,timezone
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import json,os,sys,tempfile,unittest,shutil
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from run_metadata import RunMetadata
from archive_catalog import catalog
from execbrief_sync import selected_raw_sources
from aggregation_epoch import aggregation_method,calculation_signature,LEGACY_METHOD,LEGACY_CALCULATION
import export_shared_gdelt as adapter

class RunEpoch(unittest.TestCase):
    def setUp(self):
        base=ROOT/'work/metadata-fixtures';base.mkdir(parents=True,exist_ok=True);self.temp=tempfile.TemporaryDirectory(dir=base);self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def test_parallel_reuse_still_fully_reads_and_hashes_each_original_at_end(self):
        p=self.root/'doc.json';p.write_bytes(b'{"value":1}')
        with RunMetadata() as epoch:
            with ThreadPoolExecutor(max_workers=4) as pool:docs=list(pool.map(lambda _:epoch.document(p),range(20)))
            self.assertTrue(all(v is docs[0] for v in docs));self.assertEqual(epoch.summary()['files_read'],1)
        stats=epoch.summary();self.assertEqual(stats['cache_hits'],19);self.assertEqual(stats['end_recheck_reads'],1);self.assertEqual(stats['sha256_calculations']+stats['end_recheck_sha256'],2);self.assertTrue(stats['full_end_recheck_passed'])
    def test_same_size_and_mtime_changes_are_not_accepted(self):
        p=self.root/'doc.json';p.write_bytes(b'{"value":1}');stamp=p.stat()
        with self.assertRaises(ValueError):
            with RunMetadata() as epoch:
                epoch.document(p);p.write_bytes(b'{"value":2}');os.utime(p,ns=(stamp.st_atime_ns,stamp.st_mtime_ns))
        self.assertFalse(epoch.verified)
    def test_expected_SHA_is_checked_on_a_cache_hit_and_new_run_is_cold(self):
        p=self.root/'doc.json';p.write_text('{"n":1}')
        with RunMetadata() as a:
            original=a.document(p)
            with self.assertRaises(ValueError):a.document(p,'0'*64)
        p.write_text('{"n":2}')
        with RunMetadata() as b:self.assertNotEqual(b.document(p).sha256,original.sha256)
        self.assertEqual(b.summary()['cache_hits'],0)
    def fixture(self):
        start=datetime(2026,10,1,tzinfo=timezone.utc);bulkpath=self.root/'manifests/acquired-later/20261001T000000Z_20261001T003000Z/gdelt-bulk-manifest.json';bulkpath.parent.mkdir(parents=True)
        normalized=self.root/'normalized/fixed.parquet';normalized.parent.mkdir();normalized.write_bytes(b'fixture artifact, only used for SHA tests')
        ids=['20261001000000.export','20261001001500.export'];bulk={'dataset_hash':'a'*64,'files':[{'file_id':fid,'status':'downloaded','sha256':str(i+1)*64} for i,fid in enumerate(ids)]};bulkpath.write_text(json.dumps(bulk))
        indexpath=self.root/'indexes/index-v2-aaaaaaaaaaaaaaaa.json';indexpath.parent.mkdir();index={'bulk_manifest_sha256':sha256(bulkpath.read_bytes()).hexdigest(),'files':[{'source_file_id':fid,'status':'available','parquet_path':str(normalized),'parquet_sha256':sha256(normalized.read_bytes()).hexdigest(),'rows_rejected':0} for fid in ids]};indexpath.write_text(json.dumps(index))
        bundle=self.root/'bundle';bundle.mkdir();(bundle/'selected-input.json').write_text(json.dumps({'retained_events_mentions':{'manifest_references':[{'path':str(bulkpath),'sha256':sha256(bulkpath.read_bytes()).hexdigest()}]}}));return start,bulkpath,indexpath,bundle
    def test_catalog_and_selected_raw_share_proofs_without_extra_unselected_slots(self):
        start,bulk,index,bundle=self.fixture()
        with patch.object(adapter,'ROOT',self.root/'private'):
            with RunMetadata() as epoch:
                rows,failures=catalog(self.root,start,start+timedelta(minutes=30),metadata=epoch);self.assertFalse(failures)
                selected=selected_raw_sources(bundle,self.root,metadata=epoch);self.assertEqual(len(selected),2)
                # Restrict the accepted selection to one actual raw ID/SHA.
                selected.pop('20261001001500.export');filtered={slot:[r for r in values if r['source_file_id'] in selected and selected[r['source_file_id']]==r['source_sha256']] for slot,values in rows.items()}
                result=adapter.artifacts(self.root,start,start+timedelta(minutes=30),candidates=filtered,strict_candidates=True,metadata=epoch)
                self.assertEqual([r['status'] for r in result],['available','missing']);self.assertEqual(epoch.summary()['files_read'],2);self.assertGreater(epoch.summary()['cache_hits'],0)
        self.assertEqual(epoch.summary()['end_recheck_reads'],2)
    def test_index_drift_after_catalog_blocks_the_source_epoch(self):
        start,bulk,index,bundle=self.fixture()
        with self.assertRaises(ValueError):
            with RunMetadata() as epoch:
                rows,failures=catalog(self.root,start,start+timedelta(minutes=30),metadata=epoch);self.assertFalse(failures)
                index.write_text('{"changed":true}')
        self.assertFalse(epoch.verified)
    def test_wrong_selected_manifest_SHA_cannot_use_the_cached_catalog(self):
        start,bulk,index,bundle=self.fixture();p=bundle/'selected-input.json';v=json.loads(p.read_bytes());v['retained_events_mentions']['manifest_references'][0]['sha256']='0'*64;p.write_text(json.dumps(v))
        with RunMetadata() as epoch:
            catalog(self.root,start,start+timedelta(minutes=30),metadata=epoch)
            with self.assertRaises(ValueError):selected_raw_sources(bundle,self.root,metadata=epoch)
    def test_unchanged_aggregation_keeps_existing_DTO_epoch_but_real_formula_changes_do_not(self):
        self.assertEqual(calculation_signature(ROOT),LEGACY_CALCULATION);self.assertEqual(aggregation_method(ROOT),LEGACY_METHOD)
        (self.root/'scripts').mkdir();(self.root/'config').mkdir()
        for name in ['scripts/export_shared_gdelt.py','scripts/r_support.py','config/r_definitions.json']:shutil.copyfile(ROOT/name,self.root/name)
        p=self.root/'scripts/export_shared_gdelt.py';p.write_text(p.read_text(encoding='utf-8').replace('count(*) AS event_count','count(*)+1 AS event_count'),encoding='utf-8');self.assertNotEqual(aggregation_method(self.root),LEGACY_METHOD)

if __name__=='__main__':unittest.main()
