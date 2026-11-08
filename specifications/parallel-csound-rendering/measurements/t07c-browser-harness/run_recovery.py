"""Three identical, bounded container stalls; no application settings changed."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time

CLI = os.environ.get('PLAYWRIGHT_CLI', 'playwright-cli')


def evaluate(code):
    result = subprocess.run([CLI, '-s='+args.session, 'eval', code], capture_output=True, text=True, check=True, timeout=30)
    if '### Error' in result.stdout:
        raise RuntimeError(result.stdout)
    return json.JSONDecoder().raw_decode(result.stdout.split('### Result\n', 1)[1])[0]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--session', default='t07c')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = {'pulse_seconds': 1.2, 'recovery_observation_seconds': 60,
              'stability_window_seconds': 10, 'trials': []}
    for index in range(3):
        identity = f'recovery-{index}'
        evaluate(f'async () => await window.t07.probe.begin({json.dumps(identity)})')
        time.sleep(2)
        before = evaluate('() => window.t07.probe.snapshot()')
        pause_start = time.time()
        try:
            subprocess.run(['docker', 'pause', 'orchestron-t07c'], check=True, capture_output=True, timeout=10)
            pause_completed = time.time()
            time.sleep(report['pulse_seconds'])
        finally:
            resume_start = time.time()
            subprocess.run(['docker', 'unpause', 'orchestron-t07c'], check=True, capture_output=True, timeout=10)
            resume_completed = time.time()
        after = evaluate('() => window.t07.probe.snapshot()')
        # Capture a fixed recovery window in both arms; a failed run is censored,
        # never silently retried with a longer window or a smaller stress pulse.
        time.sleep(60)
        ended = evaluate(f'async () => await window.t07.probe.end({json.dumps(identity)})')
        report['trials'].append({'id': identity, 'before': before, 'after': after,
            'pause_command_start_epoch': pause_start, 'pause_completed_epoch': pause_completed,
            'resume_command_start_epoch': resume_start, 'resume_completed_epoch': resume_completed, 'ended': ended})
        args.output.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'trial': index, 'before_underruns': before['ring'][2],
                          'after_underruns': ended['ended']['ring'][2]}), flush=True)
    # Shared telemetry is copied only after the fixed observations, outside DSP.
    report['telemetry'] = evaluate('() => window.t07.probe.telemetry')
    args.output.write_text(json.dumps(report, indent=2) + '\n')
