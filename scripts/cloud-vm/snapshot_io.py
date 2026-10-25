"""Publish a complete JSON snapshot; interruption never truncates the old result.

Read/modify/write callers still own their existing domain locks.
"""
import json
import os
from pathlib import Path
import tempfile


def atomic_json(path, value):
    target = Path(path)
    fd, temporary = tempfile.mkstemp(prefix='.' + target.name + '.', suffix='.tmp', dir=target.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
