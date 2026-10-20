"""OSError evidence is bounded and leaves the existing queue/resume contract intact."""
import io,json,unittest
from contextlib import redirect_stderr
from datetime import timedelta
from unittest.mock import patch
import source_revision_test as fixture
import source_revision_adapter as adapter
import source_revision_queue as queue

class OSErrorDiagnostic(fixture.Fixture,unittest.TestCase):
    def test_path_errno_and_stack_survive_without_changing_backoff_or_acceptance(self):
        path=str(self.root/'source-file.json')
        def failure(*unused):raise OSError(22,'Invalid argument',path)
        stream=io.StringIO()
        with redirect_stderr(stream):result=self.run_request(failure)
        record=json.loads(stream.getvalue());self.assertEqual(record['filename'],path);self.assertEqual(record['errno'],22);self.assertEqual(record['trace'][-1]['function'],'failure');self.assertNotIn('locals',record)
        self.assertEqual(result['status'],'pending');self.assertEqual(result['wait_reason'],'OSError');self.assertFalse(result['source_accepted']);self.assertEqual(self.original,(self.root/'public/data/v2/manifest.json').read_bytes())
        state=queue.control(queue.queue_root(self.root)/self.request['id']/'state.json')[1];self.assertEqual(state['attempts'],1);self.assertEqual(state['retry_after'],(self.now+timedelta(seconds=900)).isoformat());self.assertEqual(queue.control(queue.queue_root(self.root)/self.request['id']/'request.json')[1]['expires_at_utc'],self.request['expires_at_utc'])
    def test_capacity_refusal_without_errno_keeps_its_message(self):
        stream=io.StringIO()
        with redirect_stderr(stream):adapter.report_oserror(OSError('C source-work headroom deferred'))
        record=json.loads(stream.getvalue());self.assertIsNone(record['errno']);self.assertEqual(record['message'],'C source-work headroom deferred')
    def test_large_unicode_fields_still_form_valid_bounded_JSON(self):
        stream=io.StringIO()
        with redirect_stderr(stream):adapter.report_oserror(OSError(22,'失敗'*20000,'原本'*20000))
        raw=stream.getvalue();self.assertLessEqual(len(raw.encode('utf-8')),16384);record=json.loads(raw);self.assertEqual(record['errno'],22);self.assertTrue(record['truncated'])
    def test_stderr_failure_cannot_break_the_existing_state_transition(self):
        class Unwritable:
            def write(self,*a):raise OSError('fixture diagnostic sink unavailable')
        def failure(*a):raise OSError(22,'Invalid argument','fixture.json')
        with patch.object(adapter.sys,'stderr',Unwritable()):result=self.run_request(failure)
        self.assertEqual(result['status'],'pending');self.assertEqual(result['wait_reason'],'OSError')
    def test_completed_candidate_shortcut_never_reenters_source_or_publication(self):
        proof=self.proof(self.policy,self.request);ref=self.register();before=self.calls
        import source_revision_cycle
        with patch.object(source_revision_cycle,'recover',return_value=proof),patch.object(adapter,'source_receipt_bytes',side_effect=AssertionError('must resume verified completion before source entry')):
            result=adapter.execute(self.root,self.policy,ref['id'],ref['request_sha256'],self.now,adapter.consume_revision)
        self.assertEqual(result['status'],'completed');self.assertTrue(result['recovered_completion']);self.assertEqual(self.calls,before)
