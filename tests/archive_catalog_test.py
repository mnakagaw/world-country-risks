from pathlib import Path
from datetime import datetime,timezone,timedelta
from hashlib import sha256
import json,sys,tempfile,unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from archive_catalog import catalog
from export_shared_gdelt import artifacts,ROOT
import export_shared_gdelt as adapter

class ArchiveBinding(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='wcr-archive-catalog-')
        self.private=Path(self.temp.name);self.guard=patch.object(adapter,'ROOT',self.private/'private');self.guard.start()
    def tearDown(self):self.guard.stop();self.temp.cleanup()
    def test_acquisition_day_batch_window_epoch_and_actual_missing(self):
        base=self.private/'archive-fixtures';base.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as folder:
            root=Path(folder);start=datetime(2026,10,1,0,tzinfo=timezone.utc);end=start+timedelta(minutes=30)
            bulkpath=root/'manifests/2026-10-15/20261001T000000Z_20261001T030000Z/gdelt-bulk-manifest.json';bulkpath.parent.mkdir(parents=True)
            normalized=root/'normalized/a.parquet';normalized.parent.mkdir();normalized.write_bytes(b'bound parquet fixture')
            bulk={'dataset_hash':'a'*64,'files':[{'file_id':'20261001000000.export','status':'downloaded','sha256':'c'*64}]};raw=json.dumps(bulk).encode();bulkpath.write_bytes(raw)
            indexpath=root/'indexes'/('index-v2-'+('a'*16)+'.json');indexpath.parent.mkdir()
            index={'bulk_manifest_sha256':sha256(raw).hexdigest(),'files':[{'source_file_id':'20261001000000.export','status':'available','parquet_path':str(normalized),'parquet_sha256':sha256(normalized.read_bytes()).hexdigest(),'rows_rejected':0}]};indexpath.write_text(json.dumps(index))
            candidates,errors=catalog(root,start,end);self.assertFalse(errors);self.assertEqual(len(candidates),1)
            # Out-of-window and non-timestamp directory names must not cause
            # manifest probes; a selected empty window remains explicitly missing.
            old=root/'manifests/historical-year/20200101T000000Z_20200102T000000Z';old.mkdir(parents=True)
            (old/'gdelt-bulk-manifest.json').write_bytes(b'not JSON; outside the selected interval')
            empty=root/'manifests/acquired-later/20261001T001500Z_20261001T003000Z';empty.mkdir(parents=True)
            candidates,errors=catalog(root,start,end);self.assertEqual(len(candidates),1);self.assertEqual(len(errors),1);self.assertEqual(errors[0]['reason'],'FileNotFoundError')
            values=artifacts(root,start,end,candidates=candidates);self.assertEqual(values[0]['status'],'available');self.assertEqual(values[1]['status'],'missing');self.assertEqual(values[1]['reason'],'bulk_manifest_missing')
            normalized.write_bytes(b'changed');values=artifacts(root,start,end,candidates=candidates);self.assertEqual(values[0]['reason'],'candidate_hash_or_read_failure')
            index['bulk_manifest_sha256']='f'*64;indexpath.write_text(json.dumps(index));candidates,errors=catalog(root,start,end);self.assertFalse(candidates);self.assertEqual(errors[0]['reason'],'index_epoch_mismatch')

if __name__=='__main__':unittest.main()
