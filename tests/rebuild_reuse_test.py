"""Fifteen tiny DTO fixtures, never a live/full reconstruction."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
from hashlib import sha256
from unittest.mock import patch
import tempfile,sys,json,unittest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import rebuild_baselines as rebuild
from aggregation_epoch import LEGACY_METHOD

class ExistingReuse(unittest.TestCase):
    def setUp(self):
        base=ROOT/'work/rebuild-reuse-fixtures';base.mkdir(parents=True,exist_ok=True);self.tmp=tempfile.TemporaryDirectory(dir=base);self.root=Path(self.tmp.name);self.cutoff=datetime(2026,10,15,18,tzinfo=timezone.utc);self.folder=self.root/'series/baseline-sources';self.folder.mkdir(parents=True);self.metadata=None;self.calls=[];self.exported=[]
        bulk=self.root/'manifests/acquired/20261001T000000Z_20261001T003000Z/gdelt-bulk-manifest.json';bulk.parent.mkdir(parents=True);bulk.write_text(json.dumps({'files':[{'file_id':'20261001000000.export','status':'downloaded','sha256':'1'*64}]}));self.bulk=bulk
        self.bundle=self.root/'bundle';self.bundle.mkdir();(self.bundle/'selected-input.json').write_text(json.dumps({'retained_events_mentions':{'manifest_references':[{'path':str(bulk),'sha256':sha256(bulk.read_bytes()).hexdigest()}]}}))
        self.rows=[{'slot':'fixture','status':'available','path':'fixture.parquet','sha256':'3'*64,'source_file_id':'20261001000000.export','source_sha256':'1'*64,'rows_rejected':0}]
        epoch=sha256((LEGACY_METHOD+json.dumps(self.rows,sort_keys=True)).encode()).hexdigest()
        for offset in range(14,1,-1):
            day=(self.cutoff-timedelta(days=offset)+timedelta(hours=9)).date().isoformat();(self.folder/(day+'.json')).write_text(json.dumps(self.dto(day)));(self.folder/(day+'.epoch.json')).write_text(json.dumps({'epoch':epoch,'method_sha256':LEGACY_METHOD}))
        self.history=self.root/'series/v2-history.json';self.history.write_bytes(b'prior history')
    def tearDown(self):self.tmp.cleanup()
    def dto(self,day):return {'source_status':'partial','coverage':{'available_slots':1},'fixture_date':day}
    def catalog(self,archive,start,end,metadata=None):
        self.metadata=metadata;metadata.document(self.bulk)
        return {'fixture':[self.rows[0],{**self.rows[0],'source_sha256':'f'*64}]},[]
    def artifacts(self,archive,start,end,**kwargs):
        self.calls.append(kwargs)
        if kwargs['strict_candidates']:
            self.assertEqual(kwargs['candidates'],{'fixture':[self.rows[0]]})
        return self.rows
    def export(self,archive,end,path,*args,**kwargs):
        self.assertIs(kwargs['artifact_rows'],self.rows);self.exported.append(path)
        if getattr(self,'drift',False):self.bulk.write_text('{"changed":true}')
        result=self.dto((end+timedelta(hours=9)).date().isoformat());path.write_text(json.dumps(result));return result
    def bootstrap(self,*args,**kwargs):
        self.assertTrue(self.metadata.verified)
    def call(self):
        policy={'archive_root':str(self.root),'series_root':str(self.root/'series'),'node':'never-launched'}
        with patch.object(rebuild,'ROOT',self.root),patch.object(rebuild,'aggregation_method',return_value=LEGACY_METHOD),patch.object(rebuild,'calculation_signature',return_value='fixture'),patch.object(rebuild,'catalog',side_effect=self.catalog),patch.object(rebuild,'artifacts',side_effect=self.artifacts),patch.object(rebuild,'export',side_effect=self.export),patch.object(rebuild.subprocess,'run',side_effect=self.bootstrap) as bootstrap:
            try:return rebuild.rebuild(policy,self.cutoff.isoformat(),self.root/'run/source.json',self.bundle)
            finally:self.bootstraps=bootstrap.call_count
    def test_existing_thirteen_DTOs_reused_and_new_exports_do_not_repeat_artifact_acquisition(self):
        result=self.call();self.assertEqual(sum(d['reused'] for d in result['days']),13);self.assertEqual(len(self.calls),15);self.assertEqual(len(self.exported),2)
        p=result['performance'];self.assertEqual(p['reuse_counts'],{'baseline_dto_existing_cache':13,'prepared_artifacts_for_aggregation':2});self.assertTrue(p['metadata']['full_end_recheck_passed']);self.assertGreaterEqual(p['metadata']['cache_hits'],1)
        for name,row in p['phases'].items():self.assertIn('started_at_utc',row);self.assertIn('finished_at_utc',row);self.assertGreaterEqual(row['elapsed_seconds'],0)
    def test_changed_metadata_blocks_bootstrap_and_records_failed_source_timing(self):
        self.drift=True
        with self.assertRaises(ValueError):self.call()
        self.assertEqual(self.bootstraps,0);self.assertEqual(self.history.read_bytes(),b'prior history');metrics=json.loads((self.root/'run/source-metrics.json').read_bytes());self.assertEqual(metrics['status'],'failed');self.assertEqual(metrics['phases']['metadata_end_recheck']['status'],'failed')

if __name__=='__main__':unittest.main()
