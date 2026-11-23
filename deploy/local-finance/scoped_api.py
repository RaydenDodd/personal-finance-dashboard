"""Root-only scheduled access using expiring native sessions; no user password is saved.
The host already has administrative Docker/DB access. Sessions are limited to the
explicit household allowlist, expire in 15 minutes, and are removed after each run.
"""
import base64,datetime as dt,hashlib,hmac,json,secrets,subprocess,urllib.parse,uuid
ALLOWED={'rayden@vt.edu','mhen9535@gmail.com'}
def sql(statement):
 return subprocess.check_output(['docker','exec','personal-finance-dashboard-db-1','psql','-U','finance','-d','finance','-At','-v','ON_ERROR_STOP=1','-c',statement],text=True,timeout=15).strip()
def literal(value):return "'"+str(value).replace("'","''")+"'"
def create_session(email):
 if email not in ALLOWED:raise ValueError('Household classifier identity is not allowed')
 row=sql('SELECT json_build_object(\'authId\',b.id,\'userId\',u.id)::text FROM ba_user b JOIN "Users" u ON u."authUserId"=b.id WHERE lower(b.email)='+literal(email))
 if not row:raise ValueError('User has not registered')
 user=json.loads(row);token=secrets.token_urlsafe(32);session=str(uuid.uuid4())
 secret=subprocess.check_output(['docker','exec','personal-finance-dashboard-backend-1','printenv','BETTER_AUTH_SECRET'],text=True,timeout=10).strip()
 prefix=subprocess.check_output(['docker','exec','personal-finance-dashboard-backend-1','sh','-c','printf %s "${BETTER_AUTH_COOKIE_PREFIX:-bt_auth}"'],text=True,timeout=10).strip()
 sql('INSERT INTO ba_session (id,"userId",token,"expiresAt","ipAddress","userAgent","createdAt","updatedAt") VALUES ('+','.join([literal(session),literal(user['authId']),literal(token),"NOW()+INTERVAL '15 minutes'",literal('127.0.0.1'),literal('MoneyMatter root-scheduled local classifier'), 'NOW()','NOW()'])+')')
 signed=token+'.'+base64.b64encode(hmac.new(secret.encode(),token.encode(),hashlib.sha256).digest()).decode()
 return user['userId'],session,prefix+'.session_token='+urllib.parse.quote(signed,safe='')
def remove_session(session):sql('DELETE FROM ba_session WHERE id='+literal(session))
