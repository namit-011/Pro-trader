import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Tokens ───────────────────────────────────────────────────────────────────
const C = {
    bg:'#050a14', surface:'#080e1a', card:'#0a1628', border:'#1a2744',
    text:'#e2e8f0', muted:'#64748b', dim:'#334155',
    pos:'#22c55e', neg:'#ef4444', warn:'#f59e0b',
    blue:'#3b82f6', purple:'#8b5cf6', cyan:'#06b6d4',
};

const fmtINR = (n) => n==null?'—':'₹'+Math.abs(n).toLocaleString('en-IN',{maximumFractionDigits:0});
const fmtCr  = (n) => n==null?'—':'₹'+(n/1e7).toFixed(1)+' Cr';
const fmtPct = (n) => n==null?'—':(n>=0?'+':'')+n.toFixed(2)+'%';
const fmtNum = (n,d=1) => n==null?'—':n.toFixed(d);
const pos    = (n) => n>=0?C.pos:C.neg;

// Verdict config
const VM = {
    HIGH_CONVICTION:{ bg:'#052e16', bd:'#22c55e55', tx:'#22c55e', ic:'★', lb:'HIGH CONVICTION' },
    HOLD:           { bg:'#051828', bd:'#3b82f655', tx:'#3b82f6', ic:'◆', lb:'HOLD'            },
    REVIEW:         { bg:'#1c1404', bd:'#f59e0b55', tx:'#f59e0b', ic:'⚑', lb:'REVIEW'          },
    CRITICAL_RISK:  { bg:'#1c0505', bd:'#ef444455', tx:'#ef4444', ic:'⚠', lb:'CRITICAL RISK'   },
};

// ─── Small reusable bits ──────────────────────────────────────────────────────
const Chip = ({ label, value, colour=C.text, wide=false }) => (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:'6px 10px', minWidth:wide?130:90 }}>
        <div style={{ fontSize:9, color:C.muted, letterSpacing:'.05em', marginBottom:2 }}>{label}</div>
        <div style={{ fontSize:12, fontWeight:700, color:colour }}>{value}</div>
    </div>
);

const SentDot = ({ s }) => {
    const c = s?.includes('bull') ? C.pos : s?.includes('bear') ? C.neg : C.muted;
    return <span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%', background:c, marginRight:5, flexShrink:0, marginTop:3 }} />;
};

const TrendBadge = ({ signal }) => {
    const m = {
        STRONG_BULL:{ t:'STRONG BULL', c:C.pos,  b:'#052e16' },
        BULLISH:    { t:'BULLISH',     c:C.pos,  b:'#052e16' },
        NEUTRAL:    { t:'NEUTRAL',     c:C.muted,b:C.card    },
        BEARISH:    { t:'BEARISH',     c:C.neg,  b:'#1c0505' },
        STRONG_BEAR:{ t:'STRONG BEAR', c:C.neg,  b:'#1c0505' },
    }[signal] || { t:signal, c:C.muted, b:C.card };
    return <span style={{ background:m.b, border:`1px solid ${m.c}44`, borderRadius:5, padding:'2px 7px', fontSize:9, color:m.c, fontWeight:700 }}>{m.t}</span>;
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
const LoginScreen = ({ onLogin }) => {
    const [f,setF]=useState({clientId:'',password:''}); const [err,setErr]=useState(''); const [busy,setBusy]=useState(false);
    const submit=async(e)=>{ e.preventDefault(); setBusy(true); setErr('');
        try { const r=await fetch('/api/auth/portfolio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f)}); const d=await r.json(); d.ok?onLogin(d):setErr(d.error||'Invalid credentials'); }
        catch { setErr('Server error'); } finally { setBusy(false); }
    };
    const inp={background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:14,padding:'10px 14px',width:'100%',outline:'none',boxSizing:'border-box'};
    return (
        <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg}}>
            <div style={{width:380,background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:36}}>
                <div style={{textAlign:'center',marginBottom:28}}>
                    <div style={{fontSize:40,marginBottom:8}}>◈</div>
                    <div style={{fontSize:18,fontWeight:800,color:C.text,letterSpacing:'.06em'}}>PORTFOLIO INTELLIGENCE</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:4}}>Astraeus · Institutional Grade Analytics</div>
                </div>
                <form onSubmit={submit}>
                    <div style={{marginBottom:14}}>
                        <label style={{fontSize:10,color:C.muted,fontWeight:700,display:'block',marginBottom:5,letterSpacing:'.06em'}}>CLIENT ID</label>
                        <input style={inp} placeholder="e.g. HB6115" value={f.clientId} onChange={e=>setF(x=>({...x,clientId:e.target.value.toUpperCase()}))} />
                    </div>
                    <div style={{marginBottom:20}}>
                        <label style={{fontSize:10,color:C.muted,fontWeight:700,display:'block',marginBottom:5,letterSpacing:'.06em'}}>ACCESS CODE</label>
                        <input style={inp} type="password" placeholder="••••••••••" value={f.password} onChange={e=>setF(x=>({...x,password:e.target.value}))} />
                    </div>
                    {err&&<div style={{color:C.neg,fontSize:12,marginBottom:12}}>{err}</div>}
                    <button type="submit" disabled={busy} style={{width:'100%',background:`linear-gradient(135deg,${C.blue},${C.purple})`,color:'#fff',border:'none',borderRadius:8,padding:'11px 0',fontWeight:700,fontSize:14,cursor:busy?'not-allowed':'pointer',opacity:busy?0.7:1}}>
                        {busy?'Authenticating…':'Access Portfolio'}
                    </button>
                </form>
                <div style={{marginTop:20,fontSize:10,color:C.dim,textAlign:'center',lineHeight:1.6}}>Screener output only. Not SEBI-registered investment advice.</div>
            </div>
        </div>
    );
};

// ─── MARKET PULSE ─────────────────────────────────────────────────────────────
const MacroBlock = ({ title, items }) => (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16,flex:1,minWidth:260}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:'.06em',marginBottom:10}}>{title}</div>
        {items.map(({name,price,change})=>(
            <div key={name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:`1px solid ${C.border}`}}>
                <span style={{fontSize:12,color:C.text}}>{name}</span>
                <div style={{textAlign:'right'}}>
                    <div style={{fontSize:12,fontWeight:700,color:C.text}}>{price!=null?price.toLocaleString('en-IN',{maximumFractionDigits:2}):'—'}</div>
                    {change!=null&&<div style={{fontSize:10,fontWeight:700,color:pos(change)}}>{fmtPct(change)}</div>}
                </div>
            </div>
        ))}
    </div>
);

const MarketPulse = ({ pulse, portfolio }) => {
    if (!pulse) return <div style={{padding:40,color:C.muted,textAlign:'center'}}>Loading market data…</div>;
    const { india, global: gl, sectorSentiment, portfolioMacroExposure } = pulse;

    const indiaItems = [
        { name:'NIFTY 50',    price:india.nifty50?.price,   change:india.nifty50?.change   },
        { name:'NIFTY BANK',  price:india.bankNifty?.price, change:india.bankNifty?.change  },
        { name:'INDIA VIX',   price:india.vix?.price,       change:india.vix?.change        },
        { name:'MIDCAP 100',  price:india.midcap?.price,    change:india.midcap?.change     },
        { name:'USD/INR',     price:india.usdinr?.price,    change:india.usdinr?.change     },
        { name:'10Y GSEC',    price:india.gsec10y?.price,   change:india.gsec10y?.change    },
    ];
    const globalItems = [
        { name:'S&P 500',  price:gl.sp500?.price,  change:gl.sp500?.change  },
        { name:'NASDAQ',   price:gl.nasdaq?.price, change:gl.nasdaq?.change  },
        { name:'DOW',      price:gl.dow?.price,    change:gl.dow?.change     },
        { name:'CRUDE OIL',price:gl.crude?.price,  change:gl.crude?.change   },
        { name:'GOLD',     price:gl.gold?.price,   change:gl.gold?.change    },
        { name:'DXY',      price:gl.dxy?.price,    change:gl.dxy?.change     },
        { name:'US 10Y',   price:gl.us10y?.price,  change:gl.us10y?.change   },
    ];

    // Derive sentiment signals for portfolio specifically
    const vix = india.vix?.price;
    const mktSignal = vix ? (vix < 14 ? { s:'LOW FEAR', c:C.pos } : vix < 20 ? { s:'MODERATE', c:C.warn } : { s:'HIGH FEAR', c:C.neg }) : null;

    return (
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Macro signal strip */}
            {mktSignal && (
                <div style={{background:C.card,border:`1px solid ${mktSignal.c}33`,borderRadius:10,padding:'10px 16px',display:'flex',gap:20,flexWrap:'wrap',alignItems:'center'}}>
                    <div><span style={{fontSize:10,color:C.muted}}>MARKET FEAR GAUGE  </span><span style={{fontSize:14,fontWeight:800,color:mktSignal.c}}>VIX {vix?.toFixed(1)} — {mktSignal.s}</span></div>
                    <div style={{fontSize:11,color:C.muted}}>
                        {vix < 14 ? 'Complacency — market expects calm. Rotate to growth. Watch for surprise selloffs.' :
                         vix < 20 ? 'Moderate volatility — balanced risk. Normal hedging recommended.' :
                                    'Elevated fear — defensives outperform. Avoid adding to losers. Pledged share risk HIGH.'}
                    </div>
                </div>
            )}
            {/* Two-column macro */}
            <div style={{display:'flex',gap:14,flexWrap:'wrap'}}>
                <MacroBlock title="INDIA MACRO" items={indiaItems} />
                <MacroBlock title="GLOBAL MACRO" items={globalItems} />
            </div>
            {/* Sector sentiment from news */}
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16}}>
                <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:'.06em',marginBottom:10}}>SECTOR SENTIMENT (from live news aggregation)</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                    {sectorSentiment.map(s=>{
                        const c=s.signal==='BULLISH'?C.pos:s.signal==='BEARISH'?C.neg:C.muted;
                        return (
                            <div key={s.sector} style={{background:C.surface,border:`1px solid ${c}33`,borderRadius:8,padding:'7px 12px',minWidth:110}}>
                                <div style={{fontSize:11,fontWeight:700,color:c}}>{s.sector}</div>
                                <div style={{fontSize:10,color:C.muted,marginTop:2}}>{s.bull}↑ {s.bear}↓ {s.neutral}→</div>
                                <div style={{fontSize:10,fontWeight:700,color:c}}>{s.signal}</div>
                            </div>
                        );
                    })}
                </div>
            </div>
            {/* Portfolio macro exposure */}
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16}}>
                <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:'.06em',marginBottom:10}}>YOUR PORTFOLIO — MACRO EXPOSURE MAP</div>
                {Object.entries(portfolioMacroExposure).map(([theme,stocks])=>(
                    <div key={theme} style={{marginBottom:8}}>
                        <div style={{fontSize:11,color:C.text,fontWeight:600,marginBottom:3}}>{theme}</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                            {stocks.map(s=><span key={s} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:4,padding:'2px 7px',fontSize:10,color:C.muted}}>{s}</span>)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─── STOCK DETAIL — 4 PANELS ──────────────────────────────────────────────────
const FinancialsPanel = ({ f }) => {
    if (!f) return null;
    const row=(label,val,colour=C.text,unit='')=>(
        <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:`1px solid ${C.border}`,fontSize:11}}>
            <span style={{color:C.muted}}>{label}</span>
            <span style={{color:colour,fontWeight:600}}>{val!=null?val+unit:'—'}</span>
        </div>
    );
    return (
        <div style={{flex:1,minWidth:150}}>
            <div style={{fontSize:9,fontWeight:700,color:C.blue,letterSpacing:'.07em',marginBottom:7}}>FINANCIALS</div>
            {row('Revenue', f.totalRevenue?fmtCr(f.totalRevenue):'—')}
            {row('Rev Growth', f.revenueGrowth, f.revenueGrowth>0?C.pos:C.neg, '%')}
            {row('EBITDA Mgn', f.ebitdaMargins, f.ebitdaMargins>15?C.pos:f.ebitdaMargins>8?C.warn:C.neg, '%')}
            {row('Net Margin', f.profitMargins, f.profitMargins>10?C.pos:f.profitMargins>5?C.warn:C.neg, '%')}
            {row('ROE', f.returnOnEquity, f.returnOnEquity>15?C.pos:f.returnOnEquity>8?C.warn:C.neg, '%')}
            {row('ROA', f.returnOnAssets, f.returnOnAssets>5?C.pos:C.warn, '%')}
            {row('Debt/Equity', f.debtToEquity, f.debtToEquity!=null&&f.debtToEquity<0.5?C.pos:C.warn, 'x')}
            {row('Curr Ratio', f.currentRatio, f.currentRatio>1.5?C.pos:f.currentRatio>1?C.warn:C.neg, 'x')}
            <div style={{marginTop:6}}>
            {row('P/E (trail)', f.trailingPE, C.text, 'x')}
            {row('P/E (fwd)', f.forwardPE, C.text, 'x')}
            {row('P/B', f.priceToBook, C.text, 'x')}
            {row('EV/EBITDA', f.enterpriseToEbitda, C.text, 'x')}
            {row('Beta', f.beta, C.text, 'x')}
            {row('Div Yield', f.dividendYield, C.cyan, '%')}
            </div>
            {f.targetMean && (
                <div style={{marginTop:7,background:C.surface,borderRadius:6,padding:'6px 8px'}}>
                    <div style={{fontSize:9,color:C.muted,marginBottom:2}}>ANALYST PRICE TARGET ({f.analystCount} analysts)</div>
                    <div style={{fontSize:11,fontWeight:700,color:C.cyan}}>Avg {fmtINR(f.targetMean)} · Hi {fmtINR(f.targetHigh)} · Lo {fmtINR(f.targetLow)}</div>
                    <div style={{fontSize:11,color:f.upsideToTarget>=0?C.pos:C.neg,fontWeight:700,marginTop:2}}>
                        {f.upsideToTarget>=0?'Upside':'Downside'} to target: {fmtPct(f.upsideToTarget)}
                    </div>
                </div>
            )}
        </div>
    );
};

const TechPanel = ({ t }) => {
    if (!t) return null;
    const row=(label,val,colour=C.text)=>(
        <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:`1px solid ${C.border}`,fontSize:11}}>
            <span style={{color:C.muted}}>{label}</span>
            <span style={{color:colour,fontWeight:600}}>{val??'—'}</span>
        </div>
    );
    const rsiCol = t.rsi<35?C.pos:t.rsi>65?C.neg:C.warn;
    const macdCol= t.macdSignal?.includes('BULL')?C.pos:t.macdSignal?.includes('BEAR')?C.neg:C.muted;
    const emaAbove=(e,cmp)=>e&&cmp>e;

    return (
        <div style={{flex:1,minWidth:150}}>
            <div style={{fontSize:9,fontWeight:700,color:C.purple,letterSpacing:'.07em',marginBottom:7}}>TECHNICALS</div>
            {row('RSI (14)', t.rsi!=null?t.rsi.toFixed(1):null, rsiCol)}
            {row('RSI Zone', t.rsi<30?'OVERSOLD ↑':t.rsi>70?'OVERBOUGHT ↓':t.rsi<45?'WEAK':'HEALTHY', rsiCol)}
            {row('MACD', t.macdSignal?.replace('_',' '), macdCol)}
            {row('Trend', null)}
            <div style={{marginBottom:4}}>
                <TrendBadge signal={t.trendSignal||'NEUTRAL'} />
            </div>
            {row('EMA 50',  t.ema50  ?fmtINR(t.ema50) :null, C.muted)}
            {row('EMA 200', t.ema200 ?fmtINR(t.ema200):null, C.muted)}
            {row('Vol Signal', t.volSignal, t.volSignal==='HIGH'?C.pos:t.volSignal==='LOW'?C.warn:C.text)}
            {row('Vol Ratio', t.volRatio!=null?t.volRatio+'x':null, t.volRatio>1.5?C.pos:C.muted)}
            <div style={{marginTop:6}}>
            {row('Support',    t.support    ?fmtINR(t.support)    :null, C.pos)}
            {row('Resistance', t.resistance ?fmtINR(t.resistance) :null, C.neg)}
            </div>
            <div style={{marginTop:7,background:C.surface,borderRadius:6,padding:'6px 8px'}}>
                <div style={{fontSize:9,color:C.muted,marginBottom:2}}>TECHNICAL VERDICT</div>
                <div style={{fontSize:13,fontWeight:800,color:t.techVerdict?.includes('BUY')?C.pos:t.techVerdict?.includes('SELL')?C.neg:C.warn}}>{t.techVerdict}</div>
            </div>
        </div>
    );
};

const SentimentPanel = ({ d }) => {
    if (!d) return null;
    const { bullNews, bearNews, newsSentiment, consensus, news } = d;
    const sCol = newsSentiment==='BULLISH'?C.pos:newsSentiment==='BEARISH'?C.neg:C.muted;
    const cBull = consensus?.totalBull||0, cBear=consensus?.totalBear||0, cHold=consensus?.hold||0, cTotal=consensus?.total||1;
    const bullW  = (cBull/cTotal*100).toFixed(0), bearW=(cBear/cTotal*100).toFixed(0), holdW=(cHold/cTotal*100).toFixed(0);

    return (
        <div style={{flex:1,minWidth:150}}>
            <div style={{fontSize:9,fontWeight:700,color:C.cyan,letterSpacing:'.07em',marginBottom:7}}>SENTIMENT</div>
            {/* News sentiment */}
            <div style={{marginBottom:8}}>
                <div style={{fontSize:9,color:C.muted,marginBottom:4}}>NEWS SENTIMENT (last 8 articles)</div>
                <div style={{fontSize:14,fontWeight:800,color:sCol,marginBottom:4}}>{newsSentiment}</div>
                <div style={{display:'flex',gap:8,fontSize:11}}>
                    <span style={{color:C.pos}}>▲ {bullNews} bull</span>
                    <span style={{color:C.neg}}>▼ {bearNews} bear</span>
                </div>
            </div>
            {/* Analyst consensus */}
            <div style={{marginBottom:8,paddingTop:8,borderTop:`1px solid ${C.border}`}}>
                <div style={{fontSize:9,color:C.muted,marginBottom:4}}>ANALYST CONSENSUS ({cTotal} analysts)</div>
                <div style={{fontSize:14,fontWeight:800,color:cBull>cBear?C.pos:cBear>cBull?C.neg:C.warn,marginBottom:4}}>{consensus?.rating}</div>
                {/* Stacked bar */}
                <div style={{display:'flex',height:6,borderRadius:3,overflow:'hidden',marginBottom:4}}>
                    {cBull>0&&<div style={{width:bullW+'%',background:C.pos}}/>}
                    {cHold>0&&<div style={{width:holdW+'%',background:C.warn}}/>}
                    {cBear>0&&<div style={{width:bearW+'%',background:C.neg}}/>}
                </div>
                <div style={{display:'flex',gap:8,fontSize:10,color:C.muted}}>
                    <span style={{color:C.pos}}>{cBull} buy</span>
                    <span style={{color:C.warn}}>{cHold} hold</span>
                    <span style={{color:C.neg}}>{cBear} sell</span>
                </div>
            </div>
            {/* Headlines */}
            <div style={{paddingTop:8,borderTop:`1px solid ${C.border}`}}>
                <div style={{fontSize:9,color:C.muted,marginBottom:4}}>LATEST NEWS</div>
                {(news||[]).slice(0,5).map((n,i)=>(
                    <div key={i} style={{display:'flex',gap:5,marginBottom:5,alignItems:'flex-start'}}>
                        <SentDot s={n.sentiment}/>
                        <div>
                            <a href={n.link} target="_blank" rel="noreferrer" style={{color:C.text,fontSize:10,lineHeight:1.4,textDecoration:'none'}}>{n.title?.slice(0,80)}{n.title?.length>80?'…':''}</a>
                            <div style={{fontSize:9,color:C.muted}}>{n.publisher} · {n.time}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const VerdictPanel = ({ h, d }) => {
    const vm = VM[h.analystTag] || VM.HOLD;
    const holding = h;

    return (
        <div style={{flex:1,minWidth:150}}>
            <div style={{fontSize:9,fontWeight:700,color:C.warn,letterSpacing:'.07em',marginBottom:7}}>ANALYST VERDICT</div>
            {/* Badge */}
            <div style={{background:vm.bg,border:`1px solid ${vm.bd}`,borderRadius:8,padding:'8px 10px',marginBottom:8}}>
                <div style={{fontSize:13,fontWeight:800,color:vm.tx,marginBottom:4}}>{vm.ic} {vm.lb}</div>
                <div style={{fontSize:11,color:C.text,lineHeight:1.5}}>{h.analystReason}</div>
            </div>
            {/* Earnings */}
            {d?.nextEarnings && (
                <div style={{background:C.surface,border:`1px solid ${d.daysToEarnings<10?C.neg:d.daysToEarnings<30?C.warn:C.border}`,borderRadius:7,padding:'7px 10px',marginBottom:8}}>
                    <div style={{fontSize:9,color:C.muted,marginBottom:2}}>NEXT EARNINGS</div>
                    <div style={{fontSize:12,fontWeight:700,color:d.daysToEarnings<10?C.neg:d.daysToEarnings<30?C.warn:C.text}}>{d.nextEarnings}</div>
                    <div style={{fontSize:10,color:C.muted}}>{d.daysToEarnings===0?'TODAY':d.daysToEarnings>0?`in ${d.daysToEarnings} days`:'Passed'}</div>
                </div>
            )}
            {/* Quarterly EPS history */}
            {d?.quarterly?.length>0&&(
                <div style={{marginBottom:8}}>
                    <div style={{fontSize:9,color:C.muted,marginBottom:4}}>QUARTERLY EPS (actual vs estimate)</div>
                    {d.quarterly.map((q,i)=>{
                        const beat=q.epsActual!=null&&q.epsEstimate!=null&&q.epsActual>=q.epsEstimate;
                        const miss=q.epsActual!=null&&q.epsEstimate!=null&&q.epsActual<q.epsEstimate;
                        return (
                            <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',borderBottom:`1px solid ${C.border}`,fontSize:10}}>
                                <span style={{color:C.muted}}>{q.quarter}</span>
                                <span style={{color:beat?C.pos:miss?C.neg:C.muted,fontWeight:600}}>
                                    {q.epsActual!=null?'₹'+q.epsActual:'—'}
                                    {q.epsEstimate!=null?' (est ₹'+q.epsEstimate+')':''}
                                    {q.surprise!=null?' '+fmtPct(q.surprise):''}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
            {/* Position summary */}
            <div style={{background:C.surface,borderRadius:7,padding:'7px 10px',fontSize:10}}>
                <div style={{color:C.muted,marginBottom:2}}>YOUR POSITION</div>
                <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:C.muted}}>Qty</span><span style={{color:C.text,fontWeight:700}}>{holding.qtyLT} shares</span></div>
                <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:C.muted}}>Avg cost</span><span style={{color:C.text,fontWeight:700}}>{fmtINR(holding.avgBuy)}</span></div>
                <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:C.muted}}>Position val</span><span style={{color:C.text,fontWeight:700}}>{fmtINR(holding.liveValue)}</span></div>
                <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:C.muted}}>Unrealized P&L</span><span style={{color:pos(holding.livePnlPct),fontWeight:700}}>{fmtINR(holding.livePnl)} ({fmtPct(holding.livePnlPct)})</span></div>
                {holding.isPledged&&<div style={{marginTop:4,color:C.neg,fontWeight:700}}>⚠ {holding.pledgedTotal} shares PLEDGED</div>}
            </div>
        </div>
    );
};

// ─── HOLDING ROW ──────────────────────────────────────────────────────────────
const HoldingRow = ({ h, expanded, onToggle, token }) => {
    const [detail, setDetail] = useState(null);
    const [loading, setLoading]= useState(false);
    const vm = VM[h.analystTag] || VM.HOLD;

    useEffect(()=>{
        if (expanded && !detail && !loading) {
            setLoading(true);
            fetch(`/api/portfolio/stock-detail?ticker=${h.ticker}`,{headers:{'x-portfolio-token':token}})
                .then(r=>r.json()).then(setDetail).catch(()=>setDetail(null)).finally(()=>setLoading(false));
        }
    },[expanded,h.ticker,token]);

    return (
        <div style={{borderBottom:`1px solid ${C.border}`}}>
            {/* Summary row */}
            <div onClick={onToggle} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',cursor:'pointer',background:expanded?'#0a1628':'transparent',flexWrap:'wrap'}}>
                <div style={{minWidth:110,background:vm.bg,border:`1px solid ${vm.bd}`,borderRadius:6,padding:'3px 8px',fontSize:10,color:vm.tx,fontWeight:700,textAlign:'center',flexShrink:0}}>
                    {vm.ic} {vm.lb}
                </div>
                <div style={{flex:1,minWidth:160}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                        <span style={{fontWeight:800,color:C.text,fontSize:14}}>{h.ticker}</span>
                        <span style={{fontSize:10,color:C.muted}}>{h.sector}</span>
                        {h.isPledged&&<span style={{fontSize:9,color:C.neg,background:'#1c0505',border:`1px solid ${C.neg}44`,borderRadius:3,padding:'1px 5px',fontWeight:700}}>PLEDGED</span>}
                    </div>
                    <div style={{fontSize:10,color:C.muted,marginTop:1}}>Qty {h.qtyLT} · Avg {fmtINR(h.avgBuy)} · CMP {fmtINR(h.liveCmp)} · {h.change1d>=0?'+':''}{ h.change1d?.toFixed(2)}% today</div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontWeight:700,color:C.text,fontSize:13}}>{fmtINR(h.liveValue)}</div>
                    <div style={{fontSize:11,fontWeight:700,color:pos(h.livePnlPct)}}>{fmtPct(h.livePnlPct)} · {h.livePnl>=0?'+':''}{fmtINR(h.livePnl)}</div>
                </div>
                <div style={{color:C.muted,fontSize:11,flexShrink:0}}>{expanded?'▲':'▼'}</div>
            </div>

            {/* 4-panel deep analysis */}
            {expanded && (
                <div style={{padding:'0 14px 16px',background:'#070c1c'}}>
                    {loading&&<div style={{padding:'12px 0',color:C.muted,fontSize:12}}>Fetching live data for {h.ticker}…</div>}
                    {detail && (
                        <div style={{display:'flex',gap:14,flexWrap:'wrap',paddingTop:14}}>
                            <FinancialsPanel f={detail.financials} />
                            <TechPanel       t={detail.technicals} />
                            <SentimentPanel  d={detail} />
                            <VerdictPanel    h={h} d={detail} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ─── ANALYST SUMMARY ──────────────────────────────────────────────────────────
const AnalystSummary = ({ portfolio }) => {
    if (!portfolio) return null;
    const { liveSummary, equity, mf, mfSummary } = portfolio;

    const byTag = {};
    equity.forEach(h=>{ byTag[h.analystTag]=(byTag[h.analystTag]||[]).concat(h); });

    const top3   = [...equity].sort((a,b)=>b.livePnlPct-a.livePnlPct).slice(0,3);
    const btm3   = [...equity].sort((a,b)=>a.livePnlPct-b.livePnlPct).slice(0,3);
    const pledged= equity.filter(h=>h.isPledged);

    const sMap={};
    equity.forEach(h=>{ sMap[h.sector]=(sMap[h.sector]||0)+h.liveValue; });
    const topS = Object.entries(sMap).sort((a,b)=>b[1]-a[1]);
    const totEq = equity.reduce((s,h)=>s+h.liveValue,0);

    return (
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:20,marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:8,marginBottom:14}}>
                <div>
                    <div style={{fontSize:14,fontWeight:800,color:C.text,letterSpacing:'.05em'}}>EQUITY RESEARCH REPORT — HB6115</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:2}}>Zerodha · {portfolio.asOn} · {equity.length} equity + {mf.length} MF positions</div>
                </div>
                <div style={{background:liveSummary.pnlPct>=0?'#052e16':'#1c0505',border:`1px solid ${liveSummary.pnlPct>=0?C.pos:C.neg}44`,borderRadius:10,padding:'8px 14px',textAlign:'center'}}>
                    <div style={{fontSize:10,color:C.muted}}>PORTFOLIO RETURN (LIVE)</div>
                    <div style={{fontSize:24,fontWeight:800,color:pos(liveSummary.pnlPct)}}>{fmtPct(liveSummary.pnlPct)}</div>
                    <div style={{fontSize:11,color:C.muted}}>{fmtINR(liveSummary.pnl)}</div>
                </div>
            </div>

            {/* Stats */}
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
                {[['INVESTED',fmtINR(liveSummary.invested),C.muted],
                  ['EQUITY VALUE',fmtINR(liveSummary.presentValue),C.text],
                  ['MF VALUE',fmtINR(mfSummary.presentValue),C.cyan],
                  ['TOTAL ASSETS',fmtINR(liveSummary.presentValue+mfSummary.presentValue),C.blue],
                  ['MF RETURN',fmtPct(mfSummary.pnlPct),pos(mfSummary.pnlPct)],
                ].map(([k,v,c])=>(
                    <div key={k} style={{background:C.surface,borderRadius:8,padding:'7px 12px',flex:1,minWidth:100}}>
                        <div style={{fontSize:9,color:C.muted,letterSpacing:'.06em',marginBottom:2}}>{k}</div>
                        <div style={{fontSize:13,fontWeight:800,color:c}}>{v}</div>
                    </div>
                ))}
            </div>

            {/* Verdict counts */}
            <div style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:14}}>
                {['CRITICAL_RISK','REVIEW','HIGH_CONVICTION','HOLD'].map(tag=>{
                    const list=byTag[tag]||[]; if(!list.length) return null;
                    const vm=VM[tag];
                    return <div key={tag} style={{background:vm.bg,border:`1px solid ${vm.bd}`,borderRadius:20,padding:'4px 12px',fontSize:11,color:vm.tx,fontWeight:700}}>{vm.ic} {list.length} {vm.lb}</div>;
                })}
            </div>

            {/* Pledged warning */}
            {pledged.length>0&&(
                <div style={{background:'#1c0505',border:`1px solid ${C.neg}44`,borderRadius:8,padding:'10px 14px',marginBottom:12}}>
                    <div style={{fontWeight:700,color:C.neg,fontSize:12,marginBottom:4}}>⚠ PLEDGED SHARES — FORCED LIQUIDATION RISK</div>
                    {pledged.map(h=><div key={h.ticker} style={{fontSize:11,color:'#fca5a5',marginTop:2}}>{h.ticker}: {h.pledgedTotal} shares pledged · CMP {fmtINR(h.liveCmp)} · Cost {fmtINR(h.avgBuy)} · {fmtPct(h.livePnlPct)}</div>)}
                    <div style={{fontSize:10,color:'#f87171',marginTop:6}}>If CMP falls significantly, broker may force-sell pledged shares without notice. Maintain buffer above margin trigger.</div>
                </div>
            )}

            {/* Two col: performers + sector */}
            <div style={{display:'flex',gap:14,flexWrap:'wrap'}}>
                <div style={{flex:1,minWidth:200}}>
                    <div style={{fontSize:9,color:C.muted,fontWeight:700,letterSpacing:'.06em',marginBottom:5}}>TOP PERFORMERS</div>
                    {top3.map(h=><div key={h.ticker} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:`1px solid ${C.border}`,fontSize:11}}><span style={{color:C.text,fontWeight:700}}>{h.ticker}</span><span style={{color:C.pos,fontWeight:700}}>{fmtPct(h.livePnlPct)} · {fmtINR(h.livePnl)}</span></div>)}
                    <div style={{fontSize:9,color:C.muted,fontWeight:700,letterSpacing:'.06em',marginTop:8,marginBottom:5}}>UNDERPERFORMERS</div>
                    {btm3.map(h=><div key={h.ticker} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:`1px solid ${C.border}`,fontSize:11}}><span style={{color:C.text,fontWeight:700}}>{h.ticker}</span><span style={{color:C.neg,fontWeight:700}}>{fmtPct(h.livePnlPct)} · {fmtINR(h.livePnl)}</span></div>)}
                </div>
                <div style={{flex:1,minWidth:200}}>
                    <div style={{fontSize:9,color:C.muted,fontWeight:700,letterSpacing:'.06em',marginBottom:5}}>SECTOR ALLOCATION</div>
                    {topS.map(([s,v])=>{
                        const pct=(v/totEq*100);
                        return (
                            <div key={s} style={{marginBottom:5}}>
                                <div style={{display:'flex',justifyContent:'space-between',fontSize:10,marginBottom:2}}><span style={{color:C.text}}>{s}</span><span style={{color:C.muted}}>{pct.toFixed(1)}%</span></div>
                                <div style={{background:C.border,borderRadius:3,height:3}}><div style={{background:C.blue,width:pct+'%',height:3,borderRadius:3}}/></div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div style={{marginTop:10,fontSize:9,color:C.dim}}>Analyst verdicts are algorithmic screener outputs. Not SEBI-registered research or investment advice.</div>
        </div>
    );
};

// ─── MF SECTION ──────────────────────────────────────────────────────────────
const MFSection = ({ mf, summary }) => (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16}}>
        <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:6,marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:'.06em'}}>MUTUAL FUNDS — ELSS TAX SAVER (3Y LOCK-IN)</div>
            <div style={{fontSize:12,color:C.cyan,fontWeight:700}}>{fmtINR(summary.invested)} → {fmtINR(summary.presentValue)} · {fmtPct(summary.pnlPct)}</div>
        </div>
        {mf.map(f=>(
            <div key={f.isin} style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:4,padding:'7px 0',borderBottom:`1px solid ${C.border}`}}>
                <div style={{flex:1,minWidth:200}}>
                    <div style={{fontSize:12,color:C.text,fontWeight:600}}>{f.name}</div>
                    <div style={{fontSize:10,color:C.muted}}>Qty {f.qty.toFixed(3)} · Avg NAV {fmtINR(f.avgNav)} · Current {fmtINR(f.nav)}</div>
                </div>
                <div style={{textAlign:'right'}}>
                    <div style={{fontSize:13,fontWeight:700,color:C.text}}>{fmtINR(f.nav*f.qty)}</div>
                    <div style={{fontSize:11,fontWeight:700,color:pos(f.pnlPct)}}>{fmtPct(f.pnlPct)} · {fmtINR(f.pnl)}</div>
                </div>
            </div>
        ))}
        <div style={{marginTop:8,fontSize:9,color:C.dim}}>ELSS funds have mandatory 3-year lock-in. LTCG applies after lock-in. NAVs as of last available date.</div>
    </div>
);

// ─── EARNINGS CALENDAR ────────────────────────────────────────────────────────
const EarningsCalendar = ({ token }) => {
    const [data,setData]=useState(null); const [ld,setLd]=useState(true);
    useEffect(()=>{ fetch('/api/portfolio/earnings',{headers:{'x-portfolio-token':token}}).then(r=>r.json()).then(setData).catch(()=>null).finally(()=>setLd(false)); },[token]);
    const upcoming=data?.earnings||[];
    return (
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:16}}>
            <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:'.06em',marginBottom:12}}>EARNINGS CALENDAR — NEXT 90 DAYS</div>
            {ld&&<div style={{color:C.muted,fontSize:12}}>Loading…</div>}
            {!ld&&!upcoming.length&&<div style={{color:C.muted,fontSize:12}}>No upcoming results found. Check NSE corporate actions page for exact dates.</div>}
            <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                {upcoming.map(e=>{
                    const u=e.daysAway<=7; const s=e.daysAway<=21;
                    const col=u?C.neg:s?C.warn:C.muted;
                    return (
                        <div key={e.ticker} style={{background:u?'#1c0505':s?'#1c1404':C.surface,border:`1px solid ${col}44`,borderRadius:8,padding:'8px 12px',minWidth:120}}>
                            <div style={{fontSize:13,fontWeight:700,color:C.text}}>{e.ticker}</div>
                            <div style={{fontSize:11,color:col,fontWeight:700}}>{e.date}</div>
                            <div style={{fontSize:10,color:C.muted}}>{e.daysAway===0?'TODAY':e.daysAway>0?`in ${e.daysAway}d`:'Past'}</div>
                            {e.peForward&&<div style={{fontSize:10,color:C.muted}}>Fwd PE: {e.peForward.toFixed(1)}x</div>}
                        </div>
                    );
                })}
            </div>
            <div style={{marginTop:10,fontSize:9,color:C.dim}}>Dates from Yahoo Finance — may be estimates. Verify at NSE India corporate actions.</div>
        </div>
    );
};

// ─── ROOT ─────────────────────────────────────────────────────────────────────
const TABS=[['overview','Overview'],['pulse','Market Pulse'],['holdings','Holdings'],['earnings','Earnings'],['mf','Mutual Funds']];
const SORT=[['tag','By Verdict'],['pnlPct_desc','Best P&L'],['pnlPct_asc','Worst P&L'],['value_desc','Largest Position'],['ticker_asc','A→Z']];
const FILTERS=['ALL','HIGH_CONVICTION','HOLD','REVIEW','CRITICAL_RISK'];

export default function PortfolioIntelligence() {
    const [session,  setSession]   = useState(()=>{ try{return JSON.parse(localStorage.getItem('portfolio_session'));}catch{return null;} });
    const [portfolio,setPortfolio] = useState(null);
    const [pulse,    setPulse]     = useState(null);
    const [loading,  setLoading]   = useState(false);
    const [expanded, setExpanded]  = useState(null);
    const [tab,      setTab]       = useState('overview');
    const [sort,     setSort]      = useState('tag');
    const [filter,   setFilter]    = useState('ALL');

    const login  = useCallback(sess=>{ localStorage.setItem('portfolio_session',JSON.stringify(sess)); setSession(sess); },[]);
    const logout = useCallback(()=>{ localStorage.removeItem('portfolio_session'); setSession(null); setPortfolio(null); setPulse(null); },[]);

    const fetchPortfolio = useCallback(async token=>{
        setLoading(true);
        try {
            const [pRes,mRes]=await Promise.allSettled([
                fetch('/api/portfolio/hb6115',{headers:{'x-portfolio-token':token}}).then(r=>r.ok?r.json():null),
                fetch('/api/market/pulse').then(r=>r.json()),
            ]);
            if (pRes.status==='fulfilled'&&pRes.value) setPortfolio(pRes.value); else logout();
            if (mRes.status==='fulfilled') setPulse(mRes.value);
        } catch { logout(); } finally { setLoading(false); }
    },[logout]);

    useEffect(()=>{ if(session?.token) fetchPortfolio(session.token); },[session,fetchPortfolio]);

    if (!session) return <LoginScreen onLogin={login}/>;

    const TAG_ORDER={'CRITICAL_RISK':0,'REVIEW':1,'HIGH_CONVICTION':2,'HOLD':3};
    let holdings=[...(portfolio?.equity||[])];
    if (filter!=='ALL') holdings=holdings.filter(h=>h.analystTag===filter);
    switch(sort){
        case 'pnlPct_desc': holdings.sort((a,b)=>b.livePnlPct-a.livePnlPct); break;
        case 'pnlPct_asc':  holdings.sort((a,b)=>a.livePnlPct-b.livePnlPct); break;
        case 'value_desc':  holdings.sort((a,b)=>b.liveValue-a.liveValue);   break;
        case 'ticker_asc':  holdings.sort((a,b)=>a.ticker.localeCompare(b.ticker)); break;
        case 'tag':         holdings.sort((a,b)=>(TAG_ORDER[a.analystTag]??9)-(TAG_ORDER[b.analystTag]??9)); break;
    }

    return (
        <div style={{maxWidth:1100,margin:'0 auto',padding:'14px 12px',fontFamily:"'JetBrains Mono','Fira Code',monospace"}}>
            {/* Header */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:8}}>
                <div>
                    <div style={{fontSize:15,fontWeight:800,color:C.text}}>◈ Portfolio Intelligence</div>
                    <div style={{fontSize:10,color:C.muted}}>Client: {session.clientId} · {session.name} · Powered by Astraeus</div>
                </div>
                <div style={{display:'flex',gap:7}}>
                    <button onClick={()=>portfolio&&fetchPortfolio(session.token)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:'5px 11px',color:C.muted,cursor:'pointer',fontSize:11}}>↻ Refresh</button>
                    <button onClick={logout} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:'5px 11px',color:C.muted,cursor:'pointer',fontSize:11}}>Sign out</button>
                </div>
            </div>

            {loading&&!portfolio&&<div style={{textAlign:'center',padding:60,color:C.muted}}>Loading portfolio…</div>}

            {/* Tab bar */}
            <div style={{display:'flex',gap:0,marginBottom:14,background:C.surface,borderRadius:10,padding:3,border:`1px solid ${C.border}`}}>
                {TABS.map(([t,l])=>(
                    <button key={t} onClick={()=>setTab(t)} style={{flex:1,background:tab===t?C.blue:'transparent',color:tab===t?'#fff':C.muted,border:'none',borderRadius:8,padding:'7px 0',cursor:'pointer',fontSize:11,fontWeight:600,transition:'all .15s'}}>
                        {l}
                    </button>
                ))}
            </div>

            {portfolio&&(
                <>
                    {tab==='overview'&&<AnalystSummary portfolio={portfolio}/>}

                    {tab==='pulse'&&<MarketPulse pulse={pulse} portfolio={portfolio}/>}

                    {tab==='holdings'&&(
                        <>
                            {/* Controls */}
                            <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap',alignItems:'center'}}>
                                <select value={sort} onChange={e=>setSort(e.target.value)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,color:C.text,padding:'5px 9px',fontSize:11,cursor:'pointer'}}>
                                    {SORT.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                                </select>
                                <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                                    {FILTERS.map(f=>{
                                        const vm=VM[f]; const active=filter===f;
                                        return <button key={f} onClick={()=>setFilter(f)} style={{background:active?(vm?.bg||C.blue):C.card,border:`1px solid ${active?(vm?.bd||C.blue):C.border}`,borderRadius:20,padding:'3px 9px',color:active?(vm?.tx||'#fff'):C.muted,cursor:'pointer',fontSize:9,fontWeight:700}}>
                                            {f.replace('_',' ')}
                                        </button>;
                                    })}
                                </div>
                                <span style={{fontSize:10,color:C.muted,marginLeft:'auto'}}>{holdings.length} positions shown</span>
                            </div>
                            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:14}}>
                                {holdings.map(h=>(
                                    <HoldingRow key={h.ticker} h={h} token={session.token}
                                        expanded={expanded===h.ticker}
                                        onToggle={()=>setExpanded(t=>t===h.ticker?null:h.ticker)}/>
                                ))}
                            </div>
                        </>
                    )}

                    {tab==='earnings'&&<EarningsCalendar token={session.token}/>}
                    {tab==='mf'&&<MFSection mf={portfolio.mf} summary={portfolio.mfSummary}/>}
                </>
            )}

            {/* Disclaimer */}
            <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 14px',fontSize:9,color:C.dim,lineHeight:1.7,marginTop:8}}>
                <strong style={{color:C.muted}}>Important Disclosure:</strong> All analyst verdicts, signals, technicals, and screener outputs are generated algorithmically using publicly available market data. Astraeus is not a SEBI-registered Research Analyst (RA) or Investment Advisor (IA). This output does not constitute investment advice, a research report, or a recommendation to buy/sell/hold any security. Past performance and historical patterns are not indicative of future results. Capital invested in equities is subject to market risk including the risk of loss of principal. Pledged shares carry additional margin call risk and may be liquidated by the broker without notice. Tax figures are indicative — consult a Chartered Accountant. Data sourced from Yahoo Finance (delayed) and NSE India.
            </div>
        </div>
    );
}
