"""Resume owned NAS pending writes without replacing immutable final evidence."""
import unittest,tempfile,sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import handoff_v2

class AtomicHandoff(unittest.TestCase):
    def test_verified_pending_is_renamed_without_rewriting_it(self):
        with tempfile.TemporaryDirectory(prefix='wcr-nas-pending-') as temp:
            folder=Path(temp);pending=folder/'history.private.pending';pending.write_bytes(b'fixed source history')
            with patch.object(Path,'write_bytes',side_effect=AssertionError('must reuse complete pending')):handoff_v2.store(folder,'history.private.json',b'fixed source history')
            self.assertEqual((folder/'history.private.json').read_bytes(),b'fixed source history');self.assertFalse(pending.exists())
    def test_incomplete_pending_is_repaired_in_chunks_and_final_remains_immutable(self):
        with tempfile.TemporaryDirectory(prefix='wcr-nas-pending-') as temp:
            folder=Path(temp);(folder/'history.private.pending').write_bytes(b'partial');body=b'original bytes-'*200000+b'tail'
            handoff_v2.store(folder,'history.private.json',body);self.assertEqual((folder/'history.private.json').read_bytes(),body)
            with self.assertRaises(ValueError):handoff_v2.store(folder,'history.private.json',b'different original')
            self.assertEqual((folder/'history.private.json').read_bytes(),body)
    def test_unknown_rename_outcome_is_verified_before_retry(self):
        with tempfile.TemporaryDirectory(prefix='wcr-nas-pending-') as temp:
            folder=Path(temp);original=handoff_v2.os.replace
            def renamed_then_disconnected(source,target):original(source,target);raise OSError('simulated acknowledgement loss')
            with patch.object(handoff_v2.os,'replace',side_effect=renamed_then_disconnected):handoff_v2.store(folder,'snapshot.json',b'fixed snapshot')
            self.assertEqual((folder/'snapshot.json').read_bytes(),b'fixed snapshot')

if __name__=='__main__':unittest.main()
