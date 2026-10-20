"""Only the reviewed new pair accepts real downloaded/reused origin bounds."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
import copy,json,unittest
import source_corrective_parent_test as corrective
import source_supplement_test as fixture
from source_revision_test import save
from source_revision_queue import InvalidRequest

class OriginalAcquisition(unittest.TestCase):
    def setUp(self):
        self.f=corrective.Corrective('test_old_and_new_reviewed_resolver_pairs_remain_independently_accepted');self.f.setUp();f=self.f;f.validator='ba2e1f1b7dd5be6d12bc9ed54f0eca93ffd32140baf8e0cf9501eec3a5c27817';f.resolver='8db5952c8096f1232ac4cf5155968212d2aa5b8d80996e36124341916e8bd873'
        self.start=datetime.strptime(f.newfid[:14],'%Y%m%d%H%M%S').replace(tzinfo=timezone.utc);self.end=self.start+timedelta(minutes=15);self.origin=f.archive/'manifests/fixture-origin'/(self.start.strftime('%Y%m%dT%H%M%SZ')+'_'+self.end.strftime('%Y%m%dT%H%M%SZ'))/'gdelt-bulk-manifest.json'
        self.original={'kind':'gdelt_bulk_manifest','schema_version':1,'manifest_id':'real-original-quarter','source_series':['english','translation'],'window':{'start_utc':self.start.isoformat(),'end_utc':self.end.isoformat()},'generated_at':(f.at-timedelta(seconds=1)).isoformat(),'files':[{'file_id':f.newfid,'sha256':f.row['raw']['sha256'],'status':'reused'}]};self.emit(self.original)
    def tearDown(self):self.f.tearDown()
    def emit(self,value,path=None):
        path=path or self.origin;save(path,value);self.f.row['acquisition_evidence']={'kind':'immutable-bulk-acquisition','manifest':fixture.ref(path),'acquisition_completed_by_utc':value['generated_at'],'exact_file_download_time_utc':None};self.f.emit()
    def test_new_pair_accepts_real_downloaded_or_reused_original_without_exact_clock(self):
        for status in ['downloaded','reused']:
            value=copy.deepcopy(self.original);value['files'][0]['status']=status;self.emit(value);_,binding=self.f.freeze();self.assertEqual(binding['source_revision']['validator_sha256'],self.f.validator)
    def test_legacy_pair_does_not_acquire_the_reused_relaxation(self):
        self.f.validator='b322d054f45e7d638e4d3085340d25f819055425f089c4f17ae04188d4fd0221';self.f.emit()
        with self.assertRaises(InvalidRequest):self.f.freeze()
    def test_synthetic_subset_and_wrong_kind_are_rejected_with_rebound_SHA(self):
        for change in [{'source_scope':'Retained subset'},{'manifest_id':'retained-english-priority-fake'},{'kind':'synthesized'},{'schema_version':2}]:
            self.emit({**self.original,**change})
            with self.assertRaises(InvalidRequest):self.f.freeze()
    def test_wrong_original_fid_SHA_status_or_future_bound_is_rejected(self):
        for field,value in [('file_id',self.f.oldfid),('sha256','e'*64),('status','missing')]:
            bad=copy.deepcopy(self.original);bad['files'][0][field]=value;self.emit(bad)
            with self.assertRaises(InvalidRequest):self.f.freeze()
        self.emit({**self.original,'generated_at':(self.f.at+timedelta(seconds=1)).isoformat()})
        with self.assertRaises(InvalidRequest):self.f.freeze()
    def test_outside_archive_noncanonical_path_and_wrong_window_are_rejected(self):
        self.emit(self.original,self.f.producer/'outside/gdelt-bulk-manifest.json')
        with self.assertRaises(InvalidRequest):self.f.freeze()
        self.emit(self.original,self.origin.with_name('synthetic.json'))
        with self.assertRaises(InvalidRequest):self.f.freeze()
        bad=copy.deepcopy(self.original);bad['window']['start_utc']=self.end.isoformat();self.emit(bad)
        with self.assertRaises(InvalidRequest):self.f.freeze()
    def test_new_validator_requires_its_exact_resolver_and_origin_raw_SHA(self):
        self.f.resolver='d14d72d26fbb723257b3c8931521075377c1ccbf40e2db3d0160817fe6f73a39';self.f.emit()
        with self.assertRaises(InvalidRequest):self.f.freeze()
        self.f.resolver='8db5952c8096f1232ac4cf5155968212d2aa5b8d80996e36124341916e8bd873';self.emit(self.original);self.origin.write_text(json.dumps({**self.original,'tampered':True}))
        with self.assertRaises(InvalidRequest):self.f.freeze()
