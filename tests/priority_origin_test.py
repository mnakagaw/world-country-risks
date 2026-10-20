"""Decorated references reproduce the frozen daily writer's selection count."""
from pathlib import Path
from hashlib import sha256
import json,copy,tempfile,unittest,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import source_supplement_gate as gate
from source_revision_queue import InvalidRequest
from unittest.mock import patch
from datetime import datetime,timezone

class PriorityOrigin(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='wcr-priority-origin-');self.root=Path(self.temp.name);self.archive=self.root/'archive';self.producer=self.root/'producer';self.path=self.archive/'manifests/quarter/gdelt-bulk-manifest.json';self.path.parent.mkdir(parents=True)
        self.rows=[{'file_id':'20261019071500'+suffix,'status':'downloaded','sha256':'a'*64,'storage_path':str(self.archive/'raw/file.zip')} for suffix in ['.export','.mentions','.translation.export','.translation.mentions']]
        self.value={'kind':'gdelt_bulk_manifest','schema_version':1,'files':self.rows+[{'file_id':'20261017180000.export','status':'downloaded','sha256':'b'*64},{'file_id':'20261019071500.failed','status':'missing'}],'coverage_status':'complete'};self.raw=json.dumps(self.value).encode();self.path.write_bytes(self.raw);self.reference={'path':str(self.path),'sha256':sha256(self.raw).hexdigest(),'coverage_status':'complete','selected_files':4}
        self.selection={'window_start_utc':'2026-10-18T18:00:00Z','cutoff_utc':'2026-10-19T18:00:00Z','retained_events_mentions':{'manifest_references':[copy.deepcopy(self.reference)]}}
        self.reader=gate.Reader({'archive_root':str(self.archive),'execbrief_root':str(self.producer)});self.reader.frozen_selections=[self.selection]
    def tearDown(self):self.temp.cleanup()
    def test_decorated_and_old_identity_read_same_SHA_bound_original(self):
        old={k:self.reference[k] for k in ('path','sha256')};self.assertEqual(gate.priority_original(self.reader,self.reference),self.value);self.assertEqual(gate.priority_original(self.reader,old),self.value);self.reader.recheck()
        with self.assertRaises(InvalidRequest):self.reader.bound(self.reference,self.archive/'manifests')
    def test_annotation_count_type_bounds_and_coverage_are_checked(self):
        for change in [{'selected_files':True},{'selected_files':0},{'selected_files':16385},{'selected_files':3},{'selected_files':6},{'coverage_status':'partial'},{'coverage_status':'unknown'}]:
            with self.assertRaises(InvalidRequest):gate.priority_original(self.reader,{**self.reference,**change})
    def test_unknown_or_partial_decoration_cannot_strip_into_valid_identity(self):
        for value in [{**self.reference,'extra':1},{k:v for k,v in self.reference.items() if k!='selected_files'},{k:v for k,v in self.reference.items() if k!='coverage_status'},None]:
            with self.assertRaises(InvalidRequest):gate.priority_original(self.reader,value)
    def test_original_SHA_and_owner_checks_remain_mandatory(self):
        outside=self.root/'outside.json';outside.write_bytes(self.raw)
        with self.assertRaises(InvalidRequest):gate.priority_original(self.reader,{**self.reference,'path':str(outside)})
        with self.assertRaises(InvalidRequest):gate.priority_original(self.reader,{**self.reference,'sha256':'e'*64})
    def test_synthetic_or_non_original_manifest_is_rejected_even_with_rebound_SHA(self):
        for change in [{'kind':'synthetic'},{'schema_version':2},{'source_scope':'subset'},{'files':None}]:
            raw=json.dumps({**self.value,**change}).encode();self.path.write_bytes(raw);reader=gate.Reader({'archive_root':str(self.archive),'execbrief_root':str(self.producer)});reader.frozen_selections=[self.selection]
            with self.assertRaises(InvalidRequest):gate.priority_original(reader,{**self.reference,'sha256':sha256(raw).hexdigest()})
    def test_original_is_rechecked_after_cached_read(self):
        gate.priority_original(self.reader,self.reference);self.path.write_bytes(self.raw+b' ')
        with self.assertRaises(InvalidRequest):self.reader.recheck()
    def test_annotated_ref_requires_exact_SHA_bound_frozen_selection_and_window(self):
        self.reader.frozen_selections=[]
        with self.assertRaises(InvalidRequest):gate.priority_original(self.reader,self.reference)
        changed=copy.deepcopy(self.selection);changed['window_start_utc']='2026-10-17T18:00:00Z';changed['cutoff_utc']='2026-10-18T18:00:00Z';self.reader.frozen_selections=[changed]
        with self.assertRaises(InvalidRequest):gate.priority_original(self.reader,self.reference)
    def test_four_frozen_selected_rows_are_distinct_from_six_original_and_one_subset(self):
        from source_revision_test import save
        rp=self.producer/'.daily-work/rolling-search/em-raw-priority/fixture.json';save(rp,{'kind':'em-raw-priority-stage-v1','no_new_queue_or_worker':True,'intervals':[{'files':[self.rows[0]]}]})
        subset={'kind':'gdelt_bulk_manifest','schema_version':1,'dataset_hash':'d'*64,'source_series':['english'],'coverage_status':'partial','source_scope':'Retained English export subset only; original four-file quarter coverage and daily cutoff remain unchanged','files':[self.rows[0]],'source_manifest_references':[self.reference],'source_raw_priority_receipts':[{'path':str(rp),'sha256':sha256(rp.read_bytes()).hexdigest()}]}
        sp=self.producer/'.daily-work/rolling-search/em-english-priority'/('d'*64)/'gdelt-bulk-manifest.json';save(sp,subset);ref={'path':str(sp),'sha256':sha256(sp.read_bytes()).hexdigest(),'bytes':sp.stat().st_size};self.assertEqual(len(gate.read_bulk(self.reader,ref)['files']),1)
    def test_selection_adapter_uses_bounded_SHA_read_and_final_original_recheck(self):
        from source_revision_test import save
        from execbrief_sync import selected_raw_sources
        bundle=self.root/'bundle';save(bundle/'selected-input.json',self.selection);ordinary=Path.read_bytes
        def reject_read_all(path):
            if path.resolve().is_relative_to(self.archive.resolve()):raise OSError(22,'fixture SMB read-all unavailable')
            return ordinary(path)
        with patch.object(Path,'read_bytes',reject_read_all):
            selected=selected_raw_sources(bundle,self.archive,metadata=self.reader);self.assertEqual(selected['20261019071500.export'],'a'*64);self.reader.recheck()
        self.path.write_bytes(self.raw+b' ')
        with self.assertRaises(InvalidRequest):self.reader.recheck()
    def test_original_frozen_raw_identity_can_replace_only_the_recent_transfer_proof(self):
        from source_revision_test import save
        rp=self.producer/'.daily-work/rolling-search/em-raw-priority/fixture.json';save(rp,{'kind':'em-raw-priority-stage-v1','no_new_queue_or_worker':True,'intervals':[]})
        row=self.rows[0];subset={'kind':'gdelt_bulk_manifest','schema_version':1,'dataset_hash':'d'*64,'source_series':['english'],'coverage_status':'partial','source_scope':'Retained English export subset only; original four-file quarter coverage and daily cutoff remain unchanged','files':[row],'source_manifest_references':[self.reference],'source_raw_priority_receipts':[{'path':str(rp),'sha256':sha256(rp.read_bytes()).hexdigest()}]}
        sp=self.producer/'.daily-work/rolling-search/em-english-priority'/('d'*64)/'gdelt-bulk-manifest.json';save(sp,subset);ref={'path':str(sp),'sha256':sha256(sp.read_bytes()).hexdigest(),'bytes':sp.stat().st_size}
        for frozen in [None,{}, {row['file_id']:'b'*64}]:
            with self.assertRaises(InvalidRequest):gate.read_bulk(self.reader,ref,frozen)
        self.assertEqual(gate.read_bulk(self.reader,ref,{row['file_id']:row['sha256']}),subset)
        bad=copy.deepcopy(subset);bad['files'][0]['storage_path']=str(self.archive/'raw/other.zip');save(sp,bad);badref={'path':str(sp),'sha256':sha256(sp.read_bytes()).hexdigest(),'bytes':sp.stat().st_size}
        with self.assertRaises(InvalidRequest):gate.read_bulk(self.reader,badref,{row['file_id']:row['sha256']})
    def test_archive_acquisition_substitute_requires_full_existing_origin_verifier(self):
        from source_revision_test import save
        origin=self.archive/'manifests/2026-10-19/20261019T071500Z_20261019T073000Z/gdelt-bulk-manifest.json';value={'kind':'gdelt_bulk_manifest','schema_version':1,'manifest_id':'real-quarter','source_series':['english','translation'],'window':{'start_utc':'2026-10-19T07:15:00Z','end_utc':'2026-10-19T07:30:00Z'},'generated_at':'2026-10-19T07:39:00Z','files':self.rows};save(origin,value)
        ref={'path':str(origin),'sha256':sha256(origin.read_bytes()).hexdigest(),'bytes':origin.stat().st_size};row=self.rows[0];source={'raw':{'sha256':row['sha256']},'acquisition_evidence':{'kind':'immutable-bulk-acquisition','manifest':ref,'acquisition_completed_by_utc':value['generated_at']}}
        rp=self.producer/'.daily-work/rolling-search/em-raw-priority/fixture.json';save(rp,{'kind':'em-raw-priority-stage-v1','no_new_queue_or_worker':True,'intervals':[]});subset={'kind':'gdelt_bulk_manifest','schema_version':1,'dataset_hash':'d'*64,'source_series':['english'],'coverage_status':'partial','source_scope':'Retained English export subset only; original four-file quarter coverage and daily cutoff remain unchanged','files':[row],'source_manifest_references':[{k:ref[k] for k in ('path','sha256')}],'source_raw_priority_receipts':[{'path':str(rp),'sha256':sha256(rp.read_bytes()).hexdigest()}]};sp=self.producer/'.daily-work/rolling-search/em-english-priority'/('d'*64)/'gdelt-bulk-manifest.json';save(sp,subset);sref={'path':str(sp),'sha256':sha256(sp.read_bytes()).hexdigest(),'bytes':sp.stat().st_size};accepted=datetime(2026,10,20,tzinfo=timezone.utc)
        with self.assertRaises(InvalidRequest):gate.read_bulk(self.reader,sref)
        self.assertEqual(gate.read_bulk(self.reader,sref,None,{row['file_id']:source},accepted),subset)
        for change in [{'raw':{'sha256':'b'*64}},{'acquisition_evidence':{**source['acquisition_evidence'],'acquisition_completed_by_utc':'2026-10-19T07:40:00Z'}},{'acquisition_evidence':{'kind':'synthetic'}}]:
            with self.assertRaises(InvalidRequest):gate.read_bulk(self.reader,sref,None,{row['file_id']:{**source,**change}},accepted)
