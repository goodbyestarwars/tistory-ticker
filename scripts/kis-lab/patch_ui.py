"""Apply read-only labels to the isolated frontend-web copies, preserving original UI."""
from pathlib import Path
import re


def apply(root):
    for component, filename in [('strategy_builder', 'Navigation.tsx'), ('backtester', 'Header.tsx')]:
        path = root / component / 'frontend-web/src/components/layout' / filename
        text = path.read_text()
        if filename == 'Header.tsx':
            text = re.sub(r'const badgeLabel = !status\.authenticated.*?;', 'const badgeLabel = "백데이터";', text, flags=re.S)
            text = re.sub(r'const badgeColor = !status\.authenticated.*?;', 'const badgeColor = "bg-slate-100 text-slate-700";', text, flags=re.S)
        else:
            text = text.replace('const modeLabel = isVps ? "모의" : "실전";', 'const modeLabel = "백데이터";')
            text = text.replace('{status.authenticated && (', '{(')
            text = text.replace('${modeLabel}투자', '${modeLabel} 분석')
        text = re.sub(r'\s*<button\s+onClick=\{\(\) => setIsSettingsOpen\(true\)\}.*?</button>', '', text, flags=re.S)
        text = re.sub(r'\s*<SettingsModal\s+isOpen=\{isSettingsOpen\}\s+onClose=\{\(\) => setIsSettingsOpen\(false\)\}\s*/>', '', text)
        path.write_text(text)


if __name__ == '__main__':
    apply(Path('/home/ubuntu/ninepay-lab/app-20261101/open-trading-api'))
