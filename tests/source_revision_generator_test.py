"""Real bundled-Node generation in small isolated fixtures; no public writes."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
import json,subprocess,tempfile,unittest
from source_revision_test import save
ROOT=Path(__file__).resolve().parents[1]
NODE=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'

class RealGenerator(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='wcr-gen-');self.root=Path(self.temp.name);self.output=self.root/'data';self.parent='a'*64
        self.cutoff=datetime(2026,10,18,18,tzinfo=timezone.utc);self.day='2026-10-19';self.history=self.root/'history.json';save(self.history,{})
        checksum=save(self.output/(self.parent+'.json'),{'date':self.day,'snapshot_id':self.parent,'fixture_only':True})
        save(self.output/'manifest.json',{self.day:{'snapshot_id':self.parent,'path':self.parent+'.json','sha256':checksum}})
        self.source={'schema':'country-risk-observations-v2','code_system':'FIPS 10-4','edition_date':self.day,'cutoff_utc':'2026-10-18T18:00:00Z','source_status':'partial','cutoff_series':'execbrief-03-v1','coverage':{'available_slots':0,'expected_slots':192,'rejected_rows':0},'input_artifacts':[],'countries':{},'source_manifest_sha256':'d'*64,
            'window':{'start_utc':'2026-10-16T18:00:00Z','end_utc':'2026-10-18T18:00:00Z','semantics':'[start,end)','time_field':'DATEADDED'},
            'upstream_sync':{'date':self.day,'cutoff_utc':'2026-10-18T18:00:00Z','source_revision':{'parent_snapshot_id':self.parent,'known_after_original_cutoff':True,'accepted_receipt_sha256':'c'*64,'accepted_at_utc':'2026-10-19T01:00:00Z','history_only':False}}}
    def tearDown(self):self.temp.cleanup()
    def run_generator(self,historical=False):
        save(self.root/'source.json',self.source)
        return subprocess.run([str(NODE),'scripts/generate_v2.mjs','--input',str(self.root/'source.json'),'--history',str(self.history),'--output-dir',str(self.output),'--audit-dir',str(self.root/'audit'),*(['--historical'] if historical else [])],cwd=ROOT,capture_output=True,timeout=60)
    def test_real_generation_keeps_original_links_late_label_unknown_and_reuses_same_input(self):
        original=(self.output/(self.parent+'.json')).read_bytes();result=self.run_generator();self.assertEqual(result.returncode,0,result.stderr.decode())
        records=json.loads((self.output/'manifest.json').read_bytes());row=records[self.day];self.assertNotEqual(row['snapshot_id'],self.parent);self.assertEqual([r['kind'] for r in row['revisions']],['original','late_source_revision'])
        value=json.loads((self.output/'latest.json').read_bytes());self.assertTrue(value['upstream_sync']['source_revision']['known_after_original_cutoff']);self.assertEqual(value['cutoff_utc'],'2026-10-18T18:00:00Z');self.assertEqual(value['mode_counts']['surge_r']['unknown'],239)
        self.assertEqual((self.output/(self.parent+'.json')).read_bytes(),original);before=(self.output/'latest.json').read_bytes();again=self.run_generator();self.assertEqual(again.returncode,0,again.stderr.decode());self.assertIn(b'"status":"reused"',again.stdout);self.assertEqual((self.output/'latest.json').read_bytes(),before)
    def test_real_history_only_revision_leaves_newer_current_bytes_identical(self):
        for name in ['latest.json','status.json']:save(self.output/name,{'date':'2026-10-20','fixture_only':True})
        before=[(self.output/n).read_bytes() for n in ['latest.json','status.json']];self.source['upstream_sync']['source_revision']['history_only']=True
        result=self.run_generator(True);self.assertEqual(result.returncode,0,result.stderr.decode());self.assertEqual(before,[(self.output/n).read_bytes() for n in ['latest.json','status.json']])
    def test_invalid_late_time_is_rejected_before_output(self):
        self.source['upstream_sync']['source_revision']['accepted_at_utc']=self.source['cutoff_utc'];before=(self.output/'manifest.json').read_bytes();result=self.run_generator()
        self.assertNotEqual(result.returncode,0);self.assertEqual(before,(self.output/'manifest.json').read_bytes());self.assertFalse((self.output/'latest.json').exists())

if __name__=='__main__':unittest.main()
