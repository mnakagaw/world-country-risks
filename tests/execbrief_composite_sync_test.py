"""Known composite acceptance/correction fixtures; no live producer or publication."""
from pathlib import Path
import json,copy,unittest
import execbrief_sync_test as fixture
from execbrief_sync_test import raw,sha
from execbrief_sync import Waiting

class Composite(unittest.TestCase):
    setUp=fixture.Gate.setUp
    tearDown=fixture.Gate.tearDown
    gate=fixture.Gate.gate
    def base(self):
        rows=[{'path':str(self.producer/'content'/folder/(self.day+'.json')),'sha256':sha(self.remote['/data/'+folder+'/'+self.day+'.json'])} for folder in ['daily-editorial','world-stress']]
        authoritative={'authoritative_production_sources':rows};a=self.put(self.work/'authoritative.json',authoritative)
        final={'kind':'independent-overall-semantic-source-acceptance-v2','status':'accepted_content_for_parent_remaining_release_gates','run_date':self.day,'content_check_complete':True,'blocking_errors':[],'unresolved_semantic_findings':[],
            'authoritative_receipt':{'path':str(self.work/'authoritative.json'),'sha256':sha(a)},'authoritative_production_sources':rows,'checked_at_utc':'2026-10-14T20:00:00Z'}
        f=self.put(self.work/'semantic.json',final)
        self.checks={'schema_version':'release-checks-v1','scope':'daily-excluding-live-search','checks':{k:{'returncode':0} for k in ['validate','python_tests','syntax']},'passed':True,'inputs_unchanged':True,'editorial_acceptance_unchanged':True,'editorial_acceptance':None,'execution_kind':'changed-only-composite-v1','snapshot_sha256':'f'*64,
            'composite_acceptance':{'current_snapshot_sha256':'f'*64,'semantic_acceptance':{'path':str(self.work/'semantic.json'),'sha256':sha(f)},'authoritative_production':final['authoritative_receipt']}}
        self.receipt['local_gate']['checks_receipt_sha256']=sha(self.put(self.work/'checks.json',self.checks));self.put(self.work/'publication-receipt.json',self.receipt)
        return final
    def correction(self):
        self.base();before={folder:sha(self.remote['/data/'+folder+'/'+self.day+'.json']) for folder in ['daily-editorial','world-stress']};initial_raw=(self.work/'publication-receipt.json').read_bytes();initial=copy.deepcopy(self.receipt)
        latest=json.loads(self.remote['/data/latest-edition.json'])
        for kind,folder in [('editorial','daily-editorial'),('system_stress','world-stress')]:
            name='/data/'+folder+'/'+self.day+'.json';value=json.loads(self.remote[name]);value['fixture_correction']=True;self.remote[name]=raw(value);latest[kind]['sha256']=sha(self.remote[name])
        self.remote['/data/latest-edition.json']=raw(latest)
        for name,b in self.remote.items():(self.producer/'dist'/name.lstrip('/')).write_bytes(b)
        rows=[{'path':str(self.producer/'content'/folder/(self.day+'.json')),'sha256':sha(self.remote['/data/'+folder+'/'+self.day+'.json'])} for folder in ['daily-editorial','world-stress']]
        a=self.put(self.work/'corrected-authoritative.json',{'authoritative_production_sources':rows})
        self.final={'kind':'independent-semantic-focus-correction-acceptance-v1','status':'accepted_for_corrective_publication','run_date':self.day,'content_check_complete':True,'blocking_errors':[],'unresolved_semantic_findings':[],
            'authoritative_receipt':{'path':str(self.work/'corrected-authoritative.json'),'sha256':sha(a)},'authoritative_production_sources':rows,'checked_at_utc':'2026-10-14T22:00:00Z'}
        after={r['path']:r['sha256'] for r in rows};content_after={'content/'+folder+'/'+self.day+'.json':r['sha256'] for folder,r in zip(['daily-editorial','world-stress'],rows)}
        self.focus={**copy.deepcopy(self.checks),'execution_kind':'same-date-focus-correction-changed-only-v1','snapshot_sha256':'a'*64,'composite_acceptance':{'current_snapshot_sha256':'a'*64,'semantic_acceptance':{'path':str(self.work/'focus-semantic.json'),'sha256':sha(self.put(self.work/'focus-semantic.json',self.final))},'authoritative_production':self.final['authoritative_receipt'],
            'baseline_successful_results_reused':True,'unchanged_source_raw_body_clock_country_assessments_and_stress_values':True,'baseline':{'path':str(self.work/'checks.json'),'sha256':sha((self.work/'checks.json').read_bytes())},
            'before_SHA':{'content/'+folder+'/'+self.day+'.json':checksum for folder,checksum in before.items()},'after_SHA':{**content_after,**{'dist/data/'+folder+'/'+self.day+'.json':r['sha256'] for folder,r in zip(['daily-editorial','world-stress'],rows)},'dist/data/latest-edition.json':sha(self.remote['/data/latest-edition.json'])}}}
        correction={'verified':True,'destination':'https://execbrief.net','release':'corrected','files':{name.lstrip('/'):sha(b) for name,b in self.remote.items()}};selected={'path':str(self.work/'selected-manifest.json'),'sha256':sha(self.put(self.work/'selected-manifest.json',correction))}
        self.effective={**correction,'initial_publication_manifest':{'path':initial['manifest_path'],'sha256':initial['manifest_sha256']},'selected_correction_manifest':selected}
        self.corrected={**{k:v for k,v in initial.items() if k!='local_gate'},'run_date':self.day,'release':'corrected','initial_publication_receipt':{'path':str(self.work/'publication-receipt.json'),'sha256':sha(initial_raw)},'manifest_path':str(self.work/'effective.json'),'manifest_sha256':sha(self.put(self.work/'effective.json',self.effective)),'selected_manifest':selected,'file_count':len(correction['files']),'effective_manifest_file_count':len(self.effective['files'])}
        self.rebind()
    def rebind(self):
        self.focus['composite_acceptance']['semantic_acceptance']['sha256']=sha(self.put(self.work/'focus-semantic.json',self.final))
        self.corrected['checks_receipt']={'path':str(self.work/'focus-checks.json'),'sha256':sha(self.put(self.work/'focus-checks.json',self.focus))}
        self.corrected['manifest_sha256']=sha(self.put(self.work/'effective.json',self.effective))
        self.put(self.work/'publication-receipt-focus-v2.json',self.corrected)
    def test_null_unknown_acceptance_waits_without_attribute_error(self):
        c=json.loads((self.work/'checks.json').read_bytes());c['editorial_acceptance']=None
        self.receipt['local_gate']['checks_receipt_sha256']=sha(self.put(self.work/'checks.json',c));self.put(self.work/'publication-receipt.json',self.receipt)
        with self.assertRaises(Waiting):self.gate()
    def test_composite_original_and_corrective_publication_are_sealed_separately(self):
        self.base();_,old=self.gate();self.correction();folder,new=self.gate()
        self.assertNotEqual(old['bundle_id'],new['bundle_id']);self.assertEqual(new['execbrief_release'],'corrected')
        self.assertEqual(new['accepted_editorial_sha256'],sha(self.remote['/data/daily-editorial/'+self.day+'.json']))
        self.assertTrue((folder/'baseline-acceptance.json').exists());self.assertTrue((folder/'initial-publication-manifest.json').exists())
    def test_malformed_or_unaccepted_semantic_fields_wait(self):
        for change in [lambda f:f.update(status='unknown'),lambda f:f.update(run_date='2026-10-16'),lambda f:f.update(content_check_complete=False),lambda f:f.update(blocking_errors=['pending']),lambda f:f.pop('unresolved_semantic_findings')]:
            self.correction();change(self.final);self.rebind()
            with self.assertRaises(Waiting):self.gate()
    def test_wrong_authoritative_bytes_or_baseline_hash_waits(self):
        self.correction();(self.work/'corrected-authoritative.json').write_bytes(b'{}')
        with self.assertRaises(Waiting):self.gate()
        self.correction();self.focus['composite_acceptance']['baseline']['sha256']='0'*64;self.rebind()
        with self.assertRaises(Waiting):self.gate()
    def test_source_path_or_before_after_substitution_waits(self):
        self.correction();self.focus['composite_acceptance']['before_SHA']['content/daily-editorial/'+self.day+'.json']='0'*64;self.rebind()
        with self.assertRaises(Waiting):self.gate()
        self.correction();self.final['authoritative_production_sources'][0]['path']=str(self.producer/'other.json');self.rebind()
        with self.assertRaises(Waiting):self.gate()
    def test_forged_effective_union_or_initial_receipt_waits(self):
        self.correction();self.effective['files']['unverified.json']='0'*64;self.rebind()
        with self.assertRaises(Waiting):self.gate()
        self.correction();self.corrected['initial_publication_receipt']['sha256']='0'*64;self.rebind()
        with self.assertRaises(Waiting):self.gate()
    def test_multiple_receipts_for_same_pointer_are_ambiguous(self):
        self.correction();self.put(self.work/'publication-receipt-other.json',self.corrected)
        with self.assertRaisesRegex(Waiting,'ambiguous'):self.gate()
    def test_current_pointer_has_no_accepted_match_keeps_previous(self):
        self.correction();self.remote['/data/latest-edition.json']+=b' '
        with self.assertRaises(Waiting):self.gate()
        self.assertFalse((self.root/'frozen').exists())
    def test_selected_receipt_changed_during_read_is_rejected(self):
        self.correction();count=0
        def fetch(name):
            nonlocal count
            if name=='/data/latest-edition.json':
                count+=1
                if count==2:
                    p=self.work/'publication-receipt-focus-v2.json';p.write_bytes(p.read_bytes()+b' ')
            return self.remote[name]
        with self.assertRaisesRegex(Waiting,'epoch_changed'):self.gate(fetch)
    def test_null_nested_controls_wait_instead_of_raising_type_errors(self):
        self.correction();self.focus['checks']=None;self.rebind()
        with self.assertRaises(Waiting):self.gate()
        self.correction();self.corrected['checks_receipt']['sha256']=None;self.put(self.work/'publication-receipt-focus-v2.json',self.corrected)
        with self.assertRaises(Waiting):self.gate()
        self.correction();self.final['authoritative_production_sources'][0]['sha256']=None
        a={'authoritative_production_sources':self.final['authoritative_production_sources']};ref={'path':str(self.work/'corrected-authoritative.json'),'sha256':sha(self.put(self.work/'corrected-authoritative.json',a))}
        self.final['authoritative_receipt']=ref;self.focus['composite_acceptance']['authoritative_production']=ref;self.rebind()
        with self.assertRaises(Waiting):self.gate()

if __name__=='__main__':unittest.main()
