"""Native completion must include queued recovery without rolling back today."""
import unittest,tempfile,json,sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import periodic_adapter as adapter

class Completion(unittest.TestCase):
    def test_incomplete_history_keeps_retry_and_complete_history_disables_queue(self):
        for recovered in [False,True]:
            with self.subTest(recovered=recovered),tempfile.TemporaryDirectory(prefix='wcr-native-result-') as temp:
                root=Path(temp);queue=root/'.local/history-recovery.json';queue.parent.mkdir();queue.write_text(json.dumps({'enabled':True,'editions':[{'date':'2026-10-16'}]}));result=root/'result.json'
                reports=[{'status':'verified','date':'2026-10-19'},{'status':'verified' if recovered else 'retry_sync_stage','date':'2026-10-16'}]
                with patch.object(adapter,'ROOT',root),patch.object(adapter,'cycle',side_effect=reports) as run,patch.object(sys,'argv',['fixture','--result',str(result)]):adapter.main()
                value=json.loads(result.read_bytes());self.assertEqual(run.call_count,2);self.assertEqual(value['source_receipt']['status'],'verified');self.assertEqual(value['status'],'completed' if recovered else 'retry_sync_stage');self.assertEqual(json.loads(queue.read_bytes())['enabled'],not recovered)

if __name__=='__main__':unittest.main()
