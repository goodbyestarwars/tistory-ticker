import json,io,sys,statistics
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
S=json.load(open('C:/Users/goodb/AppData/Local/Temp/bt_full.json.signals.json',encoding='utf-8'))
C=0.004
dates=sorted({s['date'] for s in S}); mid=dates[len(dates)//2]
def stats(rows):
    r=[x['ret10']-C for x in rows if x.get('ret10') is not None]
    if not r: return None
    return (len(r), sum(r)/len(r), statistics.median(r), sum(1 for v in r if v>0)/len(r))
base={h:stats([s for s in S if s['scanner']=='BASELINE' and ((s['date']<mid)==(h=='H1'))]) for h in ('H1','H2')}
print('mid',mid,'baseline',{h:('n%d avg%+.1f med%+.1f win%.0f'%(b[0],b[1]*100,b[2]*100,b[3]*100)) for h,b in base.items()})
def show(name,pred,sc):
    out=[]
    for h in ('H1','H2'):
        rows=[s for s in S if s['scanner']==sc and pred(s) and ((s['date']<mid)==(h=='H1'))]
        st=stats(rows)
        out.append('%s n%d avg%+.1f(edge%+.1f) med%+.1f win%.0f'%(h,st[0],st[1]*100,(st[1]-base[h][1])*100,st[2]*100,st[3]*100) if st else h+' none')
    print('%-46s'%name,' | '.join(out))
show('shortMA all',lambda s:True,'shortTermMaBreakout')
show('shortMA score>=90',lambda s:(s['score'] or 0)>=90,'shortTermMaBreakout')
show('shortMA closePos>=0.85',lambda s:s.get('closePosition',0)>=0.85,'shortTermMaBreakout')
show('shortMA volRatio>=1.15',lambda s:s.get('volumeRatio',0)>=1.15,'shortTermMaBreakout')
show('shortMA vol>=1.15 & closePos>=.63',lambda s:s.get('volumeRatio',0)>=1.15 and s.get('closePosition',0)>=0.63,'shortTermMaBreakout')
show('maCloud all',lambda s:True,'maCloudBreakout')
show('maCloud score>=80',lambda s:(s['score'] or 0)>=80,'maCloudBreakout')
show('dblBottom all',lambda s:True,'doubleBottom')
show('dblBottom necklineDist>-11',lambda s:s.get('necklineDistancePct',-99)>-11,'doubleBottom')
show('dblBottom rebound<19',lambda s:s.get('reboundPct',0)<19,'doubleBottom')
show('dblBottom both',lambda s:s.get('necklineDistancePct',-99)>-11 and s.get('reboundPct',0)<19,'doubleBottom')
show('dblBottom score<90',lambda s:(s['score'] or 0)<90,'doubleBottom')
show('IHS all',lambda s:True,'invHeadShoulders')
show('IHS score>=80',lambda s:(s['score'] or 0)>=80,'invHeadShoulders')
show('box all',lambda s:True,'boxRangeLow')
show('box REBOUND',lambda s:s.get('status')=='REBOUND','boxRangeLow')
show('pullback all',lambda s:True,'pullback')
show('pullback score<90',lambda s:(s['score'] or 0)<90,'pullback')
show('pullback rise<30',lambda s:s.get('risePct',99)<30,'pullback')
show('pullback rise<30&slope<3.58',lambda s:s.get('risePct',99)<30 and s.get('ma20Slope5Pct',0)<3.58,'pullback')
show('angle all',lambda s:True,'angleMomentum')
show('angle score>=90',lambda s:(s['score'] or 0)>=90,'angleMomentum')
show('angle score>=90 & gap<2%',lambda s:(s['score'] or 0)>=90 and (s.get('gap') or 0)<0.02,'angleMomentum')
show('angle gap<2%',lambda s:(s.get('gap') or 0)<0.02,'angleMomentum')
show('ALL gap>=2% (any scanner)',lambda s:(s.get('gap') or 0)>=0.02,'angleMomentum')
