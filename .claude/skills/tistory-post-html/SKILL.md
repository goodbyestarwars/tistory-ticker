---
name: tistory-post-html
description: 티스토리 포스팅 HTML을 작성·수정·재출력할 때 사용 - 확정된 인라인 CSS 제목/표 디자인과 모바일 대응 규칙을 그대로 적용
---

# 티스토리 포스팅 HTML

트리거 예시: "티스토리 포스팅 작성해", "포스팅 HTML로 출력해", "9Pay 리포트를 포스팅으로 만들어줘", "기존 글을 티스토리 형식으로 바꿔줘"

## 원칙

- 이 스킬의 산출물은 **글 본문(포스트) 안에 들어갈 인라인 HTML**이다. `skin.html`과 `style.css`(사이트 공통 스킨, `.claude/rules/frontend.md` 대상)는 절대 수정하지 않는다 - 완전히 다른 배포 경로다.
- 스타일은 전부 각 요소의 `style=""` 인라인 속성으로 적용한다. 포스트마다 독립적으로 렌더링돼야 하므로 외부 클래스·스타일시트에 의존하지 않는다.
- 결과물은 항상 **티스토리 HTML 편집기에 그대로 붙여넣을 수 있는 완전한 HTML 코드 블록 하나**로 출력한다. 스타일을 설명 텍스트로 나열하지 않는다.

## 제목(H2) 디자인

큰 제목과 모든 소제목은 예외 없이 동일한 스타일을 쓴다 - 크기로 위계를 주지 않는다.

```html
<h2 style="font-family:inherit;font-size:inherit;font-weight:700;color:#1A1A1A;background:#F8F7F4;border-top:3px solid #171717;border-bottom:1px solid #D8D8D8;margin:32px 0 16px;padding:10px 14px;">제목 텍스트</h2>
```

- `font-family`/`font-size`는 반드시 `inherit` - 티스토리 본문 폰트·크기를 그대로 물려받아 제목만 튀지 않게 한다.
- 위계는 `font-weight:700` 하나로만 준다.
- 위쪽 선 3px `#171717`(굵고 진함)과 아래쪽 선 1px `#D8D8D8`(얇고 연함)은 굵기·색이 다른 게 확정된 디자인이다 - 통일하지 않는다.

## 표(Table) 규칙

- 표는 항상 `<table>` HTML로 작성한다. **`width:100%`는 절대 쓰지 않는다.**
- 표 전체 최대 너비는 `680px`. 일반 2열 표는 `620px`를 우선 적용한다.
- 모바일 대응으로 `max-width:calc(100vw - 40px)`를 같이 건다.
- 표가 실제로 넘칠 때만(열이 많거나 셀 내용이 길 때) 바깥 `<div>`에 `overflow-x:auto`를 걸어 가로 스크롤을 허용한다. 안 넘치는 표에 스크롤 컨테이너를 습관적으로 씌우지 않는다.
- 열 비율은 `<colgroup>`으로 지정한다. 각 `<td>`에 개별 width를 흩어 넣지 않는다.

기본 템플릿(2열 표, 620px 우선):

```html
<div style="max-width:680px;overflow-x:auto;">
  <table style="width:620px;max-width:calc(100vw - 40px);border-collapse:collapse;font-family:inherit;font-size:inherit;">
    <colgroup>
      <col style="width:50%;">
      <col style="width:50%;">
    </colgroup>
    <thead>
      <tr>
        <th style="background:#F8F7F4;color:#1A1A1A;font-weight:700;border-top:3px solid #171717;border-bottom:1px solid #D8D8D8;padding:8px 10px;text-align:left;">항목</th>
        <th style="background:#F8F7F4;color:#1A1A1A;font-weight:700;border-top:3px solid #171717;border-bottom:1px solid #D8D8D8;padding:8px 10px;text-align:left;">내용</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="border-bottom:1px solid #D8D8D8;padding:8px 10px;">-</td>
        <td style="border-bottom:1px solid #D8D8D8;padding:8px 10px;">-</td>
      </tr>
    </tbody>
  </table>
</div>
```

열이 2개보다 많으면 `<colgroup>`의 `<col>` 개수·비율만 조정한다. 표 최대폭(680px)과 헤더 스타일(배경/글자색/위아래 선)은 열 수와 무관하게 그대로 유지한다.

### 투자 주체 표

개인·외국인·기관 등 투자 주체별 순매수·매매 동향을 담는 표는 **제목(첫 헤더 셀 또는 캡션)을 반드시 "오늘의 행동"으로 쓴다.** "오늘의 수급", "투자자 동향" 등 다른 표현으로 바꾸지 않는다.

## 출력 전 검수 체크리스트

포스팅 HTML을 출력하기 전에 반드시 확인한다:

1. 깨진 문자(인코딩 깨짐, `�` 등)나 의도치 않은 반복 문자가 없는지
2. 모든 제목(h2)이 위 스타일 그대로 통일돼 있는지(크기·굵기 차이 없는지)
3. 표에 `width:100%`가 없는지, `colgroup` 비율이 실제 열 수와 맞는지
4. 투자 주체 표 제목이 정확히 "오늘의 행동"인지
5. `skin.html`/`style.css`를 건드리지 않았는지 - 이 스킬은 포스트 본문 HTML만 다룬다

## 절차

1. 대상 글의 내용(기존 글 재구성 또는 신규 리포트)을 정리한다.
2. 소제목 단위를 나누고 위 H2 템플릿을 그대로 적용한다.
3. 표가 필요하면 위 표 템플릿을 열 개수에 맞게 조정한다.
4. 검수 체크리스트를 확인한다.
5. 결과를 티스토리 HTML 편집기에 바로 붙여넣을 수 있는 완전한 HTML 코드 블록 하나로 출력한다. 코드 블록 앞뒤 설명은 최소화한다.
