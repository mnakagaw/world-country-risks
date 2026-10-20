"""New reviewed resolver proofs, with legacy7-key acceptance kept independently."""
from pathlib import Path
from hashlib import sha256
import json,copy,unittest
import source_supplement_test as fixture
import source_supplement_gate as gate
from source_revision_test import save
from source_revision_queue import InvalidRequest

class Corrective(fixture.ContractFixture,unittest.TestCase):
    def test_old_and_new_reviewed_resolver_pairs_remain_independently_accepted(self):
        for resolver in ['d14d72d26fbb723257b3c8931521075377c1ccbf40e2db3d0160817fe6f73a39','8db5952c8096f1232ac4cf5155968212d2aa5b8d80996e36124341916e8bd873']:
            self.resolver=resolver;self.emit();_,binding=self.freeze();self.assertEqual(binding['source_revision']['parent_resolver_sha256'],resolver)
    def test_two_allowed_resolvers_cannot_be_mixed_between_checks_and_acceptance(self):
        self.resolver='8db5952c8096f1232ac4cf5155968212d2aa5b8d80996e36124341916e8bd873';self.emit();checks=json.loads((self.folder/'checks.json').read_bytes());checks['parent_resolver_sha256']='d14d72d26fbb723257b3c8931521075377c1ccbf40e2db3d0160817fe6f73a39';save(self.folder/'checks.json',checks);self.acceptance['checks']=fixture.ref(self.folder/'checks.json');self.accept_change()
        with self.assertRaisesRegex(InvalidRequest,'unreviewed_checks_parent_resolver'):self.freeze()
    def setUp(self):
        super().setUp();self.validator='b322d054f45e7d638e4d3085340d25f819055425f089c4f17ae04188d4fd0221';self.resolver='d14d72d26fbb723257b3c8931521075377c1ccbf40e2db3d0160817fe6f73a39'
        self.blobs={p.name:p.read_bytes() for p in self.original.iterdir() if p.name!='manifest.json'}
        self.blobs['system_stress.json']=gate.canonical({'date':self.day});self.blobs['latest-edition.json']=gate.canonical({'date':self.day,'fixture':True})
        self.files={'data/daily-editorial/'+self.day+'.json':self.binding['accepted_editorial_sha256'],'data/world-stress/'+self.day+'.json':sha256(self.blobs['system_stress.json']).hexdigest(),'data/latest-edition.json':sha256(self.blobs['latest-edition.json']).hexdigest()}
        self.blobs['publication-manifest.json']=gate.canonical({'verified':True,'files':self.files})
        def proof(label,name,value):
            p=self.producer/'.daily-work/parent'/name;save(p,value);self.parents[label]=fixture.ref(p);return self.parents[label]
        auth=proof('authoritative_production','authoritative.json',{'fixture':True});self.blobs['authoritative-production.json']=Path(auth['path']).read_bytes()
        normal=proof('normal_acceptance','normal.json',{'run_date':self.day,'status':'complete','pending':[]})
        semantic={'authoritative_receipt':auth,'normal_final_gate':normal};sem=proof('editorial_acceptance','acceptance.json',semantic);self.blobs['acceptance.json']=Path(sem['path']).read_bytes();self.binding['acceptance_receipt_sha256']=sem['sha256']
        checks={'composite_acceptance':{'authoritative_production':auth,'semantic_acceptance':sem,'normal_gate':normal}};check=proof('release_checks','checks-receipt.json',checks);self.blobs['checks-receipt.json']=Path(check['path']).read_bytes()
        inventory=proof('effective_public_inventory','inventory.json',{'verified':True,'release':'fixture-release','files':self.files})
        https=proof('https_publication','https.json',{'verified':True,'run_date':self.day,'release':'fixture-release','public_artifact_sha256':self.binding['accepted_editorial_sha256'],'public_stress_sha256':self.files['data/world-stress/'+self.day+'.json']})
        self.context={'kind':'same-date-corrective-publication-context-v2','verified':True,'run_date':self.day,'release':'fixture-release','public_artifact_sha256':self.binding['accepted_editorial_sha256'],'public_stress_sha256':https and self.files['data/world-stress/'+self.day+'.json'],
            'bindings':{'publication':self.parents['publication_receipt'],'release_checks':check,'semantic':sem,'authoritative':auth,'public_inventory':inventory,'https':https,'normal_gate':normal}}
        proof('accepted_publication_context','context.json',self.context)
        for name,raw in self.blobs.items():(self.original/name).write_bytes(raw)
        save(self.original/'manifest.json',{'binding':self.binding,'files':{name:sha256(raw).hexdigest() for name,raw in self.blobs.items()}})
        public=self.root/'public/data/v2';value=json.loads((public/(self.parent+'.json')).read_bytes());value['upstream_sync']=self.binding;self.parent_sha=save(public/(self.parent+'.json'),value);save(public/'latest.json',value);save(public/'manifest.json',{self.day:{'snapshot_id':self.parent,'path':self.parent+'.json','sha256':self.parent_sha}});self.request['parent']['snapshot_sha256']=self.parent_sha
        self.catalog['parents']=self.parents;self.emit()
    def emit(self):
        self.publish_contract();checks=json.loads((self.folder/'checks.json').read_bytes());checks['parent_resolver_sha256']=self.resolver;save(self.folder/'checks.json',checks);self.acceptance.update(parent_resolver_sha256=self.resolver,checks=fixture.ref(self.folder/'checks.json'));self.accept_change()
    def update_proof(self,label,value):
        p=Path(self.parents[label]['path']);save(p,value);self.parents[label]=fixture.ref(p);self.emit()
    def test_reviewed12_proofs_preserve_original_bundle_and_bind_resolver(self):
        before={p.name:p.read_bytes() for p in self.original.iterdir()};folder,binding=self.freeze();self.assertEqual(binding['source_revision']['parent_resolver_sha256'],self.resolver)
        self.assertEqual(len(list(folder.glob('source-revision-parent-*.json'))),5);self.assertEqual(before,{p.name:p.read_bytes() for p in self.original.iterdir()})
    def test_both_acceptance_and_checks_require_exact_reviewed_resolver(self):
        for value in [None,'0'*64,'not-a-hash']:
            self.emit();self.acceptance['parent_resolver_sha256']=value;self.accept_change()
            with self.assertRaises(InvalidRequest):self.freeze()
            self.emit();checks=json.loads((self.folder/'checks.json').read_bytes());checks['parent_resolver_sha256']=value;save(self.folder/'checks.json',checks);self.acceptance['checks']=fixture.ref(self.folder/'checks.json');self.accept_change()
            with self.assertRaises(InvalidRequest):self.freeze()
        self.emit();self.acceptance.pop('parent_resolver_sha256');self.accept_change()
        with self.assertRaises(InvalidRequest):self.freeze()
    def test_old_validator_cannot_adopt12_or_new_validator_downgrade_to7(self):
        self.validator=gate.LEGACY_VALIDATOR;self.emit()
        with self.assertRaises(InvalidRequest):self.freeze()
        self.validator='b322d054f45e7d638e4d3085340d25f819055425f089c4f17ae04188d4fd0221'
        for name in ['accepted_publication_context','authoritative_production','effective_public_inventory','https_publication','normal_acceptance']:self.catalog['parents'].pop(name)
        self.emit()
        with self.assertRaises(InvalidRequest):self.freeze()
    def test_unknown_extra_key_or_missing_extra_proof_is_rejected(self):
        self.catalog['parents']['unknown']=self.parents['normal_acceptance'];self.emit()
        with self.assertRaises(InvalidRequest):self.freeze()
        self.catalog['parents'].pop('unknown');self.catalog['parents'].pop('https_publication');self.emit()
        with self.assertRaises(InvalidRequest):self.freeze()
    def test_context_must_match_frozen_parent_and_every_cross_reference(self):
        for field,value in [('run_date','2026-10-01'),('public_artifact_sha256','e'*64),('release','other')]:
            bad=copy.deepcopy(self.context);bad[field]=value;self.update_proof('accepted_publication_context',bad)
            with self.assertRaises(InvalidRequest):self.freeze()
        bad=copy.deepcopy(self.context);bad['bindings']['semantic']={**bad['bindings']['semantic'],'sha256':'e'*64};self.update_proof('accepted_publication_context',bad)
        with self.assertRaises(InvalidRequest):self.freeze()
    def test_inventory_cannot_add_unverified_bytes_even_with_rebound_control_SHA(self):
        inv=json.loads(Path(self.parents['effective_public_inventory']['path']).read_bytes());inv['files']['extra.json']='f'*64;self.update_proof('effective_public_inventory',inv)
        with self.assertRaises(InvalidRequest):self.freeze()
    def test_https_normal_and_authoritative_proofs_cannot_drift(self):
        for name,key,value in [('https_publication','public_stress_sha256','0'*64),('normal_acceptance','pending',['unfinished']),('authoritative_production','fixture',False)]:
            old=Path(self.parents[name]['path']).read_bytes();obj=json.loads(old);obj[key]=value;self.update_proof(name,obj)
            with self.assertRaises(InvalidRequest):self.freeze()
            Path(self.parents[name]['path']).write_bytes(old);self.parents[name]=fixture.ref(Path(self.parents[name]['path']));self.emit()

class Normal7(fixture.ContractFixture,unittest.TestCase):
    def test_explicit_normal7_accepts_the_new_reviewed_reader_without_replacing_old(self):
        self.resolver='8db5952c8096f1232ac4cf5155968212d2aa5b8d80996e36124341916e8bd873';self.normal();_,binding=self.freeze();self.assertEqual(binding['source_revision']['parent_resolver_sha256'],self.resolver)
    def setUp(self):
        super().setUp();self.validator='b322d054f45e7d638e4d3085340d25f819055425f089c4f17ae04188d4fd0221';self.resolver='d14d72d26fbb723257b3c8931521075377c1ccbf40e2db3d0160817fe6f73a39';self.base_blobs={p.name:p.read_bytes() for p in self.original.iterdir() if p.name!='manifest.json'};self.normal()
    def normal(self,change_checks=None,change_final=None,change_publication=None):
        blobs=dict(self.base_blobs);blobs['system_stress.json']=gate.canonical({'date':self.day});blobs['latest-edition.json']=gate.canonical({'date':self.day,'fixture':True})
        final={'run_date':self.day,'content_check_complete':True,'unapplied_findings':0,'accepted_final_editorial_snapshot':{'sha256':self.binding['accepted_editorial_sha256']}}
        if change_final:change_final(final)
        fp=Path(self.parents['editorial_acceptance']['path']);save(fp,final);self.parents['editorial_acceptance']=fixture.ref(fp);blobs['acceptance.json']=fp.read_bytes()
        checks={'schema_version':'release-checks-v1','scope':'daily-excluding-live-search','passed':True,'inputs_unchanged':True,'editorial_acceptance_unchanged':True,'checks':{k:{'returncode':0} for k in ['validate','python_tests','syntax']},
            'editorial_acceptance':{'run_date':self.day,'edition_sha256':self.binding['accepted_editorial_sha256'],'final_receipt':str(fp),'final_receipt_sha256':self.parents['editorial_acceptance']['sha256']}}
        if change_checks:change_checks(checks)
        cp=Path(self.parents['release_checks']['path']);save(cp,checks);self.parents['release_checks']=fixture.ref(cp);blobs['checks-receipt.json']=cp.read_bytes()
        pub={'verified':True,'exit_code':0,'run_date':self.day,'release':'fixture-release','public_artifact_sha256':self.binding['accepted_editorial_sha256'],'local_gate':{'checks_receipt':str(cp),'checks_receipt_sha256':self.parents['release_checks']['sha256']}}
        if change_publication:change_publication(pub)
        pp=Path(self.parents['publication_receipt']['path']);save(pp,pub);self.parents['publication_receipt']=fixture.ref(pp);blobs['publication-receipt.json']=pp.read_bytes()
        self.binding.update(publication_receipt_sha256=self.parents['publication_receipt']['sha256'],acceptance_receipt_sha256=self.parents['editorial_acceptance']['sha256'])
        files={'data/daily-editorial/'+self.day+'.json':self.binding['accepted_editorial_sha256'],'data/world-stress/'+self.day+'.json':sha256(blobs['system_stress.json']).hexdigest(),'data/latest-edition.json':sha256(blobs['latest-edition.json']).hexdigest()};blobs['publication-manifest.json']=gate.canonical({'verified':True,'destination':'https://execbrief.net','release':'fixture-release','files':files})
        for name,raw in blobs.items():(self.original/name).write_bytes(raw)
        save(self.original/'manifest.json',{'binding':self.binding,'files':{n:sha256(raw).hexdigest() for n,raw in blobs.items()}})
        public=self.root/'public/data/v2';value=json.loads((public/(self.parent+'.json')).read_bytes());value['upstream_sync']=self.binding;checksum=save(public/(self.parent+'.json'),value);save(public/'latest.json',value);save(public/'manifest.json',{self.day:{'snapshot_id':self.parent,'path':self.parent+'.json','sha256':checksum}});self.request['parent'].update(snapshot_sha256=checksum,publication_receipt_sha256=self.binding['publication_receipt_sha256']);self.catalog['parents']=copy.deepcopy(self.parents)
        self.publish_contract();checks=json.loads((self.folder/'checks.json').read_bytes());checks['parent_resolver_sha256']=self.resolver;save(self.folder/'checks.json',checks);self.acceptance.update(parent_resolver_sha256=self.resolver,checks=fixture.ref(self.folder/'checks.json'));self.accept_change()
    def test_new_reviewed_pair_supports_explicit_normal7_without_context(self):
        folder,binding=self.freeze();self.assertEqual(len(self.catalog['parents']),7);self.assertEqual(binding['source_revision']['parent_resolver_sha256'],self.resolver);self.assertEqual(len(list(folder.glob('source-revision-parent-*.json'))),0)
    def test_null_acceptance_failed_checks_and_wrong_source_snapshot_wait_closed(self):
        for change in [lambda c:c.update(editorial_acceptance=None),lambda c:c['checks']['validate'].update(returncode=1),lambda c:c['editorial_acceptance'].update(edition_sha256='0'*64)]:
            self.normal(change_checks=change)
            with self.assertRaises(InvalidRequest):self.freeze()
        self.normal(change_final=lambda f:f['accepted_final_editorial_snapshot'].update(sha256='0'*64))
        with self.assertRaises(InvalidRequest):self.freeze()
    def test_normal7_cannot_omit_local_gate_or_resolver_pin(self):
        self.normal(change_publication=lambda p:p.pop('local_gate'))
        with self.assertRaises(InvalidRequest):self.freeze()
        self.normal();self.acceptance.pop('parent_resolver_sha256');self.accept_change()
        with self.assertRaises(InvalidRequest):self.freeze()

if __name__=='__main__':unittest.main()
