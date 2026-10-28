"""Optional OFFLINE attachment text extraction. Never imported by API handlers.

Accepts an already-authorized local file, not a URL. No implicit download or OCR
guess. A short-lived worker isolates PDF/HWP parsers from the 1GB API process.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET

MAX_BYTES = 5 * 1024 * 1024
MAX_EXPANDED = 20 * 1024 * 1024
MAX_TEXT = 80000


def extract(path, timeout=12):
    path = Path(path).resolve()
    if path.stat().st_size > MAX_BYTES:
        return {'state': 'too_large', 'text': ''}
    try:
        done = subprocess.run([sys.executable, __file__, '--worker', str(path)],
                              capture_output=True, timeout=min(timeout, 15), check=False)
        if done.returncode:
            return {'state': 'unreadable', 'text': ''}
        return json.loads(done.stdout)
    except (subprocess.TimeoutExpired, ValueError, OSError):
        return {'state': 'unreadable', 'text': ''}


def _worker(path):
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (192 * 1024 * 1024, 192 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
    except ImportError:
        pass  # Parent timeout still applies on Windows.
    path = Path(path)
    if path.stat().st_size > MAX_BYTES:
        return {'state': 'too_large', 'text': ''}
    kind = path.suffix.lower()
    if kind == '.pdf':
        try:
            from pypdf import PdfReader
        except ImportError:
            return {'state': 'parser_unavailable', 'text': ''}
        reader = PdfReader(path)
        text = '\n'.join((p.extract_text(extraction_mode='layout') or '') for p in reader.pages[:10])[:MAX_TEXT]
        return {'state': 'text' if text.strip() else 'needs_ocr_review', 'text': text,
                'partial': len(reader.pages) > 10}
    if kind == '.hwpx':
        with zipfile.ZipFile(path) as archive:
            if sum(i.file_size for i in archive.infolist()) > MAX_EXPANDED:
                return {'state': 'too_large', 'text': ''}
            parts = []
            for item in archive.infolist():
                if item.filename.startswith('Contents/section') and item.filename.endswith('.xml'):
                    parts.extend(ET.fromstring(archive.read(item)).itertext())
            return {'state': 'text', 'text': '\n'.join(parts)[:MAX_TEXT]}
    if kind == '.hwp' and shutil.which('hwp5txt'):
        output = subprocess.run(['hwp5txt', str(path)], capture_output=True, timeout=8, check=True)
        return {'state': 'text', 'text': output.stdout.decode('utf-8')[:MAX_TEXT]}
    return {'state': 'parser_unavailable' if kind == '.hwp' else 'needs_manual_review', 'text': ''}


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--worker':
        try:
            print(json.dumps(_worker(sys.argv[2]), ensure_ascii=True))
        except Exception:
            print(json.dumps({'state': 'unreadable', 'text': ''}))
    else:
        print(json.dumps(extract(sys.argv[1]), ensure_ascii=True))
