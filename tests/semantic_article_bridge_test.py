"""Accepted-body/cache integration check; no collection or model invocation."""
from pathlib import Path
import unittest,json,sys,tempfile,copy
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import semantic_article_bridge as bridge

class ReviewedBodyCache(unittest.TestCase):
    @unittest.skipUnless((ROOT/'.local/accepted-impacts/impacts.json').exists(),'Private accepted-body integration inputs unavailable')
    def test_changed_acceptance_metadata_cannot_reuse_curated_claims(self):
        policy=json.loads((ROOT/'.local/controller.json').read_bytes())
        records=json.loads((ROOT/'.local/accepted-impacts/impacts.json').read_bytes())
        scratch=ROOT/'work/semantic-cache-check';scratch.mkdir(parents=True,exist_ok=True)
        old_root=bridge.ROOT
        try:
            with tempfile.TemporaryDirectory(dir=scratch) as folder:
                bridge.ROOT=Path(folder);namespace=ROOT/'.local/accepted-impacts/verification'
                first=bridge.export(policy,records,Path(folder)/'first.json',namespace)
                repeat=bridge.export(policy,records,Path(folder)/'repeat.json',namespace)
                self.assertEqual(first,repeat);self.assertEqual(len(first['articles']),5)
                changed=copy.deepcopy(records)
                for r in changed:r['verification']['accepted_artifact_sha256']='0'*64
                unknown=bridge.export(policy,changed,Path(folder)/'changed.json',namespace)
                for a,b in zip(first['articles'],unknown['articles']):
                    self.assertEqual(a['body_sha256'],b['body_sha256'])
                    self.assertNotEqual(a['cache_key'],b['cache_key'])
                    self.assertTrue(all(c['r'] is None and c['direction']=='unknown' for c in b['r_claims']))
                self.assertEqual(unknown['new_ai_calls'],0)
        finally:bridge.ROOT=old_root

if __name__=='__main__':unittest.main()
