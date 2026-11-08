"""Read-only resource snapshot, outside the clean soak and timed probes."""
import json
import os
from pathlib import Path
import time

processes = []
for directory in sorted(Path('/proc').iterdir()):
    if not directory.name.isdigit() or int(directory.name) == os.getpid():
        continue
    try:
        command = (directory/'cmdline').read_bytes().replace(b'\0', b' ').decode()
        fields = {}
        for line in (directory/'smaps_rollup').read_text().splitlines()[1:]:
            key, value = line.split(':', 1)
            fields[key] = int(value.split()[0])*1024
    except (OSError, ValueError):
        continue
    processes.append({'pid': int(directory.name), 'command': command, 'bytes': fields,
                      'private_bytes': sum(fields.get(key, 0) for key in ('Private_Clean', 'Private_Dirty', 'Private_Hugetlb'))})
report = {'captured_epoch': time.time(), 'processes': processes,
          'private_bytes': sum(p['private_bytes'] for p in processes), 'cgroup': {}}
for name in ('cpu.max', 'cpu.stat', 'memory.max', 'memory.current', 'memory.events', 'cpuset.cpus.effective'):
    path = Path('/sys/fs/cgroup')/name
    if path.exists():
        report['cgroup'][name] = path.read_text()
print(json.dumps(report, indent=2))
