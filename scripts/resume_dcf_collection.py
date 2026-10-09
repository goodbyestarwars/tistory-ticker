"""Continue missing-issuer backfill without relying only on delayed cron events."""
import json
import os
import subprocess
from datetime import datetime
from build_dcf_data import OUT, KST, read_js, target_codes


def main():
    index = read_js(OUT / 'index.js', 'DCF_INDEX')
    now = datetime.now(KST)
    usage = index.get('collectionUsage', {})
    if usage.get('date') == now.date().isoformat() and usage.get('calls', 0) >= 11985:
        return
    canonical = sorted({s['sourceCode'] for s in index['stocks']})
    targets = target_codes(canonical, index['available'], index.get('attempts', {}), now,
                           index.get('cursor', 0), failures=index.get('failures', {}))
    if not any(c not in index['available'] for c in targets):
        return
    repo = os.environ['GITHUB_REPOSITORY']
    runs = json.loads(subprocess.check_output(['gh', 'api', 'repos/' + repo + '/actions/workflows/dcf-data.yml/runs?per_page=10'], text=True))
    if any(r['status'] in ('queued', 'waiting', 'pending', 'requested') for r in runs.get('workflow_runs', [])):
        return  # A serialized continuation already exists.
    subprocess.run(['gh', 'workflow', 'run', 'dcf-data.yml', '--repo', repo, '--ref', 'master',
                    '-f', 'codes=', '-f', 'force=false', '-f', 'max_calls=1200'], check=True)
    print('Eligible missing issuers remain: queued one bounded continuation.')


if __name__ == '__main__':
    main()
