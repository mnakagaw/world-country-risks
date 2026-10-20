"""Formal producer-contract fixtures only. No real capture, queue or publication."""
from pathlib import Path
from datetime import timedelta,datetime,timezone
from hashlib import sha256
from unittest.mock import patch
import copy,json,sys,tempfile,unittest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from source_revision_test import save
import source_supplement_gate as gate
from execbrief_sync import canonical,selected_raw_sources,select_current_candidates,closed_edition
from source_revision_queue import InvalidRequest

def ref(path):return {'path':str(path),'sha256':sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}

class ContractFixture:
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='wcr-s-');self.root=Path(self.temp.name);self.now=datetime.now(timezone.utc);self.day,self.cutoff=closed_edition(self.now)
        self.at=self.cutoff+(self.now-self.cutoff)/2;self.producer=self.root/'producer';self.archive=self.root/'archive';self.series=self.root/'series';self.original=self.series/'inputs'/('b'*64);self.original.mkdir(parents=True)
        self.policy={'enabled':True,'sync_effective_date':'2026-10-15','execbrief_root':str(self.producer),'archive_root':str(self.archive),'series_root':str(self.series),'handoff_root':str(self.root/'NAS'),'external_storage':True,'node':'fixture-node','credential_file':'fixture-no-credentials'}
        self.oldfid=(self.cutoff-timedelta(hours=1)).strftime('%Y%m%d%H%M%S')+'.export';self.newfid=(self.cutoff-timedelta(minutes=30)).strftime('%Y%m%d%H%M%S')+'.export'
        oldraw=self.archive/'raw/original.zip';oldraw.parent.mkdir(parents=True);oldraw.write_bytes(b'original fixture ZIP metadata')
        bulk=self.archive/'manifests/original/gdelt-bulk-manifest.json';save(bulk,{'files':[{'file_id':self.oldfid,'status':'downloaded','sha256':ref(oldraw)['sha256']}]});self.oldbulk=bulk
        previous=(datetime.fromisoformat(self.day)-timedelta(days=1)).date().isoformat();self.parents={};blobs={}
        for label,name,value in [('publication_receipt','publication-receipt.json',{'verified':True}),('release_checks','checks-receipt.json',{'passed':True}),('editorial_acceptance','acceptance.json',{'accepted':True}),('selected_input','selected-input.json',{'run_date':self.day,'cutoff_utc':self.cutoff.isoformat(),'retained_events_mentions':{'manifest_references':[ref(bulk)]}}),('previous_selected_input','previous-selected-input.json',{'run_date':previous,'cutoff_utc':(self.cutoff-timedelta(days=1)).isoformat()})]:
            path=self.producer/'.daily-work/parent'/name;save(path,value);self.parents[label]=ref(path);blobs[name]=path.read_bytes()
        for label,day,selected in [('input_seal',self.day,'selected_input'),('previous_input_seal',previous,'previous_selected_input')]:
            p=self.producer/'operations/daily-inputs'/day/'bindings.json';save(p,{'run_date':day,'gkg_run_manifest_sha256':self.parents[selected]['sha256'],'information_cutoff_utc':json.loads(Path(self.parents[selected]['path']).read_bytes())['cutoff_utc']});self.parents[label]=ref(p)
        blobs['editorial.json']=canonical({'date':self.day,'stories':[]});blobs['search-interest-seal.json']=canonical({'snapshot_id':'s'*64,'window':{'start_utc':(self.cutoff-timedelta(days=1)).isoformat(),'end_utc':self.cutoff.isoformat(),'semantics':'[start,end)'},'countries':{}})
        self.binding={'bundle_id':'b'*64,'date':self.day,'cutoff_utc':self.cutoff.isoformat().replace('+00:00','Z'),'execbrief_release':'fixture-release','accepted_editorial_sha256':sha256(blobs['editorial.json']).hexdigest(),'publication_receipt_sha256':self.parents['publication_receipt']['sha256'],'acceptance_receipt_sha256':self.parents['editorial_acceptance']['sha256'],'selected_input_manifest_sha256':self.parents['selected_input']['sha256'],'previous_selected_input_manifest_sha256':self.parents['previous_selected_input']['sha256'],'search_interest_snapshot_id':'s'*64,'search_interest_seal_sha256':sha256(blobs['search-interest-seal.json']).hexdigest()}
        for name,raw in blobs.items():(self.original/name).write_bytes(raw)
        save(self.original/'manifest.json',{'binding':self.binding,'files':{n:sha256(b).hexdigest() for n,b in blobs.items()}})
        public=self.root/'public/data/v2';public.mkdir(parents=True);self.parent='a'*64
        value={'date':self.day,'snapshot_id':self.parent,'cutoff_series':'execbrief-03-v1','cutoff_utc':self.binding['cutoff_utc'],'upstream_sync':self.binding}
        self.parent_sha=save(public/(self.parent+'.json'),value);save(public/'latest.json',value);save(public/'status.json',{'date':self.day,'snapshot_id':self.parent})
        save(public/'manifest.json',{self.day:{'snapshot_id':self.parent,'path':self.parent+'.json','sha256':self.parent_sha}})
        self.original_public={p.name:p.read_bytes() for p in public.iterdir()}
        self.raw=self.archive/'raw/supplement.zip';self.raw.write_bytes(b'new raw fixture');self.parquet=self.archive/'normalized/supplement.parquet';self.parquet.parent.mkdir();self.parquet.write_bytes(b'normalized fixture; not accepted production data')
        self.bulk=self.archive/'manifests/supplement/gdelt-bulk-manifest.json';save(self.bulk,{'dataset_hash':'d'*64,'generated_at':self.at.isoformat(),'files':[{'file_id':self.newfid,'status':'downloaded','storage_path':str(self.raw),'sha256':ref(self.raw)['sha256']}]})
        self.index=self.archive/'indexes/index-v2-fixture.json';save(self.index,{'dataset_version':'d'*64,'bulk_manifest_sha256':ref(self.bulk)['sha256'],'files':[{'source_file_id':self.newfid,'status':'available','parquet_path':str(self.parquet),'parquet_sha256':ref(self.parquet)['sha256'],'rows_loaded':20,'rows_rejected':2}]})
        acquisition=self.producer/'.daily-work/raw-priority/fixture.json';window=[(self.at-timedelta(minutes=1)).isoformat(),self.at.isoformat()]
        save(acquisition,{'intervals':[{'role':'missing','acquisition_window_utc':window,'files':[{'file_id':self.newfid,'status':'downloaded','sha256':ref(self.raw)['sha256']}]}]})
        self.row={'file_id':self.newfid,'kind':'english-export','raw':ref(self.raw),'bulk_manifest':ref(self.bulk),'normalized_index':ref(self.index),'normalized_parquet':ref(self.parquet),'rows_loaded':20,'rows_rejected':2,'acquisition_evidence':{'kind':'existing-collector-raw-priority','receipt':ref(acquisition),'role':'missing','acquisition_window_utc':window,'file_transfer_status':'downloaded','exact_file_download_time_utc':None}}
        self.catalog={'kind':'execbrief-em-source-catalog-v1','schema_version':1,'run_date':self.day,'parent_release':'fixture-release','parent_edition_sha256':self.binding['accepted_editorial_sha256'],'parents':copy.deepcopy(self.parents),'window_start_utc':(self.cutoff-timedelta(hours=48)).isoformat(),'information_cutoff_utc':self.cutoff.isoformat(),'availability_epoch':'explicit-post-original-seal-supplement','availability_status':'partial','sources':[self.row]}
        self.folder=self.producer/'.daily-work/source-supplements'/self.day/'fixture-immutable';self.folder.mkdir(parents=True);self.validator='f21011d02064be61410193ef912b329e978220c953bc6811477b9ebd3c7a74b4';self.publish_contract()
        self.request={'schema':'wcr-source-revision-request-v1','id':'fixture_formal','date':self.day,'requested_at_utc':self.now.isoformat(),'expires_at_utc':(self.now+timedelta(days=1)).isoformat(),'parent':{'snapshot_id':self.parent,'snapshot_sha256':self.parent_sha,'upstream_bundle_id':'b'*64,'publication_receipt_sha256':self.binding['publication_receipt_sha256']},'source_revision_receipt':ref(self.folder/'acceptance.json')}
        self.request['source_revision_receipt'].pop('bytes')
    def tearDown(self):self.temp.cleanup()
    def publish_contract(self):
        save(self.folder/'catalog.json',self.catalog)
        checks={'kind':'execbrief-em-source-checks-v1','passed':True,'at_utc':self.at.isoformat(),'catalog':ref(self.folder/'catalog.json'),'parent_chain_verified':True,'added_sources_full_SHA_ZIP_CRC_and_normalized_SHA_verified':1,'prior_accepted_sources_reused':len(self.catalog['sources'])-1,'validator_sha256':self.validator,'daily_edition_rebuilt_or_republished':False};save(self.folder/'checks.json',checks)
        self.acceptance={'kind':'execbrief-em-source-supplement-acceptance-v1','accepted':True,'run_date':self.day,'at_utc':self.at.isoformat(),'parent_release':'fixture-release','parent_publication_sha256':self.binding['publication_receipt_sha256'],'catalog':ref(self.folder/'catalog.json'),'checks':ref(self.folder/'checks.json'),'availability_status':'partial','consumer_must_strict_union_ID_SHA_and_retain_quality_gate':True,'validator_sha256':self.validator};save(self.folder/'acceptance.json',self.acceptance)
        if hasattr(self,'request'):self.request['source_revision_receipt']['sha256']=ref(self.folder/'acceptance.json')['sha256']
    def accept_change(self):
        save(self.folder/'acceptance.json',self.acceptance);self.request['source_revision_receipt']['sha256']=ref(self.folder/'acceptance.json')['sha256']
    def freeze(self):return gate.freeze(self.policy,self.request,self.root)

class FormalGate(ContractFixture,unittest.TestCase):
    def test_valid_partial_supplement_preserves_originals_and_is_an_explicit_late_union(self):
        before={p.name:p.read_bytes() for p in self.original.iterdir()};bundle,binding=self.freeze()
        self.assertNotEqual(bundle,self.original);self.assertTrue(binding['source_revision']['known_after_original_cutoff']);self.assertEqual(binding['search_interest_seal_sha256'],self.binding['search_interest_seal_sha256'])
        self.assertEqual(selected_raw_sources(bundle,self.archive),{self.oldfid:ref(self.archive/'raw/original.zip')['sha256'],self.newfid:ref(self.raw)['sha256']})
        self.assertEqual(before,{p.name:p.read_bytes() for p in self.original.iterdir()});self.assertEqual(self.original_public,{p.name:p.read_bytes() for p in (self.root/'public/data/v2').iterdir()});self.assertEqual(self.freeze(),(bundle,binding))
    def test_wrong_parent_full_SHA_is_rejected(self):
        self.catalog['parents']['release_checks']['sha256']='e'*64;self.publish_contract()
        with self.assertRaises(InvalidRequest):self.freeze()
    def test_accepted_flag_alone_or_unknown_validator_is_rejected(self):
        for key,value in [('accepted',False),('validator_sha256','f'*64),('availability_status','complete')]:
            with self.subTest(key=key):
                old=copy.deepcopy(self.acceptance);self.acceptance[key]=value;self.accept_change()
                with self.assertRaises(InvalidRequest):self.freeze()
                self.acceptance=old;self.accept_change()
    def test_pre_cutoff_or_future_acceptance_does_not_claim_late_knowledge(self):
        for at in [self.cutoff,self.now+timedelta(seconds=1)]:
            self.acceptance['at_utc']=at.isoformat();self.accept_change()
            with self.assertRaises(InvalidRequest):self.freeze()
    def test_duplicate_outside_window_and_wrong_series_ID_are_rejected(self):
        for rows in [[self.row,self.row],[{**self.row,'file_id':self.cutoff.strftime('%Y%m%d%H%M%S')+'.export'}],[{**self.row,'file_id':self.newfid.replace('.export','.translation.export')}]]:
            self.catalog['sources']=rows;self.publish_contract()
            with self.assertRaises(InvalidRequest):self.freeze()
    def test_raw_ID_SHA_conflict_with_original_is_rejected(self):
        self.row['file_id']=self.oldfid;self.catalog['sources']=[self.row];self.publish_contract()
        with self.assertRaises(InvalidRequest):self.freeze()
    def test_normalized_SHA_rows_and_parent_seal_drift_are_rejected(self):
        for change in ['parquet','rows','seal']:
            with self.subTest(change=change):
                original=copy.deepcopy(self.catalog)
                if change=='parquet':self.catalog['sources'][0]['normalized_parquet']['sha256']='f'*64
                elif change=='rows':self.catalog['sources'][0]['rows_rejected']=0
                else:self.catalog['parents']['input_seal']['sha256']='f'*64
                self.publish_contract()
                with self.assertRaises(InvalidRequest):self.freeze()
                self.catalog=original;self.publish_contract()
    def test_producer_and_archive_path_escape_is_rejected(self):
        self.catalog['sources'][0]['normalized_parquet']['path']=str(self.root/'outside.parquet');self.publish_contract()
        with self.assertRaises(InvalidRequest):self.freeze()
    def test_acquisition_identity_and_exact_timestamp_fabrication_are_rejected(self):
        for key,value in [('file_transfer_status','not_downloaded'),('exact_file_download_time_utc',self.at.isoformat())]:
            old=copy.deepcopy(self.catalog);self.catalog['sources'][0]['acquisition_evidence'][key]=value;self.publish_contract()
            with self.assertRaises(InvalidRequest):self.freeze()
            self.catalog=old;self.publish_contract()
    def test_immutable_bulk_acquisition_proof_is_supported(self):
        self.row['acquisition_evidence']={'kind':'immutable-bulk-acquisition','manifest':ref(self.bulk),'acquisition_completed_by_utc':self.at.isoformat(),'exact_file_download_time_utc':None};self.publish_contract();self.freeze()
    def test_only_the_accepted_normalized_version_can_enter_current_selection(self):
        bundle,_=self.freeze();slot=(self.cutoff-timedelta(minutes=30)).isoformat();good={'source_file_id':self.newfid,'source_sha256':ref(self.raw)['sha256'],'path':str(self.parquet),'sha256':ref(self.parquet)['sha256'],'bulk_manifest_sha256':ref(self.bulk)['sha256'],'index_sha256':ref(self.index)['sha256']}
        bad={**good,'sha256':'f'*64};other={**good,'source_sha256':'e'*64};rows={slot:[bad,other,good]}
        selected=select_current_candidates(bundle,self.archive,rows)[slot];self.assertEqual(len(selected),1);self.assertEqual(selected[0]['sha256'],good['sha256']);self.assertEqual(selected[0]['path'],good['path'])
        selected=select_current_candidates(bundle,self.archive,{slot:[bad,other]})[slot];self.assertEqual(selected[0]['sha256'],good['sha256'])
    def test_real_english_priority_namespace_can_add_candidate_absent_from_NAS_catalog(self):
        acquisition=Path(self.row['acquisition_evidence']['receipt']['path']);raw_record=json.loads(acquisition.read_bytes());raw_record.update(kind='em-raw-priority-stage-v1',no_new_queue_or_worker=True)
        ap=self.producer/'.daily-work/rolling-search/em-raw-priority/fixture.json';save(ap,raw_record)
        original=json.loads(self.bulk.read_bytes());subset={**original,'kind':'gdelt_bulk_manifest','schema_version':1,'source_series':['english'],'coverage_status':'partial','source_scope':'Retained English export subset only; original four-file quarter coverage and daily cutoff remain unchanged','source_manifest_references':[{k:v for k,v in ref(self.bulk).items() if k!='bytes'}],'source_raw_priority_receipts':[{k:v for k,v in ref(ap).items() if k!='bytes'}]}
        sp=self.producer/'.daily-work/rolling-search/em-english-priority'/('d'*64)/'gdelt-bulk-manifest.json';save(sp,subset)
        idx=json.loads(self.index.read_bytes());idx['bulk_manifest_sha256']=ref(sp)['sha256'];save(self.index,idx)
        self.row['bulk_manifest']=ref(sp);self.row['normalized_index']=ref(self.index);self.row['acquisition_evidence']['receipt']=ref(ap);self.publish_contract()
        bundle,_=self.freeze();selected=select_current_candidates(bundle,self.archive,{})
        self.assertEqual(len(selected),1);self.assertEqual(next(iter(selected.values()))[0]['bulk_manifest_path'],str(sp))
        subset['source_scope']='complete quarter';save(sp,subset);self.row['bulk_manifest']=ref(sp);self.publish_contract()
        with self.assertRaises(InvalidRequest):self.freeze()
    def test_recheck_detects_a_control_change_before_freeze(self):
        original=gate.Reader.recheck
        def change(reader):self.bulk.write_bytes(b'changed');return original(reader)
        with patch.object(gate.Reader,'recheck',change),self.assertRaises(InvalidRequest):self.freeze()
    def test_missing_contract_fields_are_blocked_as_invalid_instead_of_a_process_crash(self):
        del self.catalog['sources'][0]['normalized_index'];self.publish_contract()
        with self.assertRaisesRegex(InvalidRequest,'malformed_source_supplement_contract'):self.freeze()
    def test_formal_catalog_actual_Parquet_reaches_the_unchanged_half_open_SQL(self):
        import duckdb,shutil
        import export_shared_gdelt as exporter
        db=duckdb.connect(':memory:');db.execute('CREATE TABLE fixture(GlobalEventID VARCHAR,DATEADDED VARCHAR,source_file_id VARCHAR,ActionGeo_CountryCode VARCHAR,SOURCEURL VARCHAR,EventRootCode VARCHAR,EventCode VARCHAR,AvgTone VARCHAR,Actor1Geo_CountryCode VARCHAR,Actor2Geo_CountryCode VARCHAR,SQLDATE VARCHAR,NumMentions VARCHAR,ingested_at_utc VARCHAR)')
        for n,added in enumerate([self.newfid[:14],self.cutoff.strftime('%Y%m%d%H%M%S')]):db.execute('INSERT INTO fixture VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[str(n),added,self.newfid,'JA','https://fixture.invalid/'+str(n),'18','180','-2','JA','','20261018','1',self.at.isoformat()])
        db.execute('COPY fixture TO ? (FORMAT PARQUET)',[str(self.parquet)]);db.close()
        self.row['normalized_parquet']=ref(self.parquet);self.row['rows_loaded']=2;index=json.loads(self.index.read_bytes());index['files'][0].update(parquet_sha256=ref(self.parquet)['sha256'],rows_loaded=2);save(self.index,index);self.row['normalized_index']=ref(self.index);self.publish_contract()
        bundle,_=self.freeze();selected=select_current_candidates(bundle,self.archive,{})
        (self.root/'config').mkdir();shutil.copyfile(ROOT/'config/r_definitions.json',self.root/'config/r_definitions.json');(self.producer/'engine').mkdir();(self.producer/'engine/gdelt.py').write_text('TRACKING_PARAMETERS=set()\ndef canonical_url(url):return url\n')
        with patch.object(exporter,'ROOT',self.root):result=exporter.export(self.archive,self.cutoff,self.root/'observed.json',self.producer,candidates=selected,strict_candidates=True,quiet=True)
        self.assertEqual(result['countries']['JA']['event_count'],1);self.assertEqual(result['coverage']['available_slots'],1);self.assertEqual(result['coverage']['expected_slots'],192);self.assertEqual(result['coverage']['rejected_rows'],2);self.assertEqual(result['source_status'],'partial')

if __name__=='__main__':unittest.main()
