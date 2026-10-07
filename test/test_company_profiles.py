"""Static business introduction extraction and browser loading."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import build_company_profiles as builder


class CompanyProfilesTests(unittest.TestCase):
    def test_business_is_preferred_to_history_and_earnings(self):
        html = '''<ul class="cmp_comment"><li>동사는 1999년에 설립되었음.</li>
          <li>동사는 반도체 장비를 제조하고 주요 제품을 판매하고 있음.</li>
          <li>전년동기 영업이익이 감소했으나 제품 매출액은 증가함.</li></ul>'''
        self.assertEqual(builder.parse_summary(html), '반도체 장비를 제조하고 주요 제품을 판매하고 있음.')

    def test_bank_and_holding_businesses_are_supported(self):
        for text in ('동사는 예금 수입과 자금 대출 등 은행 업무를 수행함.',
                     '우리자산운용 등 다양한 금융 계열사를 운영하고 있음.'):
            self.assertTrue(builder.parse_summary('<ul class="cmp_comment"><li>' + text + '</li></ul>'))

    def test_markup_scripts_and_self_closing_void_tags(self):
        html = '<div><br/><ul class="other"><li>가짜 사업 설명</li></ul></div>'
        html += '<ul class="cmp_comment"><li>동사는 <b>산업용 장비</b>를 제조하며<br/><script>fake()</script>제품을 판매함.</li></ul>'
        summary = builder.parse_summary(html)
        self.assertIn('산업용 장비', summary)
        self.assertNotIn('<', summary)
        self.assertNotIn('fake', summary)
        self.assertNotIn('가짜', summary)

    def test_missing_business_is_not_invented(self):
        self.assertIsNone(builder.parse_summary('<ul class="cmp_comment"><li>동사는 1999년에 설립되었음.</li></ul>'))
        self.assertIsNone(builder.parse_summary('<html>Access denied</html>'))

    def test_excerpts_are_bounded(self):
        text = '제품 판매 서비스 ' * 100
        result = builder.brief(text.strip())
        self.assertLessEqual(len(result.split()), 25)
        self.assertLessEqual(len(result), 181)
        self.assertTrue(result.endswith('…'))

    def test_safe_code_only(self):
        for code in ('../../x', '005930&evil=1', 'http://x', '00593'):
            with self.assertRaises(ValueError):
                builder.source_url(code)
        self.assertTrue(builder.source_url('005930').endswith('005930'))

    def test_preferred_alias_and_non_company_products(self):
        stocks = {'삼성전자': '005930', '삼성전자우': '005935', '현대차': '005380',
                  '현대차2우B': '005387', 'ETF상품': '000001', '증권ETN': '000002',
                  '기업스팩': '000003', '기업인수목적': '000004'}
        with tempfile.TemporaryDirectory() as temp:
            file = pathlib.Path(temp) / 'universe.js'
            file.write_text('window.KRX_MAP=' + json.dumps(stocks) + ';\nwindow.KRX_ETF_NAMES=["ETF상품"];', encoding='utf-8')
            targets, aliases = builder.load_universe(file)
        self.assertEqual(len(targets), 2)
        self.assertEqual(aliases['005935'], '005930')
        self.assertEqual(aliases['005387'], '005380')
        self.assertEqual(len(aliases), 4)

    def test_actual_browser_static_load_dedup_and_stale_response(self):
        script = r'''
const fs=require('fs'), vm=require('vm'), assert=require('assert');
let src=fs.readFileSync('js/foreign-flow.js','utf8');
src=src.replace('global.ForeignFlow =', 'global.__profileTest={ensureCompanyProfiles,fetchCompanyProfile,buildCompanyProfilePlaceholder,loadCompanyProfile}; global.ForeignFlow =');
let appended=[];
const win={addEventListener(){}};
const doc={readyState:'loading',addEventListener(){},createElement(){return {}},head:{appendChild(s){appended.push(s);}}};
const ctx={window:win,document:doc,console,fetch(){throw new Error('Unexpected API call');},setTimeout,clearTimeout};
vm.runInNewContext(src,ctx);
const api=win.__profileTest;
(async()=>{
 const a=api.fetchCompanyProfile('005930'), b=api.fetchCompanyProfile('005935');
 assert.equal(appended.length,1);
 assert(appended[0].src.endsWith('/data/company-profiles.js'));
 win.COMPANY_PROFILES={asOf:'2026-10-07',companies:{'005930':{summary:'반도체를 제조합니다.',sourceCode:'005930'},'005935':{summary:'반도체를 제조합니다.',sourceCode:'005930'}}};
 appended[0].onload();
 assert.equal((await a).summary,(await b).summary);
 await api.fetchCompanyProfile('005930');
 assert.equal(appended.length,1);
 const mount={textContent:'new stock text'}, meta={textContent:''}, link={href:''};
 let attached=false;
 const box={querySelector(sel){return sel.includes('summary')?mount:sel.includes('meta')?meta:link;},contains(){return attached;},closest(){return null;}};
 api.loadCompanyProfile(box,'005930');
 await new Promise(setImmediate);
 assert.equal(mount.textContent,'new stock text');
 attached=true;
 api.loadCompanyProfile(box,'005935');
 await new Promise(setImmediate);
 assert.equal(mount.textContent,'반도체를 제조합니다.');
 assert(link.href.endsWith('005930'));
 assert(meta.textContent.includes('2026-10-07'));
 assert.equal(api.buildCompanyProfilePlaceholder('invalid'),'');
 const missing=await api.fetchCompanyProfile('000001');
 assert.equal(missing.available,false);
})().catch(e=>{console.error(e);process.exitCode=1;});
'''
        result = subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
