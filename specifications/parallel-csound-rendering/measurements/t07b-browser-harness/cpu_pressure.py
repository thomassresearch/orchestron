"""Bounded diagnostic CPU pressure, only in the disposable playback container."""
import argparse
import json
import multiprocessing
from pathlib import Path
import time


def burn(start, seconds, result):
    start.wait()
    wall, cpu = time.monotonic(), time.process_time()
    end = wall + seconds
    value = 1
    while time.monotonic() < end:
        for _ in range(1000):
            value = (value * 1664525 + 1013904223) & 0xffffffff
    result.send({'wall_seconds': time.monotonic() - wall,
                 'cpu_seconds': time.process_time() - cpu, 'checksum': value})
    result.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--seconds', type=int, choices=range(1, 91), default=60)
    parser.add_argument('--workers', type=int, choices=(1, 2, 3), default=1)
    args = parser.parse_args()
    context = multiprocessing.get_context('spawn')
    start = context.Event()
    tasks = []
    for _ in range(args.workers):
        reader, writer = context.Pipe(False)
        child = context.Process(target=burn, args=(start, args.seconds, writer))
        child.start()
        writer.close()
        tasks.append((child, reader))
    before = Path('/sys/fs/cgroup/cpu.stat').read_text()
    began = time.time()
    start.set()
    results = []
    try:
        for child, reader in tasks:
            if not reader.poll(args.seconds + 15):
                raise RuntimeError('CPU pressure child exceeded bound')
            results.append(reader.recv())
            child.join(5)
            if child.exitcode != 0:
                raise RuntimeError('CPU pressure child did not exit cleanly')
    finally:
        for child, reader in tasks:
            if child.is_alive():
                child.kill()
                child.join(5)
            child.close()
            reader.close()
    print(json.dumps({'started_epoch_seconds': began, 'ended_epoch_seconds': time.time(),
        'workers': args.workers, 'requested_seconds': args.seconds, 'results': results,
        'cpu_stat_before': before, 'cpu_stat_after': Path('/sys/fs/cgroup/cpu.stat').read_text()}))
