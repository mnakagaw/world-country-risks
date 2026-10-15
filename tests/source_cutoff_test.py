"""Pinned Parquet source test for half-open48h cutoff and no live fallback."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
from hashlib import sha256
import tempfile,unittest,sys,shutil,duckdb
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import export_shared_gdelt as adapter

class Cutoff(unittest.TestCase):
    def test_0300_half_open_window_and_unselected_files_remain_missing(self):
        base=ROOT/'work/source-cutoff-fixtures';base.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as folder:
            root=Path(folder);(root/'config').mkdir();shutil.copyfile(ROOT/'config/r_definitions.json',root/'config/r_definitions.json');producer=root/'producer/engine';producer.mkdir(parents=True);(producer/'gdelt.py').write_text('TRACKING_PARAMETERS=set()\ndef canonical_url(url):return url\n')
            db=duckdb.connect(':memory:');db.execute("CREATE TABLE fixture(GlobalEventID VARCHAR,DATEADDED VARCHAR,source_file_id VARCHAR,ActionGeo_CountryCode VARCHAR,SOURCEURL VARCHAR,EventRootCode VARCHAR,EventCode VARCHAR,AvgTone VARCHAR,Actor1Geo_CountryCode VARCHAR,Actor2Geo_CountryCode VARCHAR,SQLDATE VARCHAR,NumMentions VARCHAR,ingested_at_utc VARCHAR)")
            for n,added in enumerate(['20261013174500','20261013180000','20261013180100']):db.execute('INSERT INTO fixture VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[str(n),added,'20261013174500.export','JA','https://source.invalid/'+str(n),'18','180','-2','JA','','20261013','1','2026-10-14T00:00:00Z'])
            parquet=root/'fixed.parquet';db.execute('COPY fixture TO ? (FORMAT PARQUET)',[str(parquet)]);db.close();cutoff=datetime(2026,10,13,18,tzinfo=timezone.utc);slot=cutoff-timedelta(minutes=15)
            candidates={slot.isoformat():[{'path':str(parquet),'sha256':sha256(parquet.read_bytes()).hexdigest(),'rows_rejected':0,'slot':slot.isoformat(),'source_file_id':'20261013174500.export','source_sha256':'0'*64}]}
            old=adapter.ROOT;adapter.ROOT=root
            try:
                result=adapter.export(root/'archive',cutoff,root/'output.json',producer.parent,candidates=candidates,quiet=True,strict_candidates=True)
                self.assertEqual(result['countries']['JA']['event_count'],1);self.assertEqual(result['coverage']['available_slots'],1);self.assertEqual(result['coverage']['expected_slots'],192);self.assertEqual(result['window']['end_utc'],'2026-10-13T18:00:00Z');self.assertEqual(result['window']['start_utc'],'2026-10-11T18:00:00Z');self.assertEqual(result['source_status'],'partial')
                rows=adapter.artifacts(root/'archive',cutoff-timedelta(hours=48),cutoff,candidates=candidates,strict_candidates=True)
                with patch.object(adapter,'artifacts',side_effect=AssertionError('Already checked rows must not be reacquired')):
                    reused=adapter.export(root/'archive',cutoff,root/'prepared.json',producer.parent,candidates=candidates,quiet=True,strict_candidates=True,artifact_rows=rows)
                self.assertEqual(reused,result)
                self.assertTrue(all(r['status']=='missing' for r in adapter.artifacts(root/'archive',cutoff-timedelta(minutes=15),cutoff,candidates={},strict_candidates=True)))
            finally:adapter.ROOT=old

if __name__=='__main__':unittest.main()
