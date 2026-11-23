"""Consume per-user notifications. Reports and email remain owner-only."""
import json,subprocess
from operations import ScopedApi,classify,user_scope
from scoped_api import sql

def redis(*args):
    return subprocess.check_output(['docker','exec','personal-finance-dashboard-redis-1','redis-cli',*args],text=True,timeout=20).strip()

def main():
    users=json.loads(sql('SELECT COALESCE(json_agg(json_build_object(\'id\',u.id,\'email\',b.email)),\'[]\') FROM "Users" u JOIN ba_user b ON b.id=u."authUserId" WHERE lower(b.email) IN (\'rayden@vt.edu\',\'mhen9535@gmail.com\')'))
    for user in users:
        key='finance:local-categorization:pending:'+str(user['id']);generation=redis('GET',key)
        if not generation:continue
        with ScopedApi(user['email']) as api:
            status=api.request('/bank-data-providers/sync/status')
            if any(row.get('status') in ('syncing','queued') for row in status.get('accounts',[])):continue
            with user_scope(user['id']): result=classify(api)
        redis('EVAL',"if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",'1',key,generation)
        print(json.dumps({'userId':user['id'],'postSyncCategorization':result}))
if __name__=='__main__':main()
