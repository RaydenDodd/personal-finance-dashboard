"""Local text classification; no network calls, LLM, or third-party dependencies."""
import collections
import math
import re
import unicodedata

VERSION = 'local-nb-1'

def normalize(text):
    text = unicodedata.normalize('NFKD', str(text or '')).lower()
    text = re.sub(r'\b(?:aplpay|tst|sq|pos|purchase|debit|card)\b', ' ', text)
    text = re.sub(r'\b\d+\b', ' ', text)
    return ' '.join(re.findall(r'[a-z]+', text))

def merchant(row):
    return normalize(row.get('merchant')) or normalize(row.get('note'))

def tokens(row):
    words = merchant(row).split()
    return words + ['pair:'+a+'_'+b for a,b in zip(words, words[1:])]

def contains(text, term):
    return (' '+normalize(term)+' ') in (' '+text+' ')

def bar_name_matches(text, name):
    # Preserve digits: 622 North and 9:30 Club must not degrade to "north" or "club".
    def clean(value):
        value=unicodedata.normalize('NFKD',str(value or '')).encode('ascii','ignore').decode().lower()
        value=value.replace("'",'').replace('&',' and ')
        return ' '.join(re.findall(r'[a-z0-9]+',value))
    return (' '+clean(name)+' ') in (' '+clean(text)+' ')

def spend(row):
    return (row.get('transactionType') == 'expense'
            and row.get('transferNature') == 'not_transfer'
            and not row.get('isPlanned') and not row.get('paymentParentId')
            and not row.get('isBalanceAdjustment', False) and not row.get('excludedAccount', False))

def predicted_transfer(row):
    """Conservative screening, separate from category prediction; never writes links."""
    name = str(row.get('note') or '').lower()
    return bool(re.search(r'^buy .+ shares of |^dividend reinvestment purchase|^ach deposit .+ into robinhood|^deposit from .*checking|^withdrawal to .*fund|\b(?:amex epayment|capital one autopay|credit card payment)\b', name))

class Classifier:
    def __init__(self, training, categories, catalog, overrides=()):
        self.names = {c['id']:c['name'] for c in categories}
        self.ids = {v:k for k,v in self.names.items()}
        self.catalog, self.overrides = catalog, list(overrides)
        self.vocabulary = set()
        self.counts = collections.defaultdict(collections.Counter)
        self.totals = collections.Counter()
        self.docs = collections.Counter()
        self.history = collections.defaultdict(collections.Counter)
        self.training_ids = []
        for row in training:
            category = row.get('categoryId')
            if not spend(row) or row.get('isPending') or category not in self.names or self.names[category] == 'Other':
                continue
            # Never learn the system's own predictions as confirmed labels.
            if row.get('localPrediction') or (row.get('categorizationMeta') or {}).get('source') == 'ai':
                continue
            self.training_ids.append(row['id'])
            self.docs[category] += 1
            self.history[merchant(row)][category] += 1
            for token in tokens(row):
                self.vocabulary.add(token)
                self.counts[category][token] += 1
                self.totals[category] += 1

    def result(self, category, method, score, automatic=False, reason=''):
        category={'Bar, cafe':'Cafe','Alcohol, tobacco':'Bars, alcohol'}.get(category,category)
        if category not in self.ids:
            return {'categoryId':None, 'label':'Review needed', 'method':'abstain', 'score':0,
                    'automatic':False, 'reason':'No matching existing category'}
        return {'categoryId':self.ids[category], 'label':category, 'method':method, 'score':score,
                'automatic':automatic, 'reason':reason}

    def predict(self, row):
        # Only descriptive bank fields enter this method. categoryId/payeeId are intentionally ignored.
        text = merchant(row)
        for override in self.overrides:
            if contains(text, override['merchant']):
                return self.result(override['category'], 'confirmed_override', 1, True, 'Explicit user correction')
        ambiguous = any(contains(text, item) for item in self.catalog['ambiguousMerchants'])
        history = self.history.get(text, {})
        if text and history:
            category, count = max(history.items(), key=lambda pair: pair[1])
            agreement = count/sum(history.values())
            if agreement >= .95:
                return self.result(self.names[category], 'merchant_history', agreement,
                    count >= 2 and not ambiguous, f'{count} earlier same-merchant purchases; agreement {agreement:.0%}')
        code = str(row.get('mcc') or '')
        if code in self.catalog['mcc']:
            category = self.catalog['mcc'][code]
            # 5542 identifies a pump. A service station or bar still may sell food.
            auto = code in ('5542','5812','5814','5411','4121','4112')
            return self.result(category, 'bank_mcc', .98, auto, 'Bank-supplied MCC '+code)
        for group in self.catalog['groups']:
            if any(contains(text, alias) for alias in group['merchants']):
                return self.result(group['category'], 'merchant_catalog', .95, group['automatic'] and not ambiguous,
                                   'Known merchant; mixed-purpose merchants require review')
        for name in self.catalog.get('barNames',[]):
            if bar_name_matches(row.get('merchant') or row.get('note'),name):
                return self.result('Bars, alcohol', 'local_directory', .8, False,
                                   'Listed bar or venue; food versus alcohol needs review')
        if re.search(r'\b(bar|tavern|brewery|bierhall|pub|saloon)\b', text):
            return self.result('Bars, alcohol','name_hint',.65,False,'Whole-word venue hint, not proof of purchase contents')
        known = [token for token in tokens(row) if token in self.vocabulary]
        if not known or not self.docs:
            return self.result(None, 'abstain', 0)
        logs = {}
        n, vocabulary = sum(self.docs.values()), max(len(self.vocabulary), 1)
        for category, count in self.docs.items():
            logs[category] = math.log(count/n)+sum(math.log((self.counts[category][t]+1)/(self.totals[category]+vocabulary)) for t in known)
        best = max(logs, key=logs.get)
        denominator = sum(math.exp(score-logs[best]) for score in logs.values())
        score = 1/denominator
        # NB scores are not calibrated confidence. New-model predictions remain suggestions.
        return self.result(self.names[best], 'local_naive_bayes', score, False,
                           'Local text model; uncalibrated score, manual review required')
