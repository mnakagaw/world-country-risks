"""Lossless bounded NAS parts, old flat readers, and real staged restoration."""
from pathlib import Path
from hashlib import sha256
from types import SimpleNamespace
from unittest.mock import patch
import json,tempfile,unittest
import handoff_v2 as handoff
import handoff_objects as objects

class Handoff(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='wcr-NAS-parts-');self.root=Path(self.tmp.name);self.nas=self.root/'NAS';self.nas.mkdir();self.series=self.root/'series';self.series.mkdir();self.source=self.root/'source.json';self.source.write_bytes(b'{"source":"fixed"}\n');self.bundle=self.root/'bundle';self.bundle.mkdir();(self.bundle/'accepted.json').write_bytes(b'{"accepted":true}\n')
        (self.bundle/'manifest.json').write_text(json.dumps({'files':{'accepted.json':sha256((self.bundle/'accepted.json').read_bytes()).hexdigest()}}))
        self.history={d:{'value':('unchanged-'+d)*3000} for d in ['2026-10-17','2026-10-18','2026-10-19']};self.write_history();self.external=self.root/'external';self.external.mkdir()
        self.capacity=patch.object(objects.shutil,'disk_usage',return_value=SimpleNamespace(free=200*1024**3));self.capacity.start()
        self.external_guard=patch.object(objects,'external_root',return_value=self.external);self.external_guard.start()
    def tearDown(self):self.external_guard.stop();self.capacity.stop();self.tmp.cleanup()
    def write_history(self):self.history_raw=(json.dumps(self.history,indent=2)+'\n').encode();(self.series/'v2-history.json').write_bytes(self.history_raw)
    def save(self,id='a'*64):
        snapshot=self.root/'snapshot.json';snapshot.write_text(json.dumps({'date':'2026-10-20','snapshot_id':id}));self.snapshot_raw=snapshot.read_bytes()
        return handoff.save({'handoff_root':str(self.nas),'series_root':str(self.series)},self.source,{'status':'verified'},upstream_bundle=self.bundle,snapshot_path=snapshot)
    def manifest(self,result):return Path(result['path']),json.loads((Path(result['path'])/'manifest.json').read_bytes())
    def test_history_is_exact_bounded_parts_without_whole_read_bytes(self):
        original=Path.read_bytes
        def bounded_read(path):
            if path==self.series/'v2-history.json':raise AssertionError('history cannot use read_bytes')
            return original(path)
        with patch.object(Path,'read_bytes',bounded_read):result=self.save()
        folder,manifest=self.manifest(result);row=manifest['files']['history.private.json'];raw=b''.join(objects.entry_chunks(folder,{**row,'_name':'history.private.json'}))
        self.assertEqual(raw,self.history_raw);self.assertEqual(row['sha256'],sha256(raw).hexdigest());self.assertTrue(all(p['bytes']<=objects.OBJECT_LIMIT for p in row['storage']['parts']))
    def test_unchanged_days_and_upstream_controls_reused_and_changed_day_only_saved(self):
        first=self.save();self.history['2026-10-18']['value']='changed';self.write_history();second=self.save('b'*64)
        self.assertGreaterEqual(second['performance']['reused_objects'],3);self.assertLess(second['performance']['NAS_write_bytes'],first['performance']['NAS_write_bytes'])
        self.assertTrue(second['performance']['store_OS_lock']);objects.verify(Path(second['path']),second['manifest_sha256'])
    def test_same_packet_reuse_binds_all_current_members_and_records_verify_work(self):
        first=self.save();folder=Path(first['path']);original=(folder/'manifest.json').read_bytes();again=self.save()
        self.assertTrue(again['performance']['current_input_binding']['all_members_equal']);self.assertGreater(again['performance']['existing_packet_verification']['bytes'],len(self.history_raw));self.assertEqual(again['performance']['NAS_write_bytes'],0);self.assertEqual((folder/'manifest.json').read_bytes(),original)
    def test_same_snapshot_with_changed_source_publication_upstream_or_history_is_not_success(self):
        first=self.save();folder=Path(first['path']);original=(folder/'manifest.json').read_bytes();source=self.source.read_bytes();accepted=(self.bundle/'accepted.json').read_bytes()
        for path,changed in [(self.source,b'{"different":"source"}'),(self.bundle/'accepted.json',b'{"different":"upstream"}'),(self.series/'v2-history.json',b'{"different":"history"}')]:
            before=path.read_bytes();path.write_bytes(changed)
            with self.assertRaises(handoff.PacketBindingConflict):self.save()
            path.write_bytes(before);self.assertEqual((folder/'manifest.json').read_bytes(),original)
        with self.assertRaises(handoff.PacketBindingConflict):handoff.save({'handoff_root':str(self.nas),'series_root':str(self.series)},self.source,{'status':'verified','new_receipt':True},upstream_bundle=self.bundle,snapshot_path=self.root/'snapshot.json')
        self.assertEqual((folder/'manifest.json').read_bytes(),original)
    def test_compact_and_long_line_history_is_lossless_with_fixed_cap(self):
        raw=json.dumps({'2026-10-20':{'long':'x'*(objects.OBJECT_LIMIT+123)}}).encode();p=self.series/'v2-history.json';p.write_bytes(raw);parts=list(objects.history_parts(p))
        self.assertEqual(b''.join(parts),raw);self.assertLessEqual(max(map(len,parts)),objects.OBJECT_LIMIT)
    def test_actual_restore_materializes_original_bytes_in_new_F_staging(self):
        result=self.save();folder,manifest=self.manifest(result);target=self.external/'world-country-risks/restores/fixture'
        restored=objects.restore(folder,target,result['manifest_sha256']);self.assertFalse(restored['jobs_enabled']);self.assertFalse(restored['live_db_restored'])
        self.assertEqual((target/'history.private.json').read_bytes(),self.history_raw);self.assertEqual((target/'snapshot.json').read_bytes(),self.snapshot_raw);self.assertEqual((target/'source.private.json').read_bytes(),self.source.read_bytes())
        for name,row in manifest['files'].items():self.assertEqual(sha256((target/name).read_bytes()).hexdigest(),row['sha256'])
        with self.assertRaisesRegex(ValueError,'already exists'):objects.restore(folder,target,result['manifest_sha256'])
    def test_latest_locator_resolves_bound_new_manifest_and_rejects_path_SHA_drift(self):
        result=self.save();path=self.nas/'daily-latest.json';value={'path':Path(result['path']).relative_to(self.nas).as_posix(),'snapshot_id':'a'*64,'manifest_sha256':result['manifest_sha256']};path.write_text(json.dumps(value))
        folder,checksum,before=objects.latest_locator(path);self.assertEqual(folder,Path(result['path']));self.assertEqual(objects.verify(folder,checksum)['schema'],objects.SCHEMA)
        for change in [{'path':'../escape'},{'snapshot_id':'b'*64},{'manifest_sha256':None}]:
            path.write_text(json.dumps({**value,**change}))
            with self.assertRaises(ValueError):objects.latest_locator(path)
    def test_legacy_flat_manifest_is_verified_and_restored(self):
        folder=self.nas/'old';folder.mkdir();body=b'original flat';(folder/'snapshot.json').write_bytes(body);manifest={'snapshot_id':'legacy','files':{'snapshot.json':{'sha256':sha256(body).hexdigest(),'bytes':len(body)}}};raw=json.dumps(manifest).encode();(folder/'manifest.json').write_bytes(raw)
        result=objects.restore(folder,self.external/'world-country-risks/restores/legacy',sha256(raw).hexdigest());self.assertEqual(result['schema'],'legacy-flat-v1')
    def test_missing_corrupt_wrong_order_and_wrong_whole_SHA_are_rejected(self):
        result=self.save();folder,manifest=self.manifest(result);history=manifest['files']['history.private.json'];refs=history['storage']['parts']
        ref=refs[1];path=objects.object_path(self.nas,ref['sha256']);original=path.read_bytes();path.unlink()
        with self.assertRaises(OSError):objects.verify(folder)
        path.write_bytes(b'x'*len(original))
        with self.assertRaises(ValueError):objects.verify(folder)
        path.write_bytes(original);refs[0],refs[1]=refs[1],refs[0];(folder/'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError,'reconstructed SHA'):objects.verify(folder)
    def test_unknown_kind_path_fields_expanded_size_and_count_are_rejected(self):
        result=self.save();folder,manifest=self.manifest(result)
        for mutate in [lambda v:v.update(schema='unknown'),lambda v:v['files'].update({'../escape':{'sha256':'a'*64,'bytes':0}}),lambda v:v['files']['history.private.json']['storage']['parts'][0].update(path='../escape'),lambda v:v['files']['snapshot.json'].update(bytes=objects.FILE_LIMIT+1),lambda v:v['files']['history.private.json']['storage'].update(parts=[{'sha256':'a'*64,'bytes':0}]*(objects.MAX_PARTS+1))]:
            value=json.loads(json.dumps(manifest));mutate(value);(folder/'manifest.json').write_text(json.dumps(value))
            with self.assertRaises(ValueError):objects.load_manifest(folder)
        value=json.loads(json.dumps(manifest));value['files']={str(i)+'.json':{'sha256':'a'*64,'bytes':objects.FILE_LIMIT} for i in range(3)};(folder/'manifest.json').write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError,'expanded'):objects.load_manifest(folder)
    def test_object_reparse_path_is_rejected_before_read(self):
        result=self.save();original=Path.is_junction
        def junction(path):return path==self.nas/'objects' or original(path)
        with patch.object(Path,'is_junction',junction),self.assertRaisesRegex(ValueError,'reparse'):objects.verify(Path(result['path']))
    def test_interrupted_store_has_no_sealed_manifest_and_retry_reuses_pending(self):
        replace=handoff.os.replace
        def fail(source,target):
            if str(target).endswith('.bin'):raise OSError('fixture interrupted object promotion')
            return replace(source,target)
        with patch.object(handoff.os,'replace',side_effect=fail),self.assertRaises(OSError):self.save()
        folder=self.nas/'daily/2026-10-20'/('a'*64);self.assertFalse((folder/'manifest.json').exists())
        result=self.save();self.assertEqual(objects.verify(folder,result['manifest_sha256'])['status'],'verified')
    def test_store_lock_and_storage_reserves_are_enforced(self):
        from cycle_lock import publication_lock
        with publication_lock(self.nas/'objects-store.lock'),self.assertRaisesRegex(OSError,'owner busy'):self.save()
        with patch.object(objects.shutil,'disk_usage',return_value=SimpleNamespace(free=20*1024**3)),self.assertRaisesRegex(OSError,'capacity'):self.save()
    def test_changed_frozen_upstream_cannot_be_saved_as_accepted_bytes(self):
        (self.bundle/'accepted.json').write_bytes(b'{"accepted":false}\n')
        with self.assertRaisesRegex(ValueError,'Frozen upstream member SHA'):self.save()
    def test_restore_cannot_escape_F_staging_or_activate_live_paths(self):
        result=self.save()
        with self.assertRaises(ValueError):objects.restore(Path(result['path']),self.root/'live',result['manifest_sha256'])
    def test_snapshot_locator_cannot_escape_NAS_daily_namespace(self):
        with self.assertRaisesRegex(ValueError,'locator'):self.save('../../escape')
        self.assertFalse((self.nas/'daily').exists());self.assertFalse((self.root/'escape').exists())
    def test_interrupted_restore_cannot_leave_completion_or_partial_file(self):
        result=self.save();target=self.external/'world-country-risks/restores/interrupted';original=objects.entry_chunks;calls={}
        def interrupted(folder,row):
            name=row['_name'];calls[name]=calls.get(name,0)+1
            if name=='history.private.json' and calls[name]==2:
                yield b'partial';raise OSError('fixture mid-restore failure')
            yield from original(folder,row)
        with patch.object(objects,'entry_chunks',side_effect=interrupted),self.assertRaises(OSError):objects.restore(Path(result['path']),target,result['manifest_sha256'])
        self.assertFalse((target/'restore-disabled.json').exists());self.assertFalse(list(target.glob('*.pending')));self.assertEqual(objects.verify(Path(result['path']))['status'],'verified')
