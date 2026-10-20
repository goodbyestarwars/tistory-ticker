"""Execute real deployment functions with inert git/copy/systemctl stubs."""
from pathlib import Path
import os
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
BASH = (r'C:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else shutil.which('bash'))
SCRIPT = (ROOT/'scripts/cloud-vm/deploy_check.sh').read_text(encoding='utf-8')


def function(name):
    start = SCRIPT.index(name + '() {')
    return SCRIPT[start:SCRIPT.index('\n}\n', start)+3]


@pytest.mark.parametrize('day,hm,changed,crosses,expected', [
    (2, '0759', 1, False, 'new'), (2, '0800', 1, False, 'old'),
    (2, '0900', 1, False, 'old'), (2, '1535', 1, False, 'old'),
    (2, '1959', 1, False, 'old'), (2, '2000', 1, False, 'new'),
    (6, '0900', 1, False, 'new'), (7, '0900', 1, False, 'new'),
    (2, '0900', 0, False, 'new'), (2, '0759', 1, True, 'old')])
def test_pending_backend_keeps_sha_and_retries_after_session(tmp_path, day, hm, changed, crosses, expected):
    if not BASH or not Path(BASH).exists():
        pytest.skip('bash is unavailable')
    script = function('api_deploy_window_protected') + function('deploy_pending_revision')
    script += f'''
set -euo pipefail
APP_DIR="$PWD"
DEPLOYED_FILE="$PWD/deployed"
LAST_DEPLOYED=old
REMOTE=new
DEPLOY_OCCURRED=0
POST_CHECK=skipped
VM_WATCH_PATHS='scripts/cloud-vm/ data/'
PYTHON=post_check
hm={hm}
printf old > "$DEPLOYED_FILE"
date() {{
  case "$*" in
    +%u) printf {day} ;;
    +%H%M) printf '%s' "$hm" ;;
    *) printf test-time ;;
  esac
}}
git() {{
  case "$1" in
    cat-file) return 0 ;;
    diff) return {changed} ;;
    pull) printf 'pull\\n' >> calls; {'hm=0800' if crosses else ':'} ;;
  esac
}}
cp() {{ printf 'copy\\n' >> calls; }}
sudo() {{ printf 'restart\\n' >> calls; }}
post_check() {{ printf 'check\\n' >> calls; }}
run_search_scan_refresh_after_deploy() {{ printf 'rescan\\n' >> calls; }}
deploy_pending_revision
'''
    result = subprocess.run([BASH, '-c', script], cwd=tmp_path, capture_output=True,
                            text=True, encoding='utf-8', timeout=15)
    assert result.returncode == 0, result.stderr
    assert (tmp_path/'deployed').read_text().strip() == expected
    calls = (tmp_path/'calls').read_text().splitlines() if (tmp_path/'calls').exists() else []
    if expected == 'old':
        assert calls == (['pull'] if crosses else [])
        assert not (tmp_path/'deploy.log').exists()
    elif changed:
        assert calls == ['pull', 'copy', 'restart', 'check', 'rescan']
    else:
        assert calls == ['pull']
