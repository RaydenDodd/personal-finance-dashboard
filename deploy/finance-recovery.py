"""Bounded frontend recovery. Never restarts the database or unrelated services."""
import json, pathlib, subprocess, time
ROOT = '/home/rayden/personal-finance-dashboard'
def run(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True, timeout=180)
def inspect(service):
    return json.loads(run('docker', 'inspect', 'personal-finance-dashboard-' + service + '-1'))[0]
state = pathlib.Path('/var/lib/finance-recovery/state.json')
state.parent.mkdir(parents=True, exist_ok=True)
prior = json.loads(state.read_text()) if state.exists() else {}
front = inspect('frontend')
healthy = front['State'].get('Health', {}).get('Status') == 'healthy'
network = bool(front['NetworkSettings']['Networks'].get('personal-finance-dashboard_finance'))
failures = 0 if healthy and network else prior.get('failures', 0) + 1
now = time.time()
if failures >= 3 and now - prior.get('lastRecovery', 0) >= 3600:
    backend = inspect('backend')
    if backend['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Backend unhealthy; frontend recovery deferred')
    prior['lastRecovery'] = now
    state.write_text(json.dumps({**prior, 'failures': failures}))
    run('docker', 'compose', '--env-file', '.env.pi.local', '-f', 'docker-compose.pi.yml',
        'up', '-d', '--no-deps', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '120', 'frontend')
    failures = 0
    print('Recreated frontend after three failed checks; other services untouched')
state.write_text(json.dumps({**prior, 'failures': failures, 'checkedAt': now}))
print('Frontend check: ' + ('healthy' if healthy and network else 'failure recorded'))
