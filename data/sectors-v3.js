/**
 * 커스텀 섹터 분류 v3 (섹터분류_취합본.xlsx "섹터분류_리스트" 시트 기준, 37개 섹터)
 * v2와 달리 각 종목이 { name, code, market } 객체라서 krx_map.js 없이도 코드 조회가 된다.
 * (market: "KOSPI" | "KOSDAQ")
 * 일부 종목은 의도적으로 여러 섹터에 중복 포함됨 — 중복 제거 금지.
 * sector-dashboard-v4.js보다 먼저 <script>로 로드되어야 함.
 * 2026-07-20: "반도체" 섹터 추가 - 기존 "반도체부품소재/공정"은 장비·소재 공급망
 * 업체들만 있고 실제 칩 제조사(삼성전자/SK하이닉스)가 어느 업종에도 안 잡혀 있던
 * 걸 발견해서(둘 다 "코스피 3대장"에만 있었음, 이건 업종이 아니라 시총 큐레이션
 * 그룹이라 js/foreign-flow.js가 업종 배지에서 제외함) 추가함.
 */
window.SECTOR_MAP = {
  "코스피 3대장": [
    { name: "SK하이닉스", code: "000660", market: "KOSPI" },
    { name: "현대차", code: "005380", market: "KOSPI" },
    { name: "삼성전자", code: "005930", market: "KOSPI" }
  ],
  "IT/스테이블코인": [
    { name: "NAVER", code: "035420", market: "KOSPI" },
    { name: "카카오", code: "035720", market: "KOSPI" },
    { name: "카카오페이", code: "377300", market: "KOSPI" },
    { name: "NHN KCP", code: "060250", market: "KOSDAQ" },
    { name: "다날", code: "064260", market: "KOSDAQ" }
  ],
  "제약/바이오": [
    { name: "파마리서치", code: "214450", market: "KOSDAQ" },
    { name: "한올바이오파마", code: "009420", market: "KOSPI" },
    { name: "리가켐바이오", code: "141080", market: "KOSDAQ" },
    { name: "에이비엘바이오", code: "298380", market: "KOSDAQ" },
    { name: "삼성에피스홀딩스", code: "0126Z0", market: "KOSPI" },
    { name: "알테오젠", code: "196170", market: "KOSDAQ" },
    { name: "한미약품", code: "128940", market: "KOSPI" },
    { name: "휴젤", code: "145020", market: "KOSDAQ" },
    { name: "셀트리온", code: "068270", market: "KOSPI" },
    { name: "유한양행", code: "000100", market: "KOSPI" },
    { name: "SK바이오팜", code: "326030", market: "KOSPI" },
    { name: "삼성바이오로직스", code: "207940", market: "KOSPI" },
    { name: "큐리언트", code: "115180", market: "KOSDAQ" },
    { name: "오름테라퓨틱", code: "475830", market: "KOSDAQ" },
    { name: "삼천당제약", code: "000250", market: "KOSDAQ" },
    { name: "현대약품", code: "004310", market: "KOSPI" },
    { name: "알지노믹스", code: "476830", market: "KOSDAQ" }
  ],
  "반도체": [
    { name: "삼성전자", code: "005930", market: "KOSPI" },
    { name: "SK하이닉스", code: "000660", market: "KOSPI" }
  ],
  "반도체부품소재/공정": [
    { name: "한미반도체", code: "042700", market: "KOSPI" },
    { name: "HPSP", code: "403870", market: "KOSDAQ" },
    { name: "이수페타시스", code: "007660", market: "KOSPI" },
    { name: "리노공업", code: "058470", market: "KOSDAQ" },
    { name: "솔브레인", code: "357780", market: "KOSDAQ" },
    { name: "동진쎄미켐", code: "005290", market: "KOSDAQ" },
    { name: "원익IPS", code: "240810", market: "KOSDAQ" },
    { name: "테크윙", code: "089030", market: "KOSDAQ" },
    { name: "대덕전자", code: "353200", market: "KOSPI" },
    { name: "삼성전기", code: "009150", market: "KOSPI" },
    { name: "ISC", code: "095340", market: "KOSDAQ" },
    { name: "고영", code: "098460", market: "KOSDAQ" },
    { name: "대주전자재료", code: "078600", market: "KOSDAQ" },
    { name: "제주반도체", code: "080220", market: "KOSDAQ" },
    { name: "이오테크닉스", code: "039030", market: "KOSDAQ" },
    { name: "주성엔지니어링", code: "036930", market: "KOSDAQ" }
  ],
  "2차전지": [
    { name: "LG에너지솔루션", code: "373220", market: "KOSPI" },
    { name: "삼성SDI", code: "006400", market: "KOSPI" },
    { name: "SK이노베이션", code: "096770", market: "KOSPI" },
    { name: "LG화학", code: "051910", market: "KOSPI" },
    { name: "포스코퓨처엠", code: "003670", market: "KOSPI" },
    { name: "에코프로비엠", code: "247540", market: "KOSDAQ" },
    { name: "에코프로", code: "086520", market: "KOSDAQ" },
    { name: "에코프로머티", code: "450080", market: "KOSPI" },
    { name: "엘앤에프", code: "066970", market: "KOSPI" }
  ],
  "전력/에너지": [
    { name: "한국전력", code: "015760", market: "KOSPI" },
    { name: "HD현대일렉트릭", code: "267260", market: "KOSPI" },
    { name: "LS ELECTRIC", code: "010120", market: "KOSPI" },
    { name: "효성중공업", code: "298040", market: "KOSPI" },
    { name: "두산에너빌리티", code: "034020", market: "KOSPI" },
    { name: "한전기술", code: "052690", market: "KOSPI" },
    { name: "LS", code: "006260", market: "KOSPI" },
    { name: "일진전기", code: "103590", market: "KOSPI" },
    { name: "산일전기", code: "062040", market: "KOSPI" },
    { name: "제룡전기", code: "033100", market: "KOSDAQ" },
    { name: "대한전선", code: "001440", market: "KOSPI" },
    { name: "가온전선", code: "000500", market: "KOSPI" },
    { name: "LS에코에너지", code: "229640", market: "KOSPI" },
    { name: "HD현대에너지솔루션", code: "322000", market: "KOSPI" },
    { name: "한전KPS", code: "051600", market: "KOSPI" },
    { name: "삼천리", code: "004690", market: "KOSPI" },
    { name: "지역난방공사", code: "071320", market: "KOSPI" }
  ],
  "신재생/원자력": [
    { name: "두산에너빌리티", code: "034020", market: "KOSPI" },
    { name: "한전기술", code: "052690", market: "KOSPI" },
    { name: "우진", code: "105840", market: "KOSPI" },
    { name: "우리기술", code: "032820", market: "KOSDAQ" },
    { name: "씨에스윈드", code: "112610", market: "KOSPI" },
    { name: "OCI", code: "456040", market: "KOSPI" },
    { name: "한화솔루션", code: "009830", market: "KOSPI" },
    { name: "두산퓨얼셀", code: "336260", market: "KOSPI" },
    { name: "비에이치아이", code: "083650", market: "KOSDAQ" },
    { name: "SK이터닉스", code: "475150", market: "KOSPI" },
    { name: "일진파워", code: "094820", market: "KOSDAQ" }
  ],
  "로봇": [
    { name: "레인보우로보틱스", code: "277810", market: "KOSDAQ" },
    { name: "두산로보틱스", code: "454910", market: "KOSPI" },
    { name: "로보티즈", code: "108490", market: "KOSDAQ" },
    { name: "포스코DX", code: "022100", market: "KOSPI" },
    { name: "엔젤로보틱스", code: "455900", market: "KOSDAQ" },
    { name: "유일로보틱스", code: "388720", market: "KOSDAQ" },
    { name: "에스피지", code: "058610", market: "KOSDAQ" },
    { name: "뉴로메카", code: "348340", market: "KOSDAQ" }
  ],
  "자동차": [
    { name: "현대차", code: "005380", market: "KOSPI" },
    { name: "기아", code: "000270", market: "KOSPI" },
    { name: "현대모비스", code: "012330", market: "KOSPI" },
    { name: "현대위아", code: "011210", market: "KOSPI" },
    { name: "HL만도", code: "204320", market: "KOSPI" },
    { name: "한온시스템", code: "018880", market: "KOSPI" },
    { name: "현대글로비스", code: "086280", market: "KOSPI" },
    { name: "한국타이어앤테크놀로지", code: "161390", market: "KOSPI" }
  ],
  "조선사": [
    { name: "HD한국조선해양", code: "009540", market: "KOSPI" },
    { name: "HD현대중공업", code: "329180", market: "KOSPI" },
    { name: "삼성중공업", code: "010140", market: "KOSPI" },
    { name: "한화오션", code: "042660", market: "KOSPI" },
    { name: "HD현대마린솔루션", code: "443060", market: "KOSPI" },
    { name: "SK오션플랜트", code: "100090", market: "KOSPI" },
    { name: "현대힘스", code: "460930", market: "KOSDAQ" },
    { name: "HJ중공업", code: "097230", market: "KOSPI" },
    { name: "세진중공업", code: "075580", market: "KOSPI" },
    { name: "한국카본", code: "017960", market: "KOSPI" },
    { name: "동성화인텍", code: "033500", market: "KOSDAQ" },
    { name: "대양전기공업", code: "108380", market: "KOSDAQ" }
  ],
  "우주항공": [
    { name: "한국항공우주", code: "047810", market: "KOSPI" },
    { name: "한화에어로스페이스", code: "012450", market: "KOSPI" },
    { name: "쎄트렉아이", code: "099320", market: "KOSDAQ" },
    { name: "에이치브이엠", code: "295310", market: "KOSDAQ" },
    { name: "나라스페이스테크놀로지", code: "478340", market: "KOSDAQ" },
    { name: "이노스페이스", code: "462350", market: "KOSDAQ" }
  ],
  "방위산업": [
    { name: "한화에어로스페이스", code: "012450", market: "KOSPI" },
    { name: "LIG디펜스앤에어로스페이스", code: "079550", market: "KOSPI" },
    { name: "한화시스템", code: "272210", market: "KOSPI" },
    { name: "현대로템", code: "064350", market: "KOSPI" },
    { name: "풍산", code: "103140", market: "KOSPI" }
  ],
  "건설": [
    { name: "현대건설", code: "000720", market: "KOSPI" },
    { name: "삼성물산", code: "028260", market: "KOSPI" },
    { name: "대우건설", code: "047040", market: "KOSPI" },
    { name: "GS건설", code: "006360", market: "KOSPI" },
    { name: "DL이앤씨", code: "375500", market: "KOSPI" },
    { name: "HDC현대산업개발", code: "294870", market: "KOSPI" }
  ],
  "건설기계": [
    { name: "HD현대건설기계", code: "267270", market: "KOSPI" },
    { name: "HD현대인프라코어", code: "042670", market: "KOSPI" },
    { name: "두산밥캣", code: "241560", market: "KOSPI" }
  ],
  "금융": [
    { name: "KB금융", code: "105560", market: "KOSPI" },
    { name: "신한지주", code: "055550", market: "KOSPI" },
    { name: "하나금융지주", code: "086790", market: "KOSPI" },
    { name: "우리금융지주", code: "316140", market: "KOSPI" },
    { name: "메리츠금융지주", code: "138040", market: "KOSPI" },
    { name: "카카오뱅크", code: "323410", market: "KOSPI" }
  ],
  "증권": [
    { name: "키움증권", code: "039490", market: "KOSPI" },
    { name: "미래에셋증권", code: "006800", market: "KOSPI" },
    { name: "NH투자증권", code: "005940", market: "KOSPI" },
    { name: "삼성증권", code: "016360", market: "KOSPI" },
    { name: "한국금융지주", code: "071050", market: "KOSPI" },
    { name: "대신증권", code: "003540", market: "KOSPI" }
  ],
  "보험": [
    { name: "삼성화재", code: "000810", market: "KOSPI" },
    { name: "DB손해보험", code: "005830", market: "KOSPI" },
    { name: "현대해상", code: "001450", market: "KOSPI" },
    { name: "한화손해보험", code: "000370", market: "KOSPI" },
    { name: "삼성생명", code: "032830", market: "KOSPI" },
    { name: "한화생명", code: "088350", market: "KOSPI" },
    { name: "동양생명", code: "082640", market: "KOSPI" },
    { name: "미래에셋생명", code: "085620", market: "KOSPI" }
  ],
  "K뷰티": [
    { name: "에이피알", code: "278470", market: "KOSPI" },
    { name: "LG생활건강", code: "051900", market: "KOSPI" },
    { name: "아모레퍼시픽", code: "090430", market: "KOSPI" },
    { name: "달바글로벌", code: "483650", market: "KOSPI" },
    { name: "실리콘투", code: "257720", market: "KOSDAQ" },
    { name: "코스맥스", code: "192820", market: "KOSPI" },
    { name: "한국콜마", code: "161890", market: "KOSPI" },
    { name: "브이티", code: "018290", market: "KOSDAQ" },
    { name: "펌텍코리아", code: "251970", market: "KOSDAQ" }
  ],
  "항공": [
    { name: "대한항공", code: "003490", market: "KOSPI" },
    { name: "진에어", code: "272450", market: "KOSPI" },
    { name: "제주항공", code: "089590", market: "KOSPI" },
    { name: "아시아나항공", code: "020560", market: "KOSPI" }
  ],
  "해운물류": [
    { name: "HMM", code: "011200", market: "KOSPI" },
    { name: "팬오션", code: "028670", market: "KOSPI" },
    { name: "대한해운", code: "005880", market: "KOSPI" },
    { name: "흥아해운", code: "003280", market: "KOSPI" },
    { name: "KSS해운", code: "044450", market: "KOSPI" },
    { name: "STX그린로지스", code: "465770", market: "KOSPI" },
    { name: "태웅로직스", code: "124560", market: "KOSDAQ" },
    { name: "세방", code: "004360", market: "KOSPI" }
  ],
  "택배": [
    { name: "CJ대한통운", code: "000120", market: "KOSPI" },
    { name: "한진", code: "002320", market: "KOSPI" }
  ],
  "SI": [
    { name: "삼성에스디에스", code: "018260", market: "KOSPI" },
    { name: "LG씨엔에스", code: "064400", market: "KOSPI" },
    { name: "현대오토에버", code: "307950", market: "KOSPI" },
    { name: "포스코DX", code: "022100", market: "KOSPI" },
    { name: "롯데이노베이트", code: "286940", market: "KOSPI" },
    { name: "신세계I&C", code: "035510", market: "KOSPI" }
  ],
  "통신": [
    { name: "SK텔레콤", code: "017670", market: "KOSPI" },
    { name: "KT", code: "030200", market: "KOSPI" },
    { name: "LG유플러스", code: "032640", market: "KOSPI" }
  ],
  "통신장비": [
    { name: "서진시스템", code: "178320", market: "KOSDAQ" },
    { name: "RFHIC", code: "218410", market: "KOSDAQ" },
    { name: "케이엠더블유", code: "032500", market: "KOSDAQ" }
  ],
  "디스플레이": [
    { name: "LG디스플레이", code: "034220", market: "KOSPI" },
    { name: "LG이노텍", code: "011070", market: "KOSPI" },
    { name: "LX세미콘", code: "108320", market: "KOSPI" }
  ],
  "게임": [
    { name: "크래프톤", code: "259960", market: "KOSPI" },
    { name: "시프트업", code: "462870", market: "KOSPI" },
    { name: "넷마블", code: "251270", market: "KOSPI" },
    { name: "NC", code: "036570", market: "KOSPI" },
    { name: "펄어비스", code: "263750", market: "KOSDAQ" },
    { name: "카카오게임즈", code: "293490", market: "KOSDAQ" }
  ],
  "연예기획사": [
    { name: "하이브", code: "352820", market: "KOSPI" },
    { name: "JYP Ent.", code: "035900", market: "KOSDAQ" },
    { name: "에스엠", code: "041510", market: "KOSDAQ" },
    { name: "와이지엔터테인먼트", code: "122870", market: "KOSDAQ" }
  ],
  "식품": [
    { name: "CJ제일제당", code: "097950", market: "KOSPI" },
    { name: "삼양식품", code: "003230", market: "KOSPI" },
    { name: "KT&G", code: "033780", market: "KOSPI" },
    { name: "농심", code: "004370", market: "KOSPI" },
    { name: "오리온", code: "271560", market: "KOSPI" },
    { name: "오뚜기", code: "007310", market: "KOSPI" },
    { name: "롯데웰푸드", code: "280360", market: "KOSPI" },
    { name: "대상", code: "001680", market: "KOSPI" }
  ],
  "석유/정유": [
    { name: "S-Oil", code: "010950", market: "KOSPI" },
    { name: "SK이노베이션", code: "096770", market: "KOSPI" },
    { name: "GS", code: "078930", market: "KOSPI" }
  ],
  "화학": [
    { name: "LG화학", code: "051910", market: "KOSPI" },
    { name: "롯데케미칼", code: "011170", market: "KOSPI" },
    { name: "금호석유화학", code: "011780", market: "KOSPI" },
    { name: "한솔케미칼", code: "014680", market: "KOSPI" },
    { name: "SKC", code: "011790", market: "KOSPI" }
  ],
  "철강/제련": [
    { name: "POSCO홀딩스", code: "005490", market: "KOSPI" },
    { name: "현대제철", code: "004020", market: "KOSPI" },
    { name: "고려아연", code: "010130", market: "KOSPI" },
    { name: "동국제강", code: "460860", market: "KOSPI" },
    { name: "영풍", code: "000670", market: "KOSPI" },
    { name: "풍산", code: "103140", market: "KOSPI" }
  ],
  "생활가전": [
    { name: "LG전자", code: "066570", market: "KOSPI" },
    { name: "코웨이", code: "021240", market: "KOSPI" },
    { name: "경동나비엔", code: "009450", market: "KOSPI" },
    { name: "쿠쿠홀딩스", code: "192400", market: "KOSPI" }
  ],
  "백화점/대형마트": [
    { name: "롯데쇼핑", code: "023530", market: "KOSPI" },
    { name: "신세계", code: "004170", market: "KOSPI" },
    { name: "현대백화점", code: "069960", market: "KOSPI" },
    { name: "이마트", code: "139480", market: "KOSPI" }
  ],
  "면세/카지노": [
    { name: "호텔신라", code: "008770", market: "KOSPI" },
    { name: "파라다이스", code: "034230", market: "KOSPI" }
  ],
  "리츠": [
    { name: "맥쿼리인프라", code: "088980", market: "KOSPI" },
    { name: "SK리츠", code: "395400", market: "KOSPI" },
    { name: "롯데리츠", code: "330590", market: "KOSPI" },
    { name: "한화리츠", code: "451800", market: "KOSPI" },
    { name: "삼성FN리츠", code: "448730", market: "KOSPI" }
  ],
  "지주사": [
    { name: "SK", code: "034730", market: "KOSPI" },
    { name: "LG", code: "003550", market: "KOSPI" },
    { name: "POSCO홀딩스", code: "005490", market: "KOSPI" },
    { name: "삼성물산", code: "028260", market: "KOSPI" },
    { name: "HD현대", code: "267250", market: "KOSPI" },
    { name: "한화", code: "000880", market: "KOSPI" },
    { name: "두산", code: "000150", market: "KOSPI" },
    { name: "GS", code: "078930", market: "KOSPI" },
    { name: "CJ", code: "001040", market: "KOSPI" },
    { name: "LS", code: "006260", market: "KOSPI" },
    { name: "효성", code: "004800", market: "KOSPI" },
    { name: "롯데지주", code: "004990", market: "KOSPI" },
    { name: "한진칼", code: "180640", market: "KOSPI" },
    { name: "KCC", code: "002380", market: "KOSPI" },
    { name: "코오롱", code: "002020", market: "KOSPI" },
    { name: "HDC", code: "012630", market: "KOSPI" },
    { name: "한국앤컴퍼니", code: "000240", market: "KOSPI" },
    { name: "대웅", code: "003090", market: "KOSPI" },
    { name: "현대엘리베이터", code: "017800", market: "KOSPI" }
  ]
};
