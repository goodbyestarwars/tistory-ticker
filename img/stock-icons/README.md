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
