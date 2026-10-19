"""Daily deploy inputs stay bounded and byte-identical without full public copies."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json,unittest,os
import source_revision_cycle as cycle

class ThinBuild(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.public=self.root/'public';self.external=self.root/'external'
        self.dist=self.external/'world-country-risks/daily/fixture/dist'
        self.guard=patch.object(cycle,'external_root',return_value=self.external);self.guard.start();self.addCleanup(self.guard.stop)
    def put(self,base,name,raw=b'fixture'):
        p=base/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);return p
    def test_exact_daily_allowlist_keeps_old_revisions_and_compiled_index(self):
        wanted=['assets/public.svg','country-interest/index.html','country-interest/sub/part.js','country-interest.js','country-interest.css','geo/countries.overview.geojson','geo/countries.overview.metadata.json','data/v2/original.json','data/v2/revision1.json','data/v2/latest.json','data/v2/manifest.json']
        for name in wanted:self.put(self.public,name,name.encode())
        for name in ['data/history/weekly_5y/releases/unused.json','data/old-huge.json','index.html','unrelated.txt']:self.put(self.public,name,b'not a daily input')
        self.put(self.dist,'index.html',b'compiled client index');self.put(self.dist,'assets/client.js',b'compiled')
        before={p.relative_to(self.public):p.read_bytes() for p in self.public.rglob('*') if p.is_file()}
        row=cycle.stage_daily_public(self.public,self.dist)
        self.assertEqual(set(row['files']),set(wanted));self.assertEqual((self.dist/'index.html').read_bytes(),b'compiled client index')
        self.assertFalse((self.dist/'data/history').exists());self.assertEqual(before,{p.relative_to(self.public):p.read_bytes() for p in self.public.rglob('*') if p.is_file()})
        for name in wanted:self.assertEqual((self.dist/name).read_bytes(),(self.public/name).read_bytes())
    def test_asset_collision_refuses_before_public_writes(self):
        self.put(self.public,'assets/client.js',b'conflict');self.put(self.public,'data/v2/latest.json')
        self.put(self.dist,'assets/client.js',b'compiled')
        with self.assertRaisesRegex(ValueError,'compiled_asset_collision'):cycle.stage_daily_public(self.public,self.dist)
        self.assertFalse((self.dist/'data/v2').exists());self.assertEqual((self.dist/'assets/client.js').read_bytes(),b'compiled')
    def test_retry_resets_static_then_allows_generated_overlay(self):
        self.put(self.public,'data/v2/latest.json',b'original');self.put(self.dist,'data/v2/latest.json',b'prior overlay')
        cycle.stage_daily_public(self.public,self.dist);self.assertEqual((self.dist/'data/v2/latest.json').read_bytes(),b'original')
        cycle.replace(self.dist/'data/v2/latest.json',b'new generated',64*cycle.MIB)
        self.assertEqual((self.public/'data/v2/latest.json').read_bytes(),b'original')
    def test_oversized_input_defers_before_read_or_output(self):
        p=self.put(self.public,'data/v2/large.json');p.write_bytes(b'large')
        with patch.object(cycle,'MIB',0),self.assertRaisesRegex(ValueError,'public_size_limit'):cycle.stage_daily_public(self.public,self.dist)
        self.assertFalse(self.dist.exists())
    def test_capacity_deferral_has_no_C_fallback(self):
        p=self.put(self.public,'data/v2/latest.json',b'original')
        with patch.object(cycle,'external_root',side_effect=OSError('external capacity deferred')),self.assertRaises(OSError):cycle.stage_daily_public(self.public,self.dist)
        self.assertFalse(self.dist.exists());self.assertEqual(p.read_bytes(),b'original')
    def test_destination_outside_external_rejected(self):
        self.put(self.public,'data/v2/latest.json')
        with self.assertRaisesRegex(ValueError,'dist_outside_external'):cycle.stage_daily_public(self.public,self.root/'C-dist')
        self.assertFalse((self.root/'C-dist').exists())
    def test_source_link_cannot_copy_outside_public(self):
        self.put(self.public,'data/v2/latest.json');outside=self.put(self.root,'outside.json')
        try:os.symlink(outside,self.public/'data/v2/link.json')
        except OSError as e:self.skipTest(str(e))
        with self.assertRaisesRegex(ValueError,'path_escape|reparse_point'):cycle.stage_daily_public(self.public,self.dist)
    def test_windows_reparse_attribute_is_rejected_without_following(self):
        from types import SimpleNamespace
        p=self.put(self.public,'data/v2/latest.json');real=Path.lstat
        def flagged(path,*args,**kwargs):
            result=real(path,*args,**kwargs)
            return SimpleNamespace(st_mode=result.st_mode,st_file_attributes=1024) if path==p else result
        with patch.object(Path,'lstat',flagged),self.assertRaisesRegex(ValueError,'reparse_point'):cycle.stage_daily_public(self.public,self.dist)
        self.assertFalse(self.dist.exists())
    def test_reparse_public_root_or_dist_ancestor_rejected_before_resolve(self):
        from types import SimpleNamespace
        self.put(self.public,'data/v2/latest.json');self.dist.mkdir(parents=True)
        real_lstat=Path.lstat;real_resolve=Path.resolve
        for flagged_path in [self.public,self.dist,self.dist.parent]:
            resolved=[]
            def flagged(path,*args,**kwargs):
                result=real_lstat(path,*args,**kwargs)
                return SimpleNamespace(st_mode=result.st_mode,st_file_attributes=1024) if path==flagged_path else result
            def resolve(path,*args,**kwargs):
                resolved.append(path);return real_resolve(path,*args,**kwargs)
            with patch.object(Path,'lstat',flagged),patch.object(Path,'resolve',resolve),self.assertRaisesRegex(ValueError,'reparse_point'):
                cycle.stage_daily_public(self.public,self.dist)
            self.assertFalse(any(p==flagged_path or p.is_relative_to(flagged_path) for p in resolved))
    def test_file_limit_stops_enumeration_immediately(self):
        folder=self.public/'assets';folder.mkdir(parents=True);visited=[]
        def names():
            for i in range(4097):visited.append(i);yield str(i)+'.svg'
            raise AssertionError('enumerated beyond bound')
        with patch.object(cycle.os,'walk',return_value=[(str(folder),[],names())]),self.assertRaisesRegex(ValueError,'file_count_limit'):
            cycle.daily_public_files(self.public)
        self.assertEqual(len(visited),4097)
    def test_changed_source_after_preflight_is_rejected(self):
        p=self.put(self.public,'data/v2/latest.json',b'original');real=cycle.artifact;calls=0
        def changed(path,limit):
            nonlocal calls
            calls+=1
            if calls==2:p.write_bytes(b'modified')
            return real(path,limit)
        with patch.object(cycle,'artifact',side_effect=changed),self.assertRaisesRegex(ValueError,'changed_during_copy'):cycle.stage_daily_public(self.public,self.dist)
        self.assertFalse((self.dist/'data/v2/latest.json').exists())

if __name__=='__main__':unittest.main()
