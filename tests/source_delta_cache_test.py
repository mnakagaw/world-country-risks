"""Exact epoch reuse across run views; current-source validation still runs."""
from pathlib import Path
from hashlib import sha256
from types import SimpleNamespace
from unittest.mock import patch
import json,tempfile,unittest,shutil
import source_dto_cache as cache
import bounded_source_io as bounded
import rebuild_reuse_test as original
import rebuild_baselines as rebuild

class Cache(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='wcr-dto-epoch-');self.root=Path(self.tmp.name);self.repo=self.root/'repo';self.repo.mkdir();self.external=self.root/'external';self.external.mkdir()
        self.capacity=patch.object(bounded.shutil,'disk_usage',return_value=SimpleNamespace(free=200*1024**3));self.capacity.start()
        self.io=bounded.SourceIO(self.repo,{'external_storage':True},self.repo/'run1',external_guard=lambda n:self.external)
        self.cache=cache.DTOCache(self.io,{'input_code':'a'*64,'method':'b'*64,'cutoff':18});self.source=self.repo/'dto.json';self.source.write_bytes(b'{"fixed":"original DTO"}\n');self.epoch='c'*64;self.day='2026-10-20'
    def tearDown(self):self.capacity.stop();self.tmp.cleanup()
    def test_same_input_code_method_reused_from_different_run_without_copy(self):
        target=self.cache.put(self.day,self.epoch,self.source);io2=bounded.SourceIO(self.repo,{'external_storage':True},self.repo/'run2',external_guard=lambda n:self.external);again=cache.DTOCache(io2,self.cache.contract)
        with patch.object(io2,'copy',side_effect=AssertionError('cached DTO must not copy')),patch.object(io2,'atomic_json',side_effect=AssertionError('cached DTO must not rewrite')):
            path,value=again.get(self.day,self.epoch)
        self.assertEqual(path,target);self.assertEqual(value,{'fixed':'original DTO'});self.assertEqual(again.metrics['bytes_written'],0)
    def test_changed_epoch_code_method_or_cutoff_cannot_reuse(self):
        self.cache.put(self.day,self.epoch,self.source);self.assertIsNone(self.cache.get(self.day,'d'*64))
        for field in ['input_code','method','cutoff']:
            changed={**self.cache.contract,field:'different'};self.assertIsNone(cache.DTOCache(self.io,changed).get(self.day,self.epoch))
    def test_corrupt_object_and_wrong_reference_are_rejected(self):
        target=self.cache.put(self.day,self.epoch,self.source);target.write_bytes(b'{"fixed":"modified DTO"}\n')
        with self.assertRaisesRegex(ValueError,'integrity'):self.cache.get(self.day,self.epoch)
        record=self.cache.index(self.day,self.epoch);value=json.loads(record.read_bytes());value['date']='2026-10-19';record.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError,'reference'):self.cache.get(self.day,self.epoch)
    def test_immutable_object_conflict_cannot_overwrite(self):
        checksum=sha256(self.source.read_bytes()).hexdigest();target=self.cache.object(checksum);target.parent.mkdir(parents=True);target.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError,'conflict'):self.cache.put(self.day,self.epoch,self.source)
        self.assertEqual(target.read_bytes(),b'corrupt')
    def test_contract_binds_full_writer_runtime_and_source_dependencies(self):
        (self.repo/'scripts').mkdir();(self.repo/'config').mkdir();producer=self.repo/'producer';(producer/'engine').mkdir(parents=True)
        for name in ['export_shared_gdelt.py','aggregation_epoch.py','r_support.py','bounded_source_io.py','source_dto_cache.py','rebuild_baselines.py','bootstrap_baseline.mjs']:(self.repo/'scripts'/name).write_bytes(b'fixture writer')
        (self.repo/'config/r_definitions.json').write_bytes(b'{}');(producer/'engine/gdelt.py').write_bytes(b'fixture canonicalizer');node=self.repo/'node.bin';node.write_bytes(b'fixture runtime')
        policy={'archive_root':str(self.repo/'archive'),'execbrief_root':str(producer),'node':str(node)}
        first=cache.contract(self.repo,policy,'a'*64,'b'*64,18,'execbrief-03-v1');(self.repo/'scripts/export_shared_gdelt.py').write_bytes(b'changed writer');node.write_bytes(b'changed runtime')
        second=cache.contract(self.repo,policy,'a'*64,'b'*64,18,'execbrief-03-v1');self.assertNotEqual(first['writer_code'],second['writer_code']);self.assertNotEqual(first['runtime']['node_binary_sha256'],second['runtime']['node_binary_sha256']);self.assertIn('duckdb_binary_sha256',first['runtime'])

class Rebuild(unittest.TestCase):
    setUp=original.ExistingReuse.setUp
    tearDown=original.ExistingReuse.tearDown
    dto=original.ExistingReuse.dto
    catalog=original.ExistingReuse.catalog
    artifacts=original.ExistingReuse.artifacts
    export=original.ExistingReuse.export
    bootstrap=original.ExistingReuse.bootstrap
    # Override the inherited scenario runner to exercise the candidate's exact
    # regular rebuild entrance with two different private F series directories.
    def test_next_run_reuses_new_objects_and_old_readonly_views_with_original_rechecks(self):
        short=tempfile.TemporaryDirectory(prefix='wcr-epoch-');self.addCleanup(short.cleanup);previous=self.root;self.root=Path(short.name);shutil.copytree(previous,self.root,dirs_exist_ok=True)
        for name in ['folder','bulk','bundle','history']:setattr(self,name,self.root/getattr(self,name).relative_to(previous))
        selected=self.bundle/'selected-input.json';value=json.loads(selected.read_bytes());value['retained_events_mentions']['manifest_references'][0]['path']=str(self.bulk);selected.write_text(json.dumps(value))
        external=self.root/'external';external.mkdir();base_contract={'schema':'fixture-only','method':original.LEGACY_METHOD,'cutoff':18}
        def run(series):
            policy={'archive_root':str(self.root),'series_root':str(series),'node':'not-launched','external_storage':True,'source_io':{'legacy_dto_root':str(self.root/'series/baseline-sources')}}
            with patch.object(rebuild,'ROOT',self.root),patch.object(rebuild,'aggregation_method',return_value=original.LEGACY_METHOD),patch.object(rebuild,'calculation_signature',return_value='fixture'),patch.object(rebuild,'catalog',side_effect=self.catalog),patch.object(rebuild,'artifacts',side_effect=self.artifacts),patch.object(rebuild,'export',side_effect=self.export),patch.object(rebuild.subprocess,'run',side_effect=self.bootstrap),patch.object(cache,'contract',return_value=base_contract),patch.object(bounded,'external_root',side_effect=lambda n:external),patch.object(bounded.shutil,'disk_usage',return_value=SimpleNamespace(free=200*1024**3)):
                return rebuild.rebuild(policy,self.cutoff.isoformat(),self.root/'run/source.json',self.bundle)
        run(self.root/'series');self.exported.clear();self.calls.clear();second=run(self.root/'next-series')
        self.assertEqual(second['performance']['stable_dto_cache']['hits'],2);self.assertEqual(second['performance']['stable_dto_cache']['bytes_written'],0);self.assertEqual(self.exported,[])
        self.assertEqual(second['performance']['reuse_counts']['baseline_dto_existing_cache'],15)
        self.assertEqual(len(self.calls),15);self.assertTrue(second['performance']['metadata']['full_end_recheck_passed']);self.assertEqual(second['performance']['metadata']['end_recheck_reads'],1)
        index=json.loads((self.root/'next-series/baseline-dto-index.json').read_bytes());self.assertEqual(len(index['files']),15)
