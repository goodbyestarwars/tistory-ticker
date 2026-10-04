# 종목 아이콘

종목별 로고 아이콘 디렉토리. 파일명 규칙: `종목코드.svg` 또는 `종목코드.png` (예: `005930.svg`, `000660.png`).

- svg 우선, svg가 없는 종목만 png 사용
- `data/krx_map.js`의 종목코드와 동일한 코드 사용
- 코드 하나당 파일 하나(중복 금지)

## 로컬에서 대량 업로드하는 법

```bash
git clone https://github.com/goodbyestarwars/tistory-ticker.git
cd tistory-ticker
git checkout claude/stock-icon-github-upload-5wrv0w
git pull origin claude/stock-icon-github-upload-5wrv0w

# C:\Users\goodb\Downloads\code\logo 안의 파일들을 이 폴더로 복사
cp /path/to/logo/*.svg /path/to/logo/*.png img/stock-icons/

git add img/stock-icons/
git commit -m "Add stock icon assets"
git push -u origin claude/stock-icon-github-upload-5wrv0w
```

푸시 후 GitHub Pages 반영(최대 10분)까지 기다리면 아래 URL로 접근 가능:

```
https://goodbyestarwars.github.io/tistory-ticker/img/stock-icons/{종목코드}.svg
```

## 미국 종목 아이콘

주요 미국 종목 아이콘은 Simple Icons 데이터를 Iconify API에서 SVG로 내려받아 티커명으로 저장합니다. 현재 지원 파일은 `AAPL.svg`, `MSFT.svg`, `NVDA.svg`, `AMZN.svg`, `GOOGL.svg`, `TSLA.svg`, `META.svg`, `AVGO.svg`, `AMD.svg`, `NFLX.svg`입니다.

- 원본 아이콘: https://github.com/simple-icons/simple-icons
- 다운로드 API: https://api.iconify.design/simple-icons/{slug}.svg

2026-10-04: 캘린더 미국 실적 대상인 S&P 100 중 아이콘이 없던 86종목을 Parqet 로고 서비스(`https://assets.parqet.com/logos/symbol/{티커}?format=svg`, 복수 클래스는 `BRK-B`)에서 받아 채웠다. SVG는 배경 사각형을 원으로 바꿔 기존 아이콘 모양에 맞췄고, SVG가 없는 10종목(CHTR·COF·EMR·EXC·NOW·SO·SPG·TMUS·USB·WBA)은 받은 PNG(100px)를 그대로 `.png`로 둔다. 파일명은 `BRK.B`처럼 캘린더 심볼 표기를 따른다.
