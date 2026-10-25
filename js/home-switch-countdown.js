    // ---- 국내/미국 정규장 마감 카운트다운 ----
    (function setupHomeSwitchCountdown() {
      var el = null, labelEl = null, units = {}, lastDigits = {};

      function mount() {
        // skin-main.js renders the dashboard asynchronously and may replace its
        // innerHTML after this deferred module has already mounted. Recreate the
        // node if that render detached it from the document.
        if (el && el.isConnected) return;
        el = null;
        labelEl = null;
        units = {};
        el = document.createElement('div');
        el.className = 'home-switch-countdown';
        el.hidden = true;
        el.setAttribute('role', 'timer');
        el.setAttribute('aria-live', 'off');
        document.body.appendChild(el);
        el.innerHTML = '<span class="hsc-label"></span><div class="hsc-clock" aria-hidden="true">'
          + ['일', '시간', '분', '초'].map(function (unit, index) {
            return '<span class="hsc-unit"><span class="hsc-digits" data-hsc-unit="' + index + '">'
              + '<span class="hsc-digit"><span class="hsc-face hsc-face-top"><span>0</span></span><span class="hsc-face hsc-face-bottom"><span>0</span></span></span>'
              + '<span class="hsc-digit"><span class="hsc-face hsc-face-top"><span>0</span></span><span class="hsc-face hsc-face-bottom"><span>0</span></span></span></span><small>' + unit + '</small></span>';
          }).join('<span class="hsc-separator">:</span>') + '</div>';
        var switchTabs = document.querySelector('.home-market-switch');
        var dashboard = switchTabs && switchTabs.closest('.home-dashboard');
        try {
        if (dashboard && switchTabs) {
          var toolbar = dashboard.querySelector('.home-market-toolbar');
          if (!toolbar) {
            toolbar = document.createElement('div');
            toolbar.className = 'home-market-toolbar';
            dashboard.insertBefore(toolbar, switchTabs);
            toolbar.appendChild(switchTabs);
          }
          toolbar.appendChild(el);
        }
        } catch (error) { /* 카운트다운 자체는 툴바 배치 실패와 관계없이 표시한다. */ }
        labelEl = el.querySelector('.hsc-label');
        el.querySelectorAll('[data-hsc-unit]').forEach(function (node) {
          units[node.getAttribute('data-hsc-unit')] = node;
        });
      }

      function updateUnit(index, value) {
        var pair = units[index];
        if (!pair) return;
        var digits = String(value).padStart(2, '0');
        var old = lastDigits[index];
        if (old === digits) return;
        // 첫 렌더에서는 애니메이션 없이 현재 숫자를 면에 직접 넣는다.
        // old가 없을 때 각 자릿수의 oldDigit을 nextDigit으로 두면 아래 비교가
        // 항상 같아져 초기값(예: 1일, 15시간)이 기본 00으로 남는다.
        if (!old) {
          pair.querySelectorAll('.hsc-digit').forEach(function (digit, i) {
            var valueDigit = digits.charAt(i);
            digit.querySelectorAll('.hsc-face > span').forEach(function (face) {
              face.textContent = valueDigit;
            });
          });
          lastDigits[index] = digits;
          return;
        }
        pair.querySelectorAll('.hsc-digit').forEach(function (digit, i) {
          var nextDigit = digits.charAt(i);
          var oldDigit = old.charAt(i);
          if (oldDigit === nextDigit) return;
          if (old) {
            var top = digit.querySelector('.hsc-face-top');
            var bottom = digit.querySelector('.hsc-face-bottom');
            var topFlap = document.createElement('span');
            topFlap.className = 'hsc-flap hsc-flap-top';
            topFlap.innerHTML = '<span>' + oldDigit + '</span>';
            var bottomFlap = document.createElement('span');
            bottomFlap.className = 'hsc-flap hsc-flap-bottom';
            bottomFlap.innerHTML = '<span>' + nextDigit + '</span>';
            digit.appendChild(topFlap);
            digit.appendChild(bottomFlap);
            digit.classList.add('is-flipping');
            window.setTimeout(function () {
              top.querySelector('span').textContent = nextDigit;
              bottom.querySelector('span').textContent = nextDigit;
              digit.classList.remove('is-flipping');
              topFlap.remove();
              bottomFlap.remove();
            }, 440);
          } else {
            digit.querySelectorAll('.hsc-face > span').forEach(function (face) { face.textContent = nextDigit; });
          }
        });
        lastDigits[index] = digits;
      }

      function nextDomesticClose(now, marketHours) {
        if (!marketHours || !marketHours.kst || !marketHours.isKrTradingDay) return null;
        var k = marketHours.kst(new Date(now));
        var today = Date.UTC(k.year, Number(k.dateKey.slice(4, 6)) - 1, Number(k.dateKey.slice(6)));
        for (var day = 0; day < 15; day++) {
          // UTC 자정은 KST 정규장 개장(09:00)이다. 휴장일은 MarketHours 달력을 따른다.
          var openAt = today + day * 86400000;
          // openAt은 UTC 자정(한국 09:00)이므로 종가 15:30까지 6시간 30분이다.
          var closeAt = openAt + (6 * 60 + 30) * 60 * 1000;
          if (closeAt <= now || !marketHours.isKrTradingDay(new Date(openAt))) continue;
          return closeAt;
        }
        return null;
      }

      function nextDomesticOpen(now, marketHours) {
        if (!marketHours || typeof marketHours.nextKrRegularOpen !== 'function') return null;
        var open = marketHours.nextKrRegularOpen(new Date(now));
        return open ? open.getTime() : null;
      }

      function nextUsClose(now, marketHours) {
        if (!marketHours || !marketHours.us || !marketHours.isUsHoliday) return null;
        var parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(new Date(now)).reduce(function (out, part) {
          if (part.type !== 'literal') out[part.type] = part.value;
          return out;
        }, {});
        var base = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
        for (var day = 0; day < 15; day++) {
          var dayStart = base + day * 86400000;
          // 16:00Z는 뉴욕의 오전이므로 같은 현지 날짜의 휴일·거래 여부를 확인하기에 안전하다.
          var probe = new Date(dayStart + 16 * 60 * 60 * 1000);
          var weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(probe);
          if (weekday === 'Sat' || weekday === 'Sun' || marketHours.isUsHoliday(probe)) continue;
          var session = marketHours.us(probe);
          if (!session || !session.open) continue;
          var closeHourUtc = (session.earlyClose ? 13 : 16) + (session.dst ? 4 : 5);
          var closeAt = dayStart + closeHourUtc * 60 * 60 * 1000;
          if (closeAt > now) return closeAt;
        }
        return null;
      }

      function nextUsOpen(now, marketHours) {
        if (!marketHours || !marketHours.us || !marketHours.isUsHoliday) return null;
        var parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(new Date(now)).reduce(function (out, part) {
          if (part.type !== 'literal') out[part.type] = part.value;
          return out;
        }, {});
        var base = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
        for (var day = 0; day < 15; day++) {
          var dayStart = base + day * 86400000;
          var probe = new Date(dayStart + 16 * 60 * 60 * 1000);
          var weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(probe);
          if (weekday === 'Sat' || weekday === 'Sun' || marketHours.isUsHoliday(probe)) continue;
          var session = marketHours.us(probe);
          if (!session || !session.open) continue;
          // 09:30 ET: 서머타임은 13:30Z, 표준시는 14:30Z.
          var openAt = dayStart + ((session.dst ? 13 : 14) * 60 + 30) * 60 * 1000;
          if (openAt > now) return openAt;
        }
        return null;
      }

      function tick() {
        var selected = window.HomeMarketSelection && window.HomeMarketSelection.get
          ? window.HomeMarketSelection.get() : 'domestic';
        mount();
        var now = Date.now();
        var marketHours = window.MarketHours;
        if (!marketHours) {
          el.hidden = true;
          return;
        }
        // 휴장 화면은 국내 시장 기준으로 다음 이벤트를 보여준다. 시장 탭을 바꾸면
        // 해당 시장의 정규장 시작/종료 단계로 이어진다.
        var market = selected === 'us' ? 'us' : 'domestic';
        var marketName = market === 'us' ? '미국' : '국내';
        var targetAt = null;
        var targetLabel = '';
        if (market === 'us') {
          var usSession = marketHours && marketHours.us ? marketHours.us(new Date(now)) : null;
          if (usSession && usSession.phase === 'regular') {
            targetAt = nextUsClose(now, marketHours);
            targetLabel = '정규장 종료까지';
          } else {
            var nyParts = new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit',
              hour12: false
            }).formatToParts(new Date(now)).reduce(function (out, part) {
              if (part.type !== 'literal') out[part.type] = part.value;
              return out;
            }, {});
            var nyMinute = (Number(nyParts.hour) % 24) * 60 + Number(nyParts.minute);
            var usTradingDate = nyParts.weekday !== 'Sat' && nyParts.weekday !== 'Sun'
              && !marketHours.isUsHoliday(new Date(now));
            var usCloseMinute = usSession && usSession.earlyClose ? 13 * 60 : 16 * 60;
            if (usTradingDate && nyMinute >= usCloseMinute) {
              targetAt = nextUsClose(now, marketHours);
              targetLabel = '다음 정규장 종료까지';
            } else {
              targetAt = nextUsOpen(now, marketHours);
              targetLabel = '정규장 시작까지';
            }
          }
        } else {
          var kstNow = marketHours && marketHours.kst ? marketHours.kst(new Date(now)) : null;
          var krTradingDay = marketHours && marketHours.isKrTradingDay
            && marketHours.isKrTradingDay(new Date(now));
          var krSession = marketHours && marketHours.krCash
            ? marketHours.krCash(new Date(now)) : null;
          if (krSession && krSession.phase === 'regular') {
            targetAt = nextDomesticClose(now, marketHours);
            targetLabel = '정규장 종료까지';
          } else if (krTradingDay && kstNow && kstNow.minutes >= 15 * 60 + 30) {
            targetAt = nextDomesticClose(now, marketHours);
            targetLabel = '다음 정규장 종료까지';
          } else {
            targetAt = nextDomesticOpen(now, marketHours);
            targetLabel = '정규장 시작까지';
          }
        }
        if (!targetAt || targetAt <= now) {
          el.hidden = true;
          return;
        }
        el.hidden = false;
        el.classList.toggle('hsc-to-us', market === 'us');
        el.classList.toggle('hsc-to-kr', market === 'domestic');
        labelEl.textContent = marketName + ' ' + targetLabel;
        var total = Math.max(0, Math.ceil((targetAt - now) / 1000));
        var days = Math.floor(total / 86400);
        var hours = Math.floor(total / 3600) % 24;
        var minutes = Math.floor(total / 60) % 60;
        var seconds = total % 60;
        updateUnit(0, days);
        updateUnit(1, hours);
        updateUnit(2, minutes);
        updateUnit(3, seconds);
        el.setAttribute('aria-label', marketName + ' ' + targetLabel + ' ' + days + '일 ' + hours + '시간 ' + minutes + '분 ' + seconds + '초');
      }

      tick();
      // 2026-08-21 코드 감사: 다른 60초 타이머(loadHomeIndices)는 이미 document.hidden을
      // 체크하는데 이 1초 카운트다운만 빠져 있었다 - 백그라운드 탭에서도 계속 돌던 걸
      // 통일. 탭이 다시 보이면 그 즉시 최신 상태로 갱신되도록 visibilitychange에서도
      // 한 번 더 tick()을 호출한다.
      setInterval(function () { if (!document.hidden) tick(); }, 1000);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) tick();
      });
      window.addEventListener('home-market-change', tick);
    })();
