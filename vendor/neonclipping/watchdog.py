"""Tells the user (and the error log) when a clip job has not moved for a long time.

A job that shows the same stage and progress for STALL_SECONDS gets a visible note on its stage line, and the Python stack of every
worker thread is written to the local error log, so "Report a problem" shows exactly where it is waiting. Nothing is killed: on a slow PC
a long step can be normal.
"""
import sys, threading, time, traceback

STALL_SECONDS = 900
CHECK_EVERY = 30
ACTIVE = ('running', 'queued', 'starting')


def _signature(row):
    return (row.get('stage'), row.get('message'), row.get('progress'), row.get('preview_status'))


def stacks(limit=2500):
    """Compact stack of the worker threads (not the web server threads), newest frames only."""
    main = threading.main_thread().ident
    names = {t.ident: t.name for t in threading.enumerate()}
    out = []
    for ident, frame in sys._current_frames().items():
        if ident == main or ident == threading.get_ident():
            continue
        lines = traceback.format_stack(frame)[-4:]
        text = ''.join(lines).strip()
        if 'ThreadPoolExecutor' in text and '_worker' in text and 'work_item' in text:
            continue
        if text:
            out.append(f'[{names.get(ident, ident)}]\n{text}')
    return ('\n---\n'.join(out))[-limit:]


def check(state, seen, now, log, stall=STALL_SECONDS):
    """One pass. `seen` maps job -> [signature, since, warned]. Returns the jobs that were flagged."""
    flagged = []
    for job, row in list(state.items()):
        if row.get('status') not in ACTIVE:
            seen.pop(job, None)
            continue
        sig = _signature(row)
        entry = seen.get(job)
        if entry is None or entry[0] != sig:
            seen[job] = [sig, now, False]
            continue
        if not entry[2] and now - entry[1] >= stall:
            entry[2] = True
            minutes = int((now - entry[1]) // 60)
            step = str(row.get('stage') or row.get('message') or 'this step')
            try:
                log('stuck', f'No progress for {minutes} min at: {step}\n' + stacks())
            except Exception:       # noqa: BLE001
                pass
            note = f'{step} · no progress for {minutes} min. A slow PC can need this long; if it never moves, press Report a problem.'
            try:
                row['stage'] = note
                row['message'] = note
                entry[0] = _signature(row)
            except Exception:       # noqa: BLE001
                pass
            flagged.append(job)
    return flagged


def start(state, log):
    seen = {}

    def loop():
        while True:
            time.sleep(CHECK_EVERY)
            try:
                check(state, seen, time.monotonic(), log)
            except Exception:       # noqa: BLE001 - a watchdog must never crash the app
                pass
    threading.Thread(target=loop, daemon=True, name='watchdog').start()
