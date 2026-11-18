import datetime as dt
import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from classifier import Classifier, bar_name_matches, merchant, predicted_transfer, spend

temp=tempfile.TemporaryDirectory()
os.environ['FINANCE_REPORT_STATE']=temp.name
import operations

CATEGORIES=[{'id':name,'name':name} for name in ['Other','Fuel','Restaurant, fast-food','Bars, alcohol','Bar, cafe','Groceries']]
CATALOG=json.loads((pathlib.Path(__file__).parent/'merchant-catalog.json').read_text())
def row(id='1',note='Chipotle',category='Restaurant, fast-food',date='2026-10-01T12:00:00Z',**extra):
    return {'id':id,'note':note,'categoryId':category,'time':date,'transactionType':'expense','transferNature':'not_transfer',
            'currencyCode':'USD','refCurrencyCode':'USD','amount':10,'refAmount':10,**extra}

class LocalClassifierTests(unittest.TestCase):
    def test_prediction_ignores_target_label_and_payee(self):
        model=Classifier([],CATEGORIES,CATALOG)
        a=model.predict({'note':'Chipotle','categoryId':'Fuel','payeeId':'x'})
        b=model.predict({'note':'Chipotle','categoryId':'Groceries','payeeId':'y'})
        self.assertEqual(a,b)
        self.assertEqual(a['label'],'Restaurant, fast-food')
    def test_bank_mcc_and_missing_code(self):
        model=Classifier([],CATEGORIES,CATALOG)
        self.assertEqual(model.predict({'note':'New business','mcc':'5542'})['label'],'Fuel')
        self.assertFalse(model.predict({'note':'New business','mcc':'0012'})['automatic'])
    def test_barber_is_not_a_bar_hint(self):
        model=Classifier([],CATEGORIES,CATALOG)
        self.assertEqual(model.predict({'note':'A barber shop'})['method'],'abstain')
        self.assertFalse(model.predict({'note':'New tavern'})['automatic'])
    def test_flat_bar_names_preserve_digits_and_existing_review_policy(self):
        self.assertTrue(bar_name_matches('TST* 622 NORTH BLACKSBURG','622 North'))
        self.assertFalse(bar_name_matches('NORTH FACE STORE','622 North'))
        model=Classifier([],CATEGORIES,{**CATALOG,'barNames':["Sharkey's Wing & Rib Joint"]})
        result=model.predict({'note':'SHARKEYS WING AND RIB JOINT'})
        self.assertEqual(result['label'],'Bars, alcohol')
        self.assertFalse(result['automatic'])
    def test_mixed_purpose_merchants_require_review(self):
        model=Classifier([row('1','Sheetz','Fuel'),row('2','Sheetz','Fuel')],CATEGORIES,CATALOG)
        self.assertFalse(model.predict({'note':'Sheetz'})['automatic'])
    def test_confirmed_override_precedes_merchant_history_and_mcc(self):
        model=Classifier([row(note='New tavern',category='Bars, alcohol')],CATEGORIES,CATALOG,
                         [{'merchant':'New tavern','category':'Restaurant, fast-food'}])
        self.assertEqual(model.predict({'note':'New tavern','mcc':'5813'})['label'],'Restaurant, fast-food')
    def test_no_learning_from_cloud_ai(self):
        model=Classifier([row(categorizationMeta={'source':'ai'})],CATEGORIES,CATALOG)
        self.assertEqual(model.training_ids,[])
    def test_cutoff_excludes_later_labels_and_whole_holdout(self):
        rows=[row('old'),row('test',date='2026-11-10T12:00:00Z'),row('revised',categorizationMeta={'source':'manual','categorizedAt':'2026-11-18T12:00:00Z'})]
        model=operations.model(rows,CATEGORIES,dt.date(2026,11,9),False)
        self.assertEqual(model.training_ids,['old'])
    def test_feature_allowlist(self):
        self.assertNotIn('categoryId',operations.feature(row()))
        self.assertNotIn('categorizationMeta',operations.feature(row()))
    def test_pending_write_is_not_relearned_after_interruption(self):
        operations.save('applied.json',{'1':{'afterCategory':'Restaurant, fast-food','pending':True,'afterMeta':None}})
        self.assertEqual(operations.model([row()],CATEGORIES).training_ids,[])
        operations.save('applied.json',{})
    def test_transfer_and_pending_exclusions(self):
        rows=[row(),row('2',transferNature='transfer_out_wallet'),row('3',isPending=True),row('4',note='buy 3.0 shares of TEST for $2 each')]
        summary=operations.summarize(rows,dt.date(2026,10,1),dt.date(2026,10,2),{'Restaurant, fast-food':'Restaurant, fast-food'})
        self.assertEqual(summary['netCents'],1000)
        self.assertEqual(summary['pendingCount'],1)
        self.assertEqual(summary['excludedCount'],2)
    def test_week_and_weekend_boundaries(self):
        start,end=operations.previous_week(dt.date(2026,11,17))
        self.assertEqual((start,end),(dt.date(2026,11,9),dt.date(2026,11,16)))
        self.assertEqual(end-dt.timedelta(days=3),dt.date(2026,11,13))
    def test_local_midnight_and_dst(self):
        self.assertEqual(operations.local_date(row(date='2026-11-09T04:59:59Z')),dt.date(2026,11,8))
        self.assertEqual(operations.local_date(row(date='2026-11-09T05:00:00Z')),dt.date(2026,11,9))
        self.assertEqual(operations.local_date(row(date='2026-11-01T05:30:00Z')),dt.date(2026,11,1))
        self.assertEqual(operations.local_date(row(date='2026-11-01T06:30:00Z')),dt.date(2026,11,1))
    def test_missing_report_notifies_without_inventing_zero_spending(self):
        now=dt.datetime(2026,11,24,9,0,tzinfo=operations.ZONE)
        with patch.object(operations.dt,'datetime') as clock, patch.object(operations,'deliver',return_value={'smtpAccepted':True}) as delivery:
            clock.now.return_value=now
            operations.send()
        self.assertIn('No spending totals',delivery.call_args.args[0])
        self.assertNotIn('$0.00',delivery.call_args.args[0])
    def test_sent_marker_suppresses_smtp(self):
        operations.save('sent-test.json',{'accepted':True})
        self.assertEqual(operations.deliver('test','test','test'),{'alreadySent':True})
    def test_report_sync_failure_is_visible(self):
        report={'sync':{'complete':False,'warning':'Connection unavailable'},'week':operations.summarize([],dt.date(2026,11,9),dt.date(2026,11,16),{}),'weekend':operations.summarize([],dt.date(2026,11,13),dt.date(2026,11,16),{})}
        self.assertIn('INCOMPLETE BANK DATA',operations.report_text(report))

if __name__=='__main__':unittest.main()
