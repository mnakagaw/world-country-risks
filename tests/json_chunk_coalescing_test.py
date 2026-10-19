"""Bound JSON writes without weakening identity, capacity, or byte checks."""
from pathlib import Path
from hashlib import sha256
from types import SimpleNamespace
from unittest.mock import patch
import io,json,math,sys,tempfile,unittest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import bounded_source_io as proposed
OBSERVATIONS={}

class JsonChunkCoalescing(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='wcr-json-chunk-');self.root=Path(self.tmp.name)
        self.repo=self.root/'repo';self.repo.mkdir();self.external=self.root/'registered-external';self.external.mkdir();self.calls=[]
        def guard(additional):self.calls.append(additional);return self.external
        self.guard=guard;self.free=patch.object(proposed.shutil,'disk_usage',return_value=SimpleNamespace(free=100*proposed.GIB));self.free.start()
    def tearDown(self):self.free.stop();self.tmp.cleanup()
    def source_io(self,guard=None):return proposed.SourceIO(self.repo,{'external_storage':True},external_guard=guard or self.guard)
    def test_exact_UTF8_bytes_including_cross_chunk_unicode_and_escaping(self):
        value={'prefix':'x'*(proposed.JSON_CHUNK-20),'unicode':'🙂日本語ü'*24000,'escape':'\\\n\r\t"','array':[True,None,1.25]}
        expected=(json.dumps(value,ensure_ascii=False)+'\n').encode('utf-8');chunks=list(proposed.json_byte_chunks(value))
        self.assertEqual(b''.join(chunks),expected);self.assertEqual(json.loads(b''.join(chunks)),value)
        self.assertEqual(len(chunks),math.ceil(len(expected)/proposed.JSON_CHUNK));self.assertTrue(all(0<len(p)<=65536 for p in chunks))
        OBSERVATIONS['unicode']={'bytes':len(expected),'chunks':len(chunks),'largest_chunk':max(map(len,chunks)),'byte_identity':True}
    def test_actual_external_guard_calls_are_chunk_count_plus_two(self):
        value=[{'n':n,'label':'日本語🙂','status':'fixture'} for n in range(6000)]
        encoded=(json.dumps(value,ensure_ascii=False)+'\n').encode('utf-8');source=self.source_io();target=source.project/'proposal.json'
        source.atomic_json(target,value)
        self.assertEqual(target.read_bytes(),encoded);self.assertEqual(len(self.calls),math.ceil(len(encoded)/65536)+2)
        original_fragments=sum(1 for p in json.JSONEncoder(ensure_ascii=False).iterencode(value))+1
        OBSERVATIONS['guard_frequency']={'encoded_bytes':len(encoded),'encoder_fragments_before_coalescing':original_fragments,
          'actual_identity_capacity_guard_calls':len(self.calls),'expected_calls':math.ceil(len(encoded)/65536)+2,'chunk_bytes':65536}
    def test_single_oversized_encoder_fragment_is_split(self):
        value='🙂'*200000;chunks=list(proposed.json_byte_chunks(value));expected=(json.dumps(value,ensure_ascii=False)+'\n').encode('utf-8')
        self.assertEqual(b''.join(chunks),expected);self.assertLessEqual(max(map(len,chunks)),65536)
        OBSERVATIONS['oversized_fragment']={'encoded_bytes':len(expected),'chunks':len(chunks),'largest_chunk':max(map(len,chunks))}
    def test_overflow_keeps_original_and_cleans_only_own_pending(self):
        source=self.source_io();target=source.project/'original.json';target.parent.mkdir(parents=True);target.write_bytes(b'original')
        with self.assertRaises(proposed.StorageDeferred):source.atomic_json(target,{'large':'x'*70000},16)
        self.assertEqual(target.read_bytes(),b'original');self.assertEqual(list(target.parent.glob('*.pending')),[]);self.assertEqual(source.cold.pending,0)
    def test_capacity_refusal_happens_before_the_write_chunk(self):
        def refusing(additional):
            result=self.guard(additional)
            if len(self.calls)==3:raise OSError('fixture external capacity refusal before first write chunk')
            return result
        source=self.source_io(refusing);target=source.project/'original.json';target.parent.mkdir(parents=True);target.write_bytes(b'original')
        with self.assertRaises(proposed.StorageDeferred):source.atomic_json(target,{'large':'x'*140000})
        self.assertEqual(len(self.calls),3);self.assertEqual(target.read_bytes(),b'original');self.assertEqual(list(target.parent.glob('*.pending')),[])
    def test_short_writes_preserve_every_byte_and_reservation_count(self):
        class ShortWriter:
            def __init__(self):self.out=io.BytesIO()
            def write(self,view):return self.out.write(view[:3])
        stream=ShortWriter();ledger=proposed.WriteLedger(self.root,1024,20)
        raw=b'exact bytes survive deliberately short writes'
        with ledger.reservation(len(raw)) as write:write(stream,raw)
        self.assertEqual(stream.out.getvalue(),raw);self.assertEqual(ledger.written,len(raw));self.assertEqual(ledger.pending,0)

if __name__=='__main__':unittest.main()
