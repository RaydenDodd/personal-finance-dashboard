"""Owner-only scheduled classifier and weekly report. All inference stays local."""
import argparse
import collections
import csv
import datetime as dt
import email.message
import hashlib
import http.cookiejar
import json
import os
import pathlib
import smtplib
import ssl
import time
import urllib.request
from decimal import Decimal
from zoneinfo import ZoneInfo
from classifier import Classifier, VERSION, merchant, predicted_transfer, spend

ZONE = ZoneInfo('America/New_York')
HERE = pathlib.Path(__file__).resolve().parent
STATE = pathlib.Path(os.environ.get('FINANCE_REPORT_STATE', '/var/lib/finance-reports'))
STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
os.umask(0o077)

def save(name, value):
    target = STATE/name
    temp = target.with_suffix(target.suffix+'.tmp')
    temp.write_text(json.dumps(value, indent=2))
    temp.replace(target)

def read(name, default):
    target = STATE/name
    return json.loads(target.read_text()) if target.exists() else default

def local_date(row):
    return dt.datetime.fromisoformat(row['time'].replace('Z','+00:00')).astimezone(ZONE).date()

def feature(row):
    # Explicit allowlist prevents reference labels, payee defaults and rule metadata leaking into prediction.
    return {key:row.get(key) for key in ('id','note','merchant','mcc')}

def cents(row):
    if row.get('refCurrencyCode') == 'USD':
        amount = row['refAmount']
    elif row.get('currencyCode') == 'USD':
        amount = row['amount']
    else:
        raise ValueError('Missing verified USD amount')
    return int((Decimal(str(amount))*100).quantize(Decimal('1')))

class Api:
    def __init__(self):
        self.base = os.environ.get('FINANCE_API_BASE','http://192.168.0.32:8095')+'/api/v1'
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def request(self,path,data=None,method=None):
        req=urllib.request.Request(self.base+path, method=method,
            data=json.dumps(data).encode() if data is not None else None,
            headers={'Content-Type':'application/json','Origin':'http://localhost:8095'})
        with self.opener.open(req,timeout=45) as response:
            raw=response.read()
            value=json.loads(raw) if raw else None
            return value.get('response',value) if isinstance(value,dict) else value
    def __enter__(self):
        path=os.environ.get('FINANCE_OWNER_CONFIG','/etc/finance-operations/owner.json')
        credentials=json.loads(pathlib.Path(path).read_text())
        self.request('/auth/sign-in/email',{key:credentials[key] for key in ('email','password')})
        return self
    def __exit__(self,*args):
        try:self.request('/auth/sign-out',{})
        except Exception:pass
    def transactions(self):
        rows=[]
        accounts=self.request('/accounts')
        excluded={a['id'] for a in accounts if a.get('excludeFromStats')}
        for offset in range(0,20000,500):
            result=self.request(f'/transactions?limit=500&offset={offset}&includeSplits=true&includeGroups=true&includeTags=true')
            batch=result if isinstance(result,list) else result['transactions']
            for row in batch:
                row['merchant']=row.get('merchantName') or row.get('note')
                row['excludedAccount']=row.get('accountId') in excluded
            rows.extend(batch)
            if len(batch)<500:return rows
        raise RuntimeError('Unexpected transaction count; pagination incomplete')

def model(rows,categories,cutoff=None,overrides=True,held_merchants=None):
    applied=read('applied.json',{})
    training=[]
    for row in rows:
        prior=applied.get(row['id'])
        if prior and prior['afterCategory']==row.get('categoryId') and (prior.get('pending') or prior.get('afterMeta')==row.get('categorizationMeta')):
            continue
        if held_merchants and merchant(row) in held_merchants:continue
        if cutoff:
            if local_date(row)>=cutoff:continue
            categorized=(row.get('categorizationMeta') or {}).get('categorizedAt')
            if categorized and dt.datetime.fromisoformat(categorized.replace('Z','+00:00')).astimezone(ZONE).date()>=cutoff:
                continue
        training.append(row)
    catalog=json.loads((HERE/'merchant-catalog.json').read_text())
    confirmed=read('confirmed-merchants.json',[]) if overrides else []
    return Classifier(training,categories,catalog,confirmed)

def classify(api):
    rows=api.transactions();categories=api.request('/categories')
    predictor=model(rows,categories)
    other=next(c['id'] for c in categories if c['name']=='Other')
    threshold=dt.datetime.now(ZONE).date()-dt.timedelta(days=45)
    applied=read('applied.json',{});review=[];changed=0
    for row in rows:
        if not spend(row) or row.get('isPending') or local_date(row)<threshold:continue
        if row.get('categoryId')!=other:continue
        guess=predictor.predict(feature(row))
        review.append({'id':row['id'],'date':str(local_date(row)),'merchant':row.get('note'),**guess})
        protected=(row.get('categorizationMeta') or {}).get('source') in ('manual','user_rule','payee_rule','subscription_rule')
        if protected or row.get('payeeLocked') or row.get('splits') or predicted_transfer(row) or not guess['automatic']:continue
        latest=api.request('/transactions/'+row['id'])
        if isinstance(latest,list):latest=latest[0]
        if latest.get('categoryId')!=other or latest.get('categorizationMeta')!=row.get('categorizationMeta') or latest.get('payeeLocked'):continue
        # Persist the before-image and exclusion marker before any write.
        applied[row['id']]={'beforeCategory':other,'beforeMeta':row.get('categorizationMeta'),
            'afterCategory':guess['categoryId'],'afterMeta':None,'pending':True,'method':guess['method'],'at':dt.datetime.now(dt.timezone.utc).isoformat()}
        save('applied.json',applied)
        api.request('/transactions/'+row['id'],{'categoryId':guess['categoryId']},'PUT')
        actual=api.request('/transactions/'+row['id'])
        if isinstance(actual,list):actual=actual[0]
        if actual['categoryId']!=guess['categoryId']:raise RuntimeError('Categorization readback failed')
        applied[row['id']]['afterMeta']=actual.get('categorizationMeta');applied[row['id']]['pending']=False;save('applied.json',applied)
        changed+=1
    save('latest-review.json',{'at':dt.datetime.now(dt.timezone.utc).isoformat(),'version':VERSION,'trainingRows':len(predictor.training_ids),'predictions':review,'changed':changed})
    return {'changed':changed,'reviewed':len(review),'trainingRows':len(predictor.training_ids)}

def previous_week(today):
    end=today-dt.timedelta(days=today.weekday())
    return end-dt.timedelta(days=7),end

def summarize(rows,start,end,names):
    totals=collections.Counter();pending=0;unclassified=[];excluded=0;warnings=[];refunds=0
    seen=collections.Counter()
    for row in rows:
        if not start<=local_date(row)<end:continue
        if row.get('isPending'):
            if spend(row):pending+=1
            continue
        if row.get('transactionType')=='income' and row.get('refundLinked') and row.get('transferNature')=='not_transfer':
            refunds+=cents(row);continue
        if not spend(row) or predicted_transfer(row):excluded+=1;continue
        try: amount=cents(row)
        except ValueError:warnings.append('A purchase has no verified USD amount');continue
        seen[(row.get('accountId'),row['time'],row.get('note'),amount)]+=1
        totals[names.get(row.get('categoryId'),'Other')]+=amount
        if names.get(row.get('categoryId'),'Other')=='Other':
            unclassified.append({'date':str(local_date(row)),'merchant':row.get('note') or 'Unknown merchant','amountCents':amount,'id':row['id']})
    gross=sum(totals.values())
    duplicate_groups=sum(count>1 for count in seen.values())
    if duplicate_groups:warnings.append(f'{duplicate_groups} groups have identical account, timestamp, description and amount; review possible duplicates. No records were removed.')
    return {'from':str(start),'through':str(end-dt.timedelta(days=1)),'grossCents':gross,'refundCents':refunds,
            'netCents':gross-refunds,'categoriesCents':dict(totals),'pendingCount':pending,
            'review':unclassified,'excludedCount':excluded,'warnings':warnings}

def refresh(api):
    started=dt.datetime.now(dt.timezone.utc)
    status=api.request('/bank-data-providers/sync/status')
    active=any(a.get('status')=='syncing' for a in status.get('accounts',[]))
    if not active:api.request('/bank-data-providers/sync/trigger',{})
    for attempt in range(36):
        time.sleep(5)
        status=api.request('/bank-data-providers/sync/status');accounts=status.get('accounts',[])
        complete=bool(accounts) and all(a.get('status')=='completed' for a in accounts)
        fresh=complete and all(a.get('completedAt') and dt.datetime.fromisoformat(a['completedAt'].replace('Z','+00:00'))>=started-dt.timedelta(minutes=5) for a in accounts)
        if fresh:return {'complete':True,'accountCount':len(accounts),'checkedAt':dt.datetime.now(dt.timezone.utc).isoformat()}
        if accounts and any(a.get('status')=='failed' for a in accounts) and not any(a.get('status')=='syncing' for a in accounts):break
    return {'complete':False,'accountCount':len(status.get('accounts',[])),'checkedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
            'warning':'Bank sync failed or timed out. Totals reflect available posted transactions and may be incomplete.'}

def prepare(api,refresh_banks=True):
    try:
        status=refresh(api) if refresh_banks else {'complete':False,'warning':'Preview only: no fresh bank sync requested'}
    except Exception:
        status={'complete':False,'warning':'Bank sync could not be refreshed. Totals reflect available posted data and may be incomplete.'}
    classification=classify(api)
    rows=api.transactions();categories=api.request('/categories');names={c['id']:c['name'] for c in categories}
    start,end=previous_week(dt.datetime.now(ZONE).date())
    report={'preparedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'week':summarize(rows,start,end,names),
            'weekend':summarize(rows,end-dt.timedelta(days=3),end,names),'sync':status,'classifier':classification}
    suggestions={p['id']:p for p in read('latest-review.json',{}).get('predictions',[])}
    for item in report['week']['review']:
        guess=suggestions.get(item['id'],{})
        item['suggestion']=guess.get('label','Review needed')
        item['reason']=guess.get('reason','')
    save('report-'+str(start)+'.json',report)
    return report

def report_text(report):
    money=lambda value:f'${value/100:,.2f}'
    lines=['MoneyMatter spending checkup','', 'All dates are Eastern time.']
    if not report['sync']['complete']:lines+=['', 'INCOMPLETE BANK DATA: '+report['sync']['warning']]
    for title,key in [('Full week','week'),('Friday–Sunday weekend','weekend')]:
        data=report[key]
        lines+=['',f'{title}: {data["from"]} through {data["through"]}',
                'Purchases: '+money(data['grossCents']),'Linked refunds: '+money(data['refundCents']),
                'Net spending: '+money(data['netCents'])]
        lines += [f'  {name}: {money(value)}' for name,value in sorted(data['categoriesCents'].items(),key=lambda p:-p[1])]
        lines += [f'Pending purchases excluded: {data["pendingCount"]}']+data['warnings']
    review=report['week']['review']
    lines+=['',f'Categorization checkup: {len(review)} purchases still in Other.']
    for row in review:lines.append(f'{row["date"]} — {row["merchant"]}: {money(row["amountCents"])}; suggestion: {row.get("suggestion","Review needed")}')
    lines+=['','Review: https://raydenfinance.duckdns.org/transactions','',
            'Transfers, credit-card payments and recognized investment movements are excluded. Existing splits and manual categories are preserved.',
            'Totals use currently posted records. Late bank postings or future refunds can change the final amounts.']
    return '\n'.join(lines)

def deliver(text,subject,key):
    marker=STATE/('sent-'+key+'.json')
    if marker.exists():return {'alreadySent':True}
    config=json.loads(pathlib.Path('/etc/finance-operations/email.json').read_text())
    if config.get('to')!='tiggerdodd3@gmail.com' or not config.get('password'):raise RuntimeError('Email configuration incomplete')
    message=email.message.EmailMessage()
    message['From']=config['from'];message['To']=config['to'];message['Subject']=subject
    message['Message-ID']='<'+hashlib.sha256(key.encode()).hexdigest()+'@raydenfinance.duckdns.org>'
    message.set_content(text)
    # A pending marker prevents duplicate mail after a crash with uncertain SMTP acceptance.
    pending=STATE/('sending-'+key+'.json')
    if pending.exists():raise RuntimeError('Prior send outcome uncertain; inspect SMTP before retry')
    save(pending.name,{'at':dt.datetime.now(dt.timezone.utc).isoformat()})
    try:
        with smtplib.SMTP_SSL(config['host'],int(config.get('port',465)),context=ssl.create_default_context(),timeout=45) as server:
            server.login(config['username'],config['password'].replace(' ',''))
            server.send_message(message)
        save(marker.name,{'acceptedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'recipient':config['to']})
        pending.unlink()
    except Exception:
        # Retain pending marker rather than risk duplicate delivery.
        raise RuntimeError('SMTP delivery failed or outcome uncertain; inspect credentials and send state') from None
    return {'smtpAccepted':True}

def send():
    now=dt.datetime.now(ZONE)
    if now.weekday()!=1 or now.hour!=9:raise RuntimeError('Weekly mail is restricted to Tuesday 09:00–09:59 Eastern')
    start,_=previous_week(now.date());report=read('report-'+str(start)+'.json',None)
    if not report:raise RuntimeError('No completed preparation for this week; email not sent')
    age=(dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(report['preparedAt'])).total_seconds()
    if age>3600:raise RuntimeError('Report preparation stale; email not sent')
    return deliver(report_text(report),'MoneyMatter weekly and weekend spending — '+str(start),str(start))

def evaluate(api,start,end):
    rows=api.transactions();categories=api.request('/categories');names={c['id']:c['name'] for c in categories}
    test=[r for r in rows if start<=local_date(r)<end and spend(r) and not r.get('isPending') and not predicted_transfer(r)]
    predictor=model(rows,categories,cutoff=start,overrides=False)
    assert not set(predictor.training_ids)&{r['id'] for r in test}
    # Freeze predictions before reading reference labels or computing accuracy.
    predictions={r['id']:predictor.predict(feature(r)) for r in test}
    save('blind-predictions.json',predictions)
    unseen_model=model(rows,categories,cutoff=start,overrides=False,held_merchants={merchant(r) for r in test})
    unseen={r['id']:unseen_model.predict(feature(r)) for r in test}
    output=[]
    for row in sorted(test,key=lambda r:r['time']):
        prediction=predictions[row['id']];target=names.get(row.get('categoryId'),'Other')
        output.append({'Date':str(local_date(row)),'Merchant':row.get('note') or '', 'Amount USD':cents(row)/100,
            'Bank MCC':row.get('mcc') or '', 'Target label':target,'Predicted label':prediction['label'],
            'Match':prediction['label']==target,'Method':prediction['method'],'Model score':prediction['score'],
            'Auto eligible':prediction['automatic'],'Reason':prediction['reason'],
            'Unseen merchant prediction':unseen[row['id']]['label'],'Transaction ID':row['id']})
    matched=sum(r['Match'] for r in output);automatic=[r for r in output if r['Auto eligible']]
    summary={'start':str(start),'through':str(end-dt.timedelta(days=1)),'testRows':len(test),
        'trainingRows':len(predictor.training_ids),'matches':matched,'accuracy':matched/len(test) if test else None,
        'autoEligible':len(automatic),'autoMatches':sum(r['Match'] for r in automatic),
        'unseenMerchantMatches':sum(r['Unseen merchant prediction']==r['Target label'] for r in output),
        'abstentions':sum(r['Method']=='abstain' for r in output),'version':VERSION,
        'labelPolicy':'Saved reference labels; not independently adjudicated truth. Holdout labels, current payee defaults, post-cutoff corrections and overrides excluded from training.',
        'trainingIds':predictor.training_ids,'rows':output}
    save('evaluation.json',summary)
    with (STATE/'classification-validation.csv').open('w',newline='',encoding='utf-8-sig') as file:
        if output:
            writer=csv.DictWriter(file,fieldnames=output[0].keys());writer.writeheader()
            for row in output:
                writer.writerow({key: ("'"+value if isinstance(value,str) and value.startswith(('=','+','-','@')) else value) for key,value in row.items()})
    return {k:v for k,v in summary.items() if k not in ('rows','trainingIds')}

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('mode',choices=['classify','prepare','preview','send','evaluate','test-email'])
    parser.add_argument('--start',default='2026-11-09');parser.add_argument('--end',default='2026-11-16')
    args=parser.parse_args()
    if args.mode=='send':result=send()
    elif args.mode=='test-email':result=deliver('MoneyMatter report delivery is configured. Weekly and Friday–Sunday spending reports will be sent Tuesdays at 9 AM Eastern. Classification runs locally on the Pi; no cloud AI service is used.','MoneyMatter reporting — delivery check','setup-2026-11-18')
    else:
        with Api() as api:
            if args.mode=='classify':result=classify(api)
            elif args.mode=='evaluate':result=evaluate(api,dt.date.fromisoformat(args.start),dt.date.fromisoformat(args.end))
            else:result=prepare(api,refresh_banks=args.mode=='prepare')
    print(json.dumps(result if args.mode not in ('prepare','preview') else {'prepared':True,'sync':result['sync'],'weekNetCents':result['week']['netCents'],'weekendNetCents':result['weekend']['netCents']}))
