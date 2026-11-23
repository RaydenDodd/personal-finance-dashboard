import os,tempfile,unittest,pathlib
os.environ.setdefault('FINANCE_REPORT_STATE',tempfile.mkdtemp())
import operations
from classifier import Classifier
class HouseholdRules(unittest.TestCase):
 def rule(self,op,value):return {'conditions':{'match':'all','items':[{'field':'transactionType','operator':'equals','value':'expense'},{'field':'note','operator':'contains_any','value':['SHELL']},{'field':'amount','operator':op,'value':value,'currency':{'mode':'specific','code':'USD'}}]}}
 def row(self,amount):return {'transactionType':'expense','note':'SHELL OIL','amount':amount,'currencyCode':'USD'}
 def test_gas_boundary(self):
  fuel=self.rule('gte',{'min':30});food=self.rule('lte',{'max':29.99})
  for amount in [29.99,30,30.01]:
   self.assertEqual(operations.matches_rule(self.row(amount),fuel),amount>=30)
   self.assertEqual(operations.matches_rule(self.row(amount),food),amount<30)
  self.assertFalse(operations.matches_rule({**self.row(40),'transactionType':'income'},fuel))
  self.assertFalse(operations.matches_rule({**self.row(40),'currencyCode':'EUR'},fuel))
 def test_per_user_state_isolation(self):
  original=operations.STATE
  with operations.user_scope(2):
   self.assertNotEqual(operations.STATE,original)
   operations.save('test.json',{'user':2})
  self.assertEqual(operations.STATE,original)
  self.assertFalse((original/'test.json').exists())
 def test_renamed_category_catalog(self):
  model=Classifier([], [{'id':'c','name':'Cafe'},{'id':'b','name':'Bars, alcohol'}],{'groups':[],'ambiguousMerchants':[]})
  self.assertEqual(model.result('Bar, cafe','test',1)['categoryId'],'c')
  self.assertEqual(model.result('Alcohol, tobacco','test',1)['categoryId'],'b')
if __name__=='__main__':unittest.main()
