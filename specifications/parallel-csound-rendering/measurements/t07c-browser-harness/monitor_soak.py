import argparse
import json
import os
from pathlib import Path
import subprocess
import time

CLI = os.environ.get('PLAYWRIGHT_CLI', 'playwright-cli')


def parse(output):
    if '### Error' in output:
        raise RuntimeError(output)
    return json.JSONDecoder().raw_decode(output.split('### Result\n', 1)[1])[0]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--session', default='t07c')
    parser.add_argument('--seconds', type=float, default=1800)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    code = "() => {const t=window.t07;return {seconds:(performance.now()-t.startedAt)/1000,last:t.diagnostics.at(-1),errors:t.errors,frontendError:t.store.getState().error};}"
    while True:
        out = subprocess.check_output([CLI, '-s='+args.session, 'eval', code], text=True, timeout=30)
        data = parse(out)
        print(json.dumps(data), flush=True)
        if data['seconds'] >= args.seconds:
            break
        time.sleep(min(55, args.seconds - data['seconds'] + 1))
    out = subprocess.check_output([CLI, '-s='+args.session, 'run-code', '--filename',
        'output/playwright/t07c/capture.js'], text=True, timeout=30)
    args.output.with_suffix('.cli.log').write_text(out)
    data = parse(out)
    assert data['elapsedSeconds'] >= args.seconds
    args.output.write_text(json.dumps(data, indent=2) + '\n')
    print(json.dumps({'complete': str(args.output), 'seconds': data['elapsedSeconds'], 'ring': data['ring']}), flush=True)
