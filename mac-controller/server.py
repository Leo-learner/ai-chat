#!/usr/bin/env python3
"""
Mac Controller — Flask + SocketIO backend
pip install flask flask-socketio psutil simple-websocket
brew install brightness blueutil
"""

from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO
import os
import shlex
import subprocess, psutil, threading, time, re, secrets

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('MAC_CONTROLLER_SECRET_KEY', 'mac-ctrl-2025')
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')

INTERNAL_TOKEN = os.environ.get('CONTROL_INTERNAL_TOKEN', '')


@app.before_request
def require_internal_token():
    if not request.path.startswith('/api/') or not INTERNAL_TOKEN:
        return None
    provided = request.headers.get('X-Internal-Token', '')
    if not secrets.compare_digest(provided, INTERNAL_TOKEN):
        return jsonify({'error': 'Unauthorized control request'}), 401
    return None


def sh(cmd):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True,
                           text=True, timeout=8)
        return r.stdout.strip(), r.stderr.strip()
    except Exception as e:
        return '', str(e)


def run_args(args, timeout=8):
    try:
        r = subprocess.run(args, shell=False, capture_output=True,
                           text=True, timeout=timeout)
        return r.stdout.strip(), r.stderr.strip()
    except Exception as e:
        return '', str(e)


def clamp_int(value, default, lo=0, hi=100):
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    return max(lo, min(hi, n))


def apple_escape(value):
    return str(value).replace('\\', '\\\\').replace('"', '\\"')


# ─────────────────────────────────────────── Volume

@app.route('/api/volume', methods=['GET'])
def get_volume():
    vol, _  = sh("osascript -e 'output volume of (get volume settings)'")
    muted, _ = sh("osascript -e 'output muted of (get volume settings)'")
    return jsonify({
        'volume': int(vol) if vol.isdigit() else 50,
        'muted':  muted.strip() == 'true'
    })

@app.route('/api/volume', methods=['POST'])
def set_volume():
    v = clamp_int((request.json or {}).get('volume'), 50)
    run_args(['osascript', '-e', f'set volume output volume {v}'])
    return jsonify({'ok': True})

@app.route('/api/volume/mute', methods=['POST'])
def toggle_mute():
    muted = (request.json or {}).get('muted', True)
    clause = 'with output muted' if muted else 'without output muted'
    run_args(['osascript', '-e', f'set volume {clause}'])
    return jsonify({'ok': True})


# ─────────────────────────────────────────── Brightness

@app.route('/api/brightness', methods=['GET'])
def get_brightness():
    out, _ = sh("brightness -l 2>&1")
    m = re.search(r'brightness\s+([\d.]+)', out)
    val = float(m.group(1)) if m else 0.7
    return jsonify({'brightness': round(val * 100)})

@app.route('/api/brightness', methods=['POST'])
def set_brightness():
    v = clamp_int((request.json or {}).get('brightness'), 70)
    run_args(['brightness', f'{v / 100:.3f}'])
    return jsonify({'ok': True})


# ─────────────────────────────────────────── Memory

@app.route('/api/memory', methods=['GET'])
def get_memory():
    m = psutil.virtual_memory()
    return jsonify({
        'total':     m.total,
        'used':      m.used,
        'available': m.available,
        'percent':   round(m.percent, 1)
    })


# ─────────────────────────────────────────── Apps

@app.route('/api/apps', methods=['GET'])
def get_apps():
    script = '''
tell application "System Events"
  set appRows to {}
  repeat with proc in (every process where background only is false)
    set appName to name of proc
    set appPid to unix id of proc
    set appFront to frontmost of proc
    set end of appRows to appName & tab & appPid & tab & appFront
  end repeat
  return appRows
end tell
'''
    out, _ = run_args(['osascript', '-e', script])
    apps = []
    seen = set()
    if out:
        for row in out.split(', '):
            parts = [p.strip() for p in row.split('\t')]
            name = parts[0] if parts else ''
            if not name or name in seen:
                continue
            seen.add(name)
            pid = None
            if len(parts) > 1:
                try:
                    pid = int(parts[1])
                except ValueError:
                    pid = None
            frontmost = len(parts) > 2 and parts[2].lower() == 'true'
            apps.append({'name': name, 'pid': pid, 'frontmost': frontmost})
    apps = sorted(apps, key=lambda item: (not item.get('frontmost', False), item.get('name', '').lower()))
    return jsonify({'apps': apps})

@app.route('/api/apps/open', methods=['POST'])
def open_app():
    name = (request.json or {}).get('app', '').strip()
    if name:
        run_args(['open', '-a', name])
    return jsonify({'ok': True})

@app.route('/api/apps/close', methods=['POST'])
def close_app():
    name = (request.json or {}).get('app', '').strip()
    if name:
        run_args(['osascript', '-e', f'tell application "{apple_escape(name)}" to quit'])
    return jsonify({'ok': True})


# ── Command blacklist (destructive / dangerous commands) ──
DANGEROUS_PATTERNS = [
    r'\brm\s+-rf\s+/\b',        # rm -rf /
    r'\brm\s+-rf\s+~\b',         # rm -rf ~
    r'\bshutdown\b',
    r'\bpoweroff\b',
    r'\breboot\b',
    r'\bhalt\b',
    r'\binit\s+[06]\b',
    r'\bdd\s+if=\/',
    r'>\s*/dev/sda',
    r'\bmkfs\.',
    r'\bmkswap\b',
    r'\bpv\s+-\S+/dev/',
    r'\bsudo\s+rm\b',
    r'\bchown\s+-R\s+[^:]*:?[^ ]*\s+/\b',
    r'\bchmod\s+-R\s+[0-7]{3,4}\s+/\b',
    r'\b:(){ :|:& };:\b',          # fork bomb
]

# ─────────────────────────────────────────── Terminal

HOME_DIR = os.path.expanduser('~')


def resolve_terminal_cwd(value):
    raw = (value or '').strip()
    if not raw or raw == '~':
        return HOME_DIR
    expanded = os.path.abspath(os.path.expanduser(raw))
    return expanded if os.path.isdir(expanded) else HOME_DIR


def display_terminal_cwd(path):
    resolved = os.path.abspath(os.path.expanduser(path or HOME_DIR))
    if resolved == HOME_DIR:
        return '~'
    if resolved.startswith(HOME_DIR + os.sep):
        return '~' + resolved[len(HOME_DIR):]
    return resolved


def parse_cd_target(command):
    try:
        parts = shlex.split(command)
    except ValueError:
        return None
    if not parts or parts[0] != 'cd' or len(parts) > 2:
        return None
    return parts[1] if len(parts) == 2 else '~'

@app.route('/api/terminal/run', methods=['POST'])
def run_terminal():
    payload = request.json or {}
    command = (payload.get('command', '') or '').strip()
    cwd = resolve_terminal_cwd(payload.get('cwd'))
    if not command:
        return jsonify({
            'ok': False, 'error': 'Command is required', 'stdout': '', 'stderr': '',
            'code': 1, 'cwd': display_terminal_cwd(cwd)
        }), 400

    # Blacklist check
    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, command):
            return jsonify({
                'ok': False, 'stdout': '', 'stderr': f'Blocked by safety rule (dangerous pattern detected).',
                'code': 127, 'cwd': display_terminal_cwd(cwd)
            }), 200

    cd_target = parse_cd_target(command)
    if cd_target is not None:
        next_cwd = os.path.abspath(os.path.expanduser(
            cd_target if cd_target.startswith('/') else os.path.join(cwd, cd_target)
        ))
        if os.path.isdir(next_cwd):
            return jsonify({
                'ok': True, 'stdout': display_terminal_cwd(next_cwd), 'stderr': '',
                'code': 0, 'cwd': display_terminal_cwd(next_cwd)
            })
        return jsonify({
            'ok': False, 'stdout': '', 'stderr': f'cd: no such directory: {cd_target}',
            'code': 1, 'cwd': display_terminal_cwd(cwd)
        }), 200

    proc = None
    try:
        proc = subprocess.Popen(
            command,
            shell=True,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            stdout, stderr = proc.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            return jsonify({
                'ok': False, 'stdout': '', 'stderr': 'Command timed out after 20 seconds',
                'code': 124, 'cwd': display_terminal_cwd(cwd)
            }), 200

        return jsonify({
            'ok': proc.returncode == 0,
            'stdout': stdout.strip(),
            'stderr': stderr.strip(),
            'code': proc.returncode,
            'cwd': display_terminal_cwd(cwd),
        })
    except Exception as e:
        if proc:
            try:
                proc.kill()
                proc.wait()
            except Exception:
                pass
        return jsonify({
            'ok': False, 'stdout': '', 'stderr': str(e), 'code': 1,
            'cwd': display_terminal_cwd(cwd)
        }), 200


# ─────────────────────────────────────────── Bluetooth

@app.route('/api/bluetooth', methods=['GET'])
def get_bluetooth():
    out, _ = run_args(['blueutil', '--power'])
    return jsonify({'enabled': out.strip() == '1'})

@app.route('/api/bluetooth', methods=['POST'])
def set_bluetooth():
    enabled = (request.json or {}).get('enabled', True)
    run_args(['blueutil', '--power', '1' if enabled else '0'])
    return jsonify({'ok': True})


# ─────────────────────────────────────────── VPN

@app.route('/api/vpn', methods=['GET'])
def get_vpn():
    out, _ = run_args(['scutil', '--nc', 'list'])
    vpns = []
    for line in out.splitlines():
        m = re.search(r'"([^"]+)"', line)
        if m:
            name = m.group(1)
            status_out, _ = run_args(['scutil', '--nc', 'status', name])
            connected = 'Connected' in status_out
            vpns.append({'name': name, 'connected': connected})
    return jsonify({'vpns': vpns})

@app.route('/api/vpn/toggle', methods=['POST'])
def toggle_vpn():
    name    = (request.json or {}).get('name', '')
    connect = (request.json or {}).get('connect', True)
    if name:
        run_args(['scutil', '--nc', 'start' if connect else 'stop', name])
    return jsonify({'ok': True})


# ─────────────────────────────────────────── Memory broadcast loop

def memory_loop():
    while True:
        m = psutil.virtual_memory()
        socketio.emit('memory', {
            'total':     m.total,
            'used':      m.used,
            'available': m.available,
            'percent':   round(m.percent, 1)
        })
        time.sleep(2)


@app.route('/')
def index():
    return render_template('index.html')


if __name__ == '__main__':
    threading.Thread(target=memory_loop, daemon=True).start()
    host = os.environ.get('MAC_CONTROLLER_HOST', '127.0.0.1')
    port = int(os.environ.get('MAC_CONTROLLER_PORT', '5050'))
    print(f'\n  ◆  Mac Controller  →  http://{host}:{port}\n')
    socketio.run(app, host=host, port=port,
                 debug=False, allow_unsafe_werkzeug=True)
