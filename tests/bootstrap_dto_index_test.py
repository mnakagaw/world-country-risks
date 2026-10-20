"""The real Node bootstrap reads SHA-bound DTO objects with identical output."""
from pathlib import Path
from hashlib import sha256
import json,os,shutil,subprocess,tempfile,unittest

ROOT=Path(__file__).resolve().parents[1]
NODE=os.environ.get('WCR_NODE') or shutil.which('node')

@unittest.skipUnless(NODE,'Node runtime required')
class Bootstrap(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='wcr-bootstrap-');self.root=Path(self.tmp.name);(self.root/'scripts').mkdir();(self.root/'config').mkdir();self.sources=self.root/'sources';self.sources.mkdir()
        for name in ['engine_v2.mjs','monitoring_v2.mjs','fips_to_iso2.js','r_bundles.mjs']:(self.root/'scripts'/name).write_bytes((ROOT/'scripts'/name).read_bytes())
        (self.root/'src').mkdir();(self.root/'src/country-codes.js').write_bytes((ROOT/'src/country-codes.js').read_bytes())
        (self.root/'package.json').write_text('{"type":"module"}');(self.root/'config/scoring.json').write_bytes((ROOT/'config/scoring.json').read_bytes())
        script=Path(os.environ.get('WCR_BOOTSTRAP_CANDIDATE',ROOT/'scripts/bootstrap_baseline.mjs'));(self.root/'scripts/bootstrap_baseline.mjs').write_bytes(script.read_bytes())
        self.dto={'schema':'country-risk-observations-v2','edition_date':'2026-10-19','cutoff_utc':'2026-10-18T18:00:00Z','window':{'start_utc':'2026-10-16T18:00:00Z','end_utc':'2026-10-18T18:00:00Z','time_field':'DATEADDED'},'source_status':'partial','coverage':{'available_slots':1,'expected_slots':192},'countries':{},'source_manifest_sha256':'c'*64,'input_artifacts':[{'status':'available','rows_rejected':0,'slot':'2026-10-16T18:00:00Z'}]}
        self.raw=json.dumps(self.dto).encode();self.file=self.sources/'2026-10-19.json';self.file.write_bytes(self.raw);self.index=self.root/'index.json';self.index.write_text(json.dumps({'schema':'wcr-baseline-dto-index-v1','edition':'2026-10-20','cutoff_hour_utc':18,'contract_sha256':'a'*64,'files':{'2026-10-19':{'path':str(self.file),'bytes':len(self.raw),'sha256':sha256(self.raw).hexdigest()}}}))
    def tearDown(self):self.tmp.cleanup()
    def run_bootstrap(self,selector,label):
        return subprocess.run([NODE,str(self.root/'scripts/bootstrap_baseline.mjs'),*selector,'--date','2026-10-20','--cutoff-hour','18','--history',str(self.root/(label+'-history.json')),'--report',str(self.root/(label+'-report.json'))],cwd=self.root,capture_output=True,timeout=30)
    def test_bound_index_and_original_folder_have_identical_history_and_report(self):
        first=self.run_bootstrap(['--sources',str(self.sources)],'folder');second=self.run_bootstrap(['--source-index',str(self.index)],'index');self.assertEqual(first.returncode,0,first.stderr);self.assertEqual(second.returncode,0,second.stderr)
        for suffix in ['history.json','report.json']:self.assertEqual((self.root/('folder-'+suffix)).read_bytes(),(self.root/('index-'+suffix)).read_bytes())
    def test_changed_DTO_is_rejected_before_history_promotion(self):
        self.file.write_bytes(self.raw.replace(b'partial',b'changed'));result=self.run_bootstrap(['--source-index',str(self.index)],'bad');self.assertNotEqual(result.returncode,0);self.assertFalse((self.root/'bad-history.json').exists())
    def test_null_bound_reference_is_rejected_instead_of_becoming_missing(self):
        value=json.loads(self.index.read_bytes());value['files']['2026-10-19']=None;self.index.write_text(json.dumps(value));result=self.run_bootstrap(['--source-index',str(self.index)],'null');self.assertNotEqual(result.returncode,0);self.assertFalse((self.root/'null-history.json').exists())
    def test_oversized_source_index_is_rejected_before_parse_or_history_write(self):
        self.index.write_bytes(b' '*(4*1024*1024+1));result=self.run_bootstrap(['--source-index',str(self.index)],'large');self.assertNotEqual(result.returncode,0);self.assertIn(b'Source index byte/type limit',result.stderr);self.assertFalse((self.root/'large-history.json').exists())
