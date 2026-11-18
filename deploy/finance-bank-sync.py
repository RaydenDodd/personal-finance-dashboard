"""Scheduled authenticated fallback; skips recent successful/active syncs."""
import http.cookiejar, json, pathlib, time, urllib.request
base = 'http://192.168.0.32:8095/api/v1'
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def request(path, data=None):
    req = urllib.request.Request(base + path, data=json.dumps(data).encode() if data is not None else None,
        headers={'Content-Type':'application/json', 'Origin':'http://localhost:8095'})
    with opener.open(req, timeout=45) as response:
        value = json.load(response)
        return value.get('response', value)
credentials = json.loads(pathlib.Path('/etc/finance-operations/owner.json').read_text())
try:
    request('/auth/sign-in/email', {key: credentials[key] for key in ('email','password')})
    status = request('/bank-data-providers/sync/status')
    accounts = status.get('accounts', [])
    recent = time.time()*1000 - (status.get('lastSyncAt') or 0) < 10*3600*1000
    if any(a.get('status') == 'syncing' for a in accounts):
        print('Bank sync already running; skipped')
    elif accounts and recent and all(a.get('status') == 'completed' for a in accounts):
        print('Recent successful bank sync; skipped')
    else:
        request('/bank-data-providers/sync/trigger', {})
        for attempt in range(24):
            time.sleep(5)
            status = request('/bank-data-providers/sync/status')
            accounts = status.get('accounts', [])
            if accounts and all(a.get('status') == 'completed' for a in accounts):
                print('All connected bank accounts synced successfully')
                break
        else:
            raise RuntimeError('Bank sync incomplete; inspect application status')
finally:
    try: request('/auth/sign-out', {})
    except Exception: pass
