"""Sequential disposable browser qualification arm; never attaches user data."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

from monitor_soak import CLI, parse

IMAGE = 'sha256:b6829d569bcdd005db0c91b5361f710710f3085c96302fcacd29638ccead900d'
HARNESS = Path('output/playwright/t07d')


def cli(*command):
    out = subprocess.check_output([CLI, '-s='+args.session, *command], text=True, timeout=90)
    if '### Error' in out:
        raise RuntimeError(out)
    return out


def save(name, value):
    path = Path(str(args.output)+'-'+name+'.json')
    path.write_text(json.dumps(value, indent=2)+'\n')


def run_script(name):
    return parse(cli('run-code', '--filename', str(HARNESS/(name+'.js'))))


def progress(**fields):
    print(json.dumps({'arm': str(args.output), **fields}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--case', choices=['realtime_2', 'realtime_4'], required=True)
    parser.add_argument('--renderer', choices=['single', 'parallel'], required=True)
    parser.add_argument('--session', required=True)
    parser.add_argument('--seconds', type=float, default=600)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    created = False
    try:
        command = ['docker', 'run', '--rm', '-d', '--pull=never', '--name', 'orchestron-t07d',
                   '--cpus', '4', '--memory', '2g', '--shm-size', '64m',
                   '-p', '127.0.0.1:18771:8000', '-e', 'PYTHONPATH=/app',
                   '-e', 'T07B_CASE='+args.case, '-e', 'T07B_RENDERER='+args.renderer,
                   '-v', str(HARNESS.resolve())+':/evidence:ro', IMAGE,
                   '/app/.venv/bin/python', '/evidence/server.py']
        container = subprocess.check_output(command, text=True, timeout=30).strip()
        created = True
        save('container', {'id': container, 'command': command, 'started_epoch': time.time(),
             'inspect': json.loads(subprocess.check_output(['docker', 'inspect', container], text=True))})
        for attempt in range(30):
            try:
                with urllib.request.urlopen('http://127.0.0.1:18771/probe/fixture', timeout=2) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(1)
        else:
            raise RuntimeError('Qualification server did not become ready')
        cli('open', 'http://127.0.0.1:18771', '--config', str(HARNESS/'playwright-cli.json'))
        cli('run-code', '--filename', str(HARNESS/'setup.js'))
        save('start', run_script('start'))
        progress(phase='soak_started', seconds=args.seconds)
        subprocess.run([sys.executable, 'output/t07d/monitor_soak.py', '--session', args.session,
                        '--seconds', str(args.seconds), '--output', str(args.output)+'-soak.json'], check=True)
        save('resources', json.loads(subprocess.check_output(['docker', 'exec', 'orchestron-t07d',
                         '/app/.venv/bin/python', '/evidence/resources.py'], text=True)))
        save('probe', run_script('install_probe'))
        progress(phase='recovery_started')
        subprocess.run([sys.executable, 'output/t07d/run_recovery.py', '--session', args.session,
                        '--output', str(args.output)+'-recovery.json'], check=True)
        run_script('start_latency')
        progress(phase='latency_started')
        deadline = time.monotonic()+600
        while time.monotonic() < deadline:
            state = parse(cli('eval', '() => ({state:t07.latency.state,count:t07.latency.trials.length,errors:t07.latency.errors})'))
            progress(phase='latency', **state)
            if state['state'] in ('complete', 'failed'):
                break
            time.sleep(30)
        save('latency', parse(cli('eval', '() => window.t07.latency')))
        save('finish', run_script('finish'))
        if state['state'] != 'complete':
            raise RuntimeError('Latency evidence is incomplete; retained failed attempt')
        progress(phase='complete')
    finally:
        if created:
            try:
                cli('close')
            finally:
                subprocess.run(['docker', 'stop', 'orchestron-t07d'], check=True, timeout=30)
