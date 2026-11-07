"""Sequential exact native probes on the frozen candidate image."""
import hashlib
import json
import multiprocessing
from pathlib import Path
import subprocess
import sys
from backend.tests.partition_process_support import subnormal_pcm_probe

if __name__ == '__main__':
    results = []
    for case in ('two', 'four', 'eight', 'shared', 'bypass', 'sidechain', 'custom_ports', 'legato'):
        for ksmps in (1, 32):
            completed = subprocess.run([sys.executable, '-m', 'backend.tools.probe_partition_process',
                '--case', case, '--ksmps', str(ksmps)], capture_output=True, text=True, check=True, timeout=120)
            results.append(json.loads(completed.stdout))
            print(case, ksmps, 'exact', flush=True)
    Path('/evidence/native-correctness.json').write_text(json.dumps(results, indent=2)+'\n')
    ctx = multiprocessing.get_context('spawn')
    results = []
    for rate in (48000, 44100):
        for amplitude in (1e-39, 1e-36):
            rows = []
            for mode in ('single', 'parallel'):
                reader, writer = ctx.Pipe(duplex=False)
                process = ctx.Process(target=subnormal_pcm_probe, args=(mode, writer, rate, amplitude))
                try:
                    process.start()
                    writer.close()
                    assert reader.poll(30)
                    pcm, peak = reader.recv()
                    assert peak > 0 and (peak < 2**-126) == (amplitude == 1e-39)
                    rows.append({'mode': mode, 'peak': peak, 'pcm_sha256': hashlib.sha256(pcm).hexdigest()})
                    process.join(10)
                    assert process.exitcode == 0
                finally:
                    if process.is_alive():
                        process.kill()
                        process.join(5)
                    process.close()
                    reader.close()
                    writer.close()
            assert rows[0]['pcm_sha256'] == rows[1]['pcm_sha256']
            results.append({'rate': rate, 'amplitude': amplitude, 'exact': True, 'runs': rows})
            print(rate, amplitude, 'exact', flush=True)
    Path('/evidence/subnormal.json').write_text(json.dumps(results, indent=2)+'\n')
