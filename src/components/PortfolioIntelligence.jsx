import { useState, useEffect, useCallback } from 'react';

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
    bg:     '#050a14', surface:'#080e1a', card:'#0a1628', border:'#1a2744',
    text:   '#e2e8f0', muted:'#64748b',  subtle:'#1e3a5f',
    pos:    '#22c55e', neg:'#ef4444',     warn:'#f59e0b',  blue:'#3b82f6',
    purple: '#8b5cf6', cyan:'#06b6d4',
};

const fmtINR  = (n) => '₹' + Math.abs(n||0).toLocaleString('en-IN', { maximumFractionDigits:0 });
const fmtPct  = (n) => (n==null?'—':(n>=0?'+':'')+n.toFixed(2)+'%');
const fmtCr   = (n) => n ? '₹'+(n/1e7).toFixed(2)+' Cr' : '—';

// ── Verdict config ─────────────────────────────────────────────────────────────
const V = {
    HIGH_CONVICTION:{ bg:'#052e16', border:'#22c55e', text:'#22c55e', icon:'★', label:'HIGH CONVICTION' },
    HOLD:           { bg:'#0a1628', border:'#3b82f6', text:'#3b82f6', icon:'◆', label:'HOLD' },
    REVIEW:         { bg:'#1c1404', border:'#f59e0b', text:'#f59e0b', icon:'⚑', label:'REVIEW' },
    CRITICAL_RISK:  { bg:'#1c0505', border:'#ef4444', text:'#ef4444', icon:'⚠', label:'CRITICAL RISK' },
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────
const LoginScreen = ({ onLogin }) => {
    const [form, setForm] = useState({ clientId:'', password:'' });
    const [err,  setErr]  = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true); setErr('');
        try {
            const r = await fetch('/api/auth/portfolio', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify(form),
            });
            const d = await r.json();
            if (d.ok) { onLogin(d); }
            else       { setErr(d.error || 'Invalid credentials'); }
        } catch { setErr('Server error — please try again'); }
        finally  { setBusy(false); }
    };

    const inp = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, color:C.text, fontSize:14, padding:'10px 14px', width:'100%', outline:'none', boxSizing:'border-box' };
    return (
        <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:C.bg }}>
            <div style={{ width:380, background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:36 }}>
                {/* Logo */}
                <div style={{ textAlign:'center', marginBottom:28 }}>
                    <div style={{ fontSize:36, marginBottom:8 }}>◈</div>
                    <div style={{ fontSize:20, fontWeight:800, color:C.text, letterSpacing:'.05em' }}>PORTFOLIO INTELLIGENCE</div>
                    <div style={{ fontSize:12, color:C.muted, marginTop:4 }}>Astraeus · Institutional Grade Analytics</div>
                </div>

                <form onSubmit={submit}>
                    <div style={{ marginBottom:14 }}>
                        <label style={{ fontSize:11, color:C.muted, fontWeight:600, display:'block', marginBottom:5, letterSpacing:'.05em' }}>CLIENT ID</label>
                        <input style={inp} placeholder="e.g. HB6115" value={form.clientId}
                            onChange={e => setForm(f=>({...f, clientId:e.target.value.toUpperCase()}))} autoComplete="username" />
                    </div>
                    <div style={{ marginBottom:20 }}>
                        <label style={{ fontSize:11, color:C.muted, fontWeight:600, display:'block', marginBottom:5, letterSpacing:'.05em' }}>ACCESS CODE</label>
                        <input style={inp} type="password" placeholder="••••••••••" value={form.password}
                            onChange={e => setForm(f=>({...f, password:e.target.value}))} autoComplete="current-password" />
                    </div>
                    {err && <div style={{ color:C.neg, fontSize:12, marginBottom:12 }}>{err}</div>}
                    <button type="submit" disabled={busy} style={{ width:'100%', background:`linear-gradient(135deg,${C.blue},${C.purple})`, color:'#fff', border:'none', borderRadius:8, padding:'11px 0', fontWeight:700, fontSize:14, cursor:busy?'not-allowed':'pointer', opacity:busy?0.7:1 }}>
                        {busy ? 'Authenticating…' : 'Access Portfolio'}
                    </button>
                </form>

                <div style={{ marginTop:20, fontSize:10, color:'#334155', textAlign:'center', lineHeight:1.6 }}>
                    Screener output only. Not SEBI-registered investment advice.<br/>
                    Data sourced from Yahoo Finance & NSE.
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// ANALYST SUMMARY HEADER  (Head of Equity Research grade)
// ─────────────────────────────────────────────────────────────────────────────
const AnalystSummary = ({ portfolio }) => {
    if (!portfolio) return null;
    const { liveSummary, equity, mf, riskFlags } = portfolio;

    const byTag = { HIGH_CONVICTION:[], HOLD:[], REVIEW:[], CRITICAL_RISK:[] };
    equity.forEach(h => { if (byTag[h.analystTag]) byTag[h.analystTag].push(h); });

    const topPerformers   = [...equity].sort((a,b) => b.livePnlPct - a.livePnlPct).slice(0, 3);
    const bottomPerformers= [...equity].sort((a,b) => a.livePnlPct - b.livePnlPct).slice(0, 3);
    const pledgedStocks   = equity.filter(h => h.isPledged);
    const totalPledgedValue = pledgedStocks.reduce((s,h) => s + h.liveValue, 0);

    const sectorMap = {};
    equity.forEach(h => {
        sectorMap[h.sector] = (sectorMap[h.sector] || 0) + h.liveValue;
    });
    const topSectors = Object.entries(sectorMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const totalEqValue = equity.reduce((s,h)=>s+h.liveValue,0);

    return (
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:20, marginBottom:18 }}>
            {/* Title */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:8, marginBottom:18 }}>
                <div>
                    <div style={{ fontSize:14, fontWeight:800, color:C.text, letterSpacing:'.06em' }}>EQUITY RESEARCH — PORTFOLIO REVIEW</div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>Client HB6115 · As of {portfolio.asOn} · {equity.length} equity holdings + {mf.length} MF positions</div>
                </div>
                <div style={{ background: liveSummary.pnlPct >= 15 ? '#052e16' : liveSummary.pnlPct >= 0 ? C.card : '#1c0505', border:`1px solid ${liveSummary.pnlPct >= 0 ? C.pos : C.neg}44`, borderRadius:10, padding:'8px 14px', textAlign:'center' }}>
                    <div style={{ fontSize:10, color:C.muted }}>OVERALL RETURN</div>
                    <div style={{ fontSize:22, fontWeight:800, color: liveSummary.pnlPct >= 0 ? C.pos : C.neg }}>{fmtPct(liveSummary.pnlPct)}</div>
                    <div style={{ fontSize:11, color:C.muted }}>{fmtINR(liveSummary.pnl)}</div>
                </div>
            </div>

            {/* Stats row */}
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:16 }}>
                {[
                    ['INVESTED', fmtINR(liveSummary.invested), C.muted],
                    ['PRESENT VALUE', fmtINR(liveSummary.presentValue), C.text],
                    ['EQUITY P&L', fmtINR(liveSummary.pnl), liveSummary.pnl>=0?C.pos:C.neg],
                    ['MF VALUE', fmtINR(portfolio.mfSummary.presentValue), C.cyan],
                    ['TOTAL PORTFOLIO', fmtINR(liveSummary.presentValue + portfolio.mfSummary.presentValue), C.blue],
                ].map(([k,v,col]) => (
                    <div key={k} style={{ background:C.surface, borderRadius:8, padding:'8px 12px', flex:1, minWidth:100 }}>
                        <div style={{ fontSize:9, color:C.muted, letterSpacing:'.06em', marginBottom:3 }}>{k}</div>
                        <div style={{ fontSize:14, fontWeight:800, color:col }}>{v}</div>
                    </div>
                ))}
            </div>

            {/* Analyst verdict counts */}
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
                {Object.entries(byTag).map(([tag, list]) => {
                    const vm = V[tag];
                    if (!list.length) return null;
                    return (
                        <div key={tag} style={{ background:vm.bg, border:`1px solid ${vm.border}44`, borderRadius:20, padding:'4px 12px', fontSize:11, color:vm.text, fontWeight:700 }}>
                            {vm.icon} {list.length} {vm.label}
                        </div>
                    );
                })}
            </div>

            {/* Risk flags */}
            {pledgedStocks.length > 0 && (
                <div style={{ background:'#1c0505', border:`1px solid ${C.neg}44`, borderRadius:8, padding:'10px 14px', marginBottom:12 }}>
                    <div style={{ fontWeight:700, color:C.neg, fontSize:12, marginBottom:4 }}>⚠ PLEDGED SHARES DETECTED — {pledgedStocks.length} positions · {fmtINR(totalPledgedValue)} at risk</div>
                    {pledgedStocks.map(h => (
                        <div key={h.ticker} style={{ fontSize:11, color:'#fca5a5', marginTop:2 }}>
                            {h.ticker}: {h.pledgedTotal} shares pledged · CMP {fmtINR(h.liveCmp)} · Avg cost {fmtINR(h.avgBuy)} · {fmtPct(h.livePnlPct)}
                        </div>
                    ))}
                    <div style={{ fontSize:10, color:'#f87171', marginTop:6 }}>
                        Pledged shares face forced liquidation if LTV falls below broker threshold. Monitor closely — do not let CMP fall below cost × 0.8.
                    </div>
                </div>
            )}

            {/* Two columns: performers + sector */}
            <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                {/* Top performers */}
                <div style={{ flex:1, minWidth:220 }}>
                    <div style={{ fontSize:10, color:C.muted, fontWeight:700, letterSpacing:'.06em', marginBottom:6 }}>TOP PERFORMERS</div>
                    {topPerformers.map(h => (
                        <div key={h.ticker} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:`1px solid ${C.border}`, fontSize:12 }}>
                            <span style={{ color:C.text, fontWeight:700 }}>{h.ticker}</span>
                            <span style={{ color:C.pos, fontWeight:700 }}>{fmtPct(h.livePnlPct)} · {fmtINR(h.livePnl)}</span>
                        </div>
                    ))}
                    <div style={{ fontSize:10, color:C.muted, fontWeight:700, letterSpacing:'.06em', marginTop:10, marginBottom:6 }}>UNDERPERFORMERS</div>
                    {bottomPerformers.map(h => (
                        <div key={h.ticker} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:`1px solid ${C.border}`, fontSize:12 }}>
                            <span style={{ color:C.text, fontWeight:700 }}>{h.ticker}</span>
                            <span style={{ color:C.neg, fontWeight:700 }}>{fmtPct(h.livePnlPct)} · {fmtINR(h.livePnl)}</span>
                        </div>
                    ))}
                </div>

                {/* Sector allocation */}
                <div style={{ flex:1, minWidth:220 }}>
                    <div style={{ fontSize:10, color:C.muted, fontWeight:700, letterSpacing:'.06em', marginBottom:6 }}>SECTOR ALLOCATION (EQUITY)</div>
                    {topSectors.map(([sector, val]) => {
                        const pct = (val / totalEqValue) * 100;
                        return (
                            <div key={sector} style={{ marginBottom:6 }}>
                                <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:2 }}>
                                    <span style={{ color:C.text }}>{sector}</span>
                                    <span style={{ color:C.muted }}>{fmtINR(val)} · {pct.toFixed(1)}%</span>
                                </div>
                                <div style={{ background:C.border, borderRadius:4, height:4 }}>
                                    <div style={{ background:C.blue, width:`${pct}%`, height:4, borderRadius:4 }} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div style={{ marginTop:12, fontSize:10, color:'#334155' }}>
                Analyst verdicts are algorithmic screener outputs. Not SEBI-registered research or investment advice. Consult a SEBI-registered advisor before acting on any signal.
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// EARNINGS CALENDAR
// ─────────────────────────────────────────────────────────────────────────────
const EarningsCalendar = ({ token }) => {
    const [data,    setData]    = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/portfolio/earnings', { headers:{'x-portfolio-token':token} })
            .then(r => r.json()).then(setData).catch(()=>setData(null))
            .finally(() => setLoading(false));
    }, [token]);

    const upcoming = data?.earnings || [];

    return (
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:16, marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.muted, letterSpacing:'.06em', marginBottom:12 }}>EARNINGS CALENDAR — NEXT 90 DAYS</div>
            {loading && <div style={{ color:C.muted, fontSize:12 }}>Fetching earnings dates…</div>}
            {!loading && !upcoming.length && (
                <div style={{ color:C.muted, fontSize:12 }}>No upcoming earnings dates found in next 90 days. Results typically declared within 45 days of quarter-end.</div>
            )}
            {!loading && upcoming.length > 0 && (
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                    {upcoming.map(e => {
                        const urgent = e.daysAway <= 7;
                        const soon   = e.daysAway <= 21;
                        const col    = urgent ? C.neg : soon ? C.warn : C.muted;
                        return (
                            <div key={e.ticker} style={{ background:urgent?'#1c0505':soon?'#1c1404':C.surface, border:`1px solid ${col}44`, borderRadius:8, padding:'8px 12px', minWidth:110 }}>
                                <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{e.ticker}</div>
                                <div style={{ fontSize:11, color:col, fontWeight:700 }}>{e.date}</div>
                                <div style={{ fontSize:10, color:C.muted }}>{e.daysAway === 0 ? 'TODAY' : `in ${e.daysAway}d`}</div>
                                {e.peForward && <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>Fwd PE: {e.peForward.toFixed(1)}</div>}
                            </div>
                        );
                    })}
                </div>
            )}
            <div style={{ marginTop:10, fontSize:10, color:'#334155' }}>
                Earnings dates from Yahoo Finance — may be estimates. Verify with NSE corporate actions page.
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// HOLDING ROW + EXPANDED DETAIL (with news + events)
// ─────────────────────────────────────────────────────────────────────────────
const StockDetail = ({ ticker, token }) => {
    const [data,    setData]    = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true); setData(null);
        fetch(`/api/portfolio/stock-detail?ticker=${ticker}`, { headers:{'x-portfolio-token':token} })
            .then(r => r.json()).then(setData).catch(()=>setData(null))
            .finally(() => setLoading(false));
    }, [ticker, token]);

    if (loading) return <div style={{ padding:'12px 0', color:C.muted, fontSize:12 }}>Loading {ticker} details…</div>;
    if (!data)   return <div style={{ padding:'12px 0', color:C.neg,  fontSize:12 }}>Could not fetch details for {ticker}.</div>;

    const sentCol = (s) => s==='bullish'||s==='mildly_bullish'?C.pos : s==='bearish'||s==='mildly_bearish'?C.neg : C.muted;

    return (
        <div style={{ padding:'12px 0 4px', display:'flex', flexDirection:'column', gap:14 }}>
            {/* Key metrics */}
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {[
                    ['CMP',       data.cmp        ? fmtINR(data.cmp)         : '—', data.change1d>=0?C.pos:C.neg],
                    ['1D CHG',    fmtPct(data.change1d),                              data.change1d>=0?C.pos:C.neg],
                    ['RSI',       data.rsi ? data.rsi : '—',                          data.rsi<35?C.pos:data.rsi>65?C.neg:C.muted],
                    ['P/E',       data.pe  ? data.pe.toFixed(1)  : '—',               C.text],
                    ['P/B',       data.pb  ? data.pb.toFixed(2)  : '—',               C.text],
                    ['52W HIGH',  data.high52 ? fmtINR(data.high52) : '—',            C.muted],
                    ['% FROM 52H',data.pctFromHigh!=null?fmtPct(data.pctFromHigh):'—',data.pctFromHigh<=-20?C.warn:C.muted],
                    ['MKT CAP',   fmtCr(data.marketCap),                              C.muted],
                    ['DIV YIELD', data.dividendYield ? data.dividendYield+'%' : '—', C.cyan],
                    ['EARNINGS',  data.earningsDate || 'N/A',                          data.earningsDate ? C.warn : C.muted],
                ].map(([k,v,col]) => (
                    <div key={k} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:'7px 10px', minWidth:80 }}>
                        <div style={{ fontSize:9, color:C.muted, letterSpacing:'.05em', marginBottom:2 }}>{k}</div>
                        <div style={{ fontSize:12, fontWeight:700, color:col }}>{v}</div>
                    </div>
                ))}
            </div>

            {/* Analyst note */}
            <div style={{ background: V[data.analystTag]?.bg || C.surface, border:`1px solid ${V[data.analystTag]?.border || C.border}44`, borderRadius:8, padding:'10px 12px' }}>
                <div style={{ fontSize:11, fontWeight:700, color:V[data.analystTag]?.text || C.text, marginBottom:4 }}>
                    {V[data.analystTag]?.icon} {V[data.analystTag]?.label || data.analystTag} — Head of Equity Research Note
                </div>
                <div style={{ fontSize:12, color:C.text, lineHeight:1.6 }}>{data.analystReason}</div>
            </div>

            {/* News */}
            {data.news?.length > 0 && (
                <div>
                    <div style={{ fontSize:10, color:C.muted, fontWeight:700, letterSpacing:'.06em', marginBottom:7 }}>RECENT NEWS & EVENTS — {ticker}</div>
                    {data.news.map((n, i) => (
                        <div key={i} style={{ display:'flex', gap:8, padding:'6px 0', borderBottom:`1px solid ${C.border}`, alignItems:'flex-start' }}>
                            <div style={{ width:7, height:7, borderRadius:'50%', background:sentCol(n.sentiment), flexShrink:0, marginTop:4 }} />
                            <div style={{ flex:1 }}>
                                <a href={n.link} target="_blank" rel="noreferrer" style={{ color:C.text, fontSize:12, lineHeight:1.4, textDecoration:'none' }}>{n.title}</a>
                                <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>
                                    {n.publisher} · {n.time}
                                    <span style={{ marginLeft:6, color:sentCol(n.sentiment), fontWeight:600 }}>{n.sentiment?.replace('_',' ')}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const HoldingRow = ({ h, expanded, onToggle, token }) => {
    const vm  = V[h.analystTag] || V.HOLD;
    const isPledge = h.isPledged;

    return (
        <div style={{ borderBottom:`1px solid ${C.border}` }}>
            <div onClick={onToggle} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer', background:expanded?'#0a1628':'transparent' }}>
                {/* Verdict badge */}
                <div style={{ minWidth:108, background:vm.bg, border:`1px solid ${vm.border}55`, borderRadius:6, padding:'3px 8px', textAlign:'center', fontSize:10, color:vm.text, fontWeight:700, letterSpacing:'.04em', flexShrink:0 }}>
                    {vm.icon} {vm.label}
                </div>

                <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                        <span style={{ fontWeight:800, color:C.text, fontSize:14 }}>{h.ticker}</span>
                        <span style={{ fontSize:10, color:C.muted }}>{h.sector}</span>
                        {isPledge && <span style={{ fontSize:9, color:C.neg, background:'#1c0505', border:`1px solid ${C.neg}44`, borderRadius:4, padding:'1px 5px', fontWeight:700 }}>PLEDGED</span>}
                        <span style={{ fontSize:11, color: h.change1d>=0?C.pos:C.neg }}>{fmtPct(h.change1d)} today</span>
                    </div>
                    <div style={{ fontSize:10, color:C.muted, marginTop:1 }}>
                        Qty {h.qtyLT} · Avg {fmtINR(h.avgBuy)} · CMP {fmtINR(h.liveCmp)}
                    </div>
                </div>

                <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ fontWeight:700, color:C.text, fontSize:13 }}>{fmtINR(h.liveValue)}</div>
                    <div style={{ fontSize:11, fontWeight:700, color:h.livePnlPct>=0?C.pos:C.neg }}>
                        {fmtPct(h.livePnlPct)} · {h.livePnl>=0?'+':''}{fmtINR(h.livePnl)}
                    </div>
                </div>
                <div style={{ color:C.muted, fontSize:11, flexShrink:0 }}>{expanded?'▲':'▼'}</div>
            </div>

            {expanded && (
                <div style={{ padding:'0 14px 14px', background:'#080d1c' }}>
                    <StockDetail ticker={h.ticker} token={token} />
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// MF SECTION
// ─────────────────────────────────────────────────────────────────────────────
const MFSection = ({ mf, summary }) => (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:16, marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8 }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.muted, letterSpacing:'.06em' }}>MUTUAL FUNDS — ELSS TAX SAVER</div>
            <div style={{ fontSize:12, color:C.cyan, fontWeight:700 }}>
                {fmtINR(summary.invested)} invested → {fmtINR(summary.presentValue)} · {fmtPct(summary.pnlPct)}
            </div>
        </div>
        {mf.map(f => (
            <div key={f.isin} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:`1px solid ${C.border}`, flexWrap:'wrap', gap:4 }}>
                <div style={{ flex:1, minWidth:200 }}>
                    <div style={{ fontSize:12, color:C.text, fontWeight:600 }}>{f.name}</div>
                    <div style={{ fontSize:10, color:C.muted }}>Qty {f.qty.toFixed(3)} · Avg NAV {fmtINR(f.avgNav)} · Current {fmtINR(f.nav)}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{fmtINR(f.nav * f.qty)}</div>
                    <div style={{ fontSize:11, fontWeight:700, color:f.pnlPct>=0?C.pos:C.neg }}>{fmtPct(f.pnlPct)} · {fmtINR(f.pnl)}</div>
                </div>
            </div>
        ))}
        <div style={{ marginTop:8, fontSize:10, color:'#334155' }}>
            ELSS funds have a 3-year lock-in period. NAVs are as of last available date. LTCG applies after lock-in expiry.
        </div>
    </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// SORT & FILTER BAR
// ─────────────────────────────────────────────────────────────────────────────
const SORT_OPTIONS = [
    ['pnlPct_desc','Best P&L'],['pnlPct_asc','Worst P&L'],
    ['value_desc','Largest Position'],['ticker_asc','A→Z'],
    ['tag','By Verdict'],
];

const FILTER_OPTIONS = ['ALL','HIGH_CONVICTION','HOLD','REVIEW','CRITICAL_RISK'];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function PortfolioIntelligence() {
    const [session,  setSession]  = useState(() => {
        try { return JSON.parse(localStorage.getItem('portfolio_session')); } catch { return null; }
    });
    const [portfolio,setPortfolio]= useState(null);
    const [loading,  setLoading]  = useState(false);
    const [expanded, setExpanded] = useState(null);
    const [sort,     setSort]     = useState('tag');
    const [filter,   setFilter]   = useState('ALL');
    const [tab,      setTab]      = useState('equity'); // equity | mf | earnings

    const login = useCallback((sess) => {
        localStorage.setItem('portfolio_session', JSON.stringify(sess));
        setSession(sess);
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem('portfolio_session');
        setSession(null); setPortfolio(null);
    }, []);

    const fetchPortfolio = useCallback(async (token) => {
        setLoading(true);
        try {
            const r = await fetch('/api/portfolio/hb6115', { headers:{'x-portfolio-token':token} });
            if (!r.ok) { logout(); return; }
            setPortfolio(await r.json());
        } catch { /* silent */ } finally { setLoading(false); }
    }, [logout]);

    useEffect(() => {
        if (session?.token) fetchPortfolio(session.token);
    }, [session, fetchPortfolio]);

    if (!session) return <LoginScreen onLogin={login} />;

    // Sort & filter holdings
    const TAG_ORDER = { CRITICAL_RISK:0, REVIEW:1, HIGH_CONVICTION:2, HOLD:3 };
    let holdings = portfolio?.equity || [];

    if (filter !== 'ALL') holdings = holdings.filter(h => h.analystTag === filter);

    switch (sort) {
        case 'pnlPct_desc': holdings = [...holdings].sort((a,b)=>b.livePnlPct-a.livePnlPct); break;
        case 'pnlPct_asc':  holdings = [...holdings].sort((a,b)=>a.livePnlPct-b.livePnlPct); break;
        case 'value_desc':  holdings = [...holdings].sort((a,b)=>b.liveValue-a.liveValue); break;
        case 'ticker_asc':  holdings = [...holdings].sort((a,b)=>a.ticker.localeCompare(b.ticker)); break;
        case 'tag':         holdings = [...holdings].sort((a,b)=>(TAG_ORDER[a.analystTag]??9)-(TAG_ORDER[b.analystTag]??9)); break;
        default: break;
    }

    return (
        <div style={{ maxWidth:960, margin:'0 auto', padding:'16px 12px', fontFamily:"'JetBrains Mono','Fira Code',monospace" }}>
            {/* Header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:8 }}>
                <div>
                    <div style={{ fontSize:15, fontWeight:800, color:C.text }}>◈ Portfolio Intelligence</div>
                    <div style={{ fontSize:11, color:C.muted }}>Client: {session.clientId} · {session.name}</div>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                    <button onClick={() => portfolio && fetchPortfolio(session.token)} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:7, padding:'6px 12px', color:C.muted, cursor:'pointer', fontSize:12 }}>
                        ↻ Refresh
                    </button>
                    <button onClick={logout} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:7, padding:'6px 12px', color:C.muted, cursor:'pointer', fontSize:12 }}>
                        Sign out
                    </button>
                </div>
            </div>

            {loading && !portfolio && <div style={{ textAlign:'center', padding:60, color:C.muted }}>Loading portfolio…</div>}

            {portfolio && (
                <>
                    {/* Analyst summary */}
                    <AnalystSummary portfolio={portfolio} />

                    {/* Tab bar */}
                    <div style={{ display:'flex', gap:0, marginBottom:14, background:C.surface, borderRadius:10, padding:4, border:`1px solid ${C.border}` }}>
                        {[['equity',`Equity (${portfolio.equity.length})`],['mf','Mutual Funds'],['earnings','Earnings']].map(([t,l]) => (
                            <button key={t} onClick={()=>setTab(t)} style={{ flex:1, background:tab===t?C.blue:'transparent', color:tab===t?'#fff':C.muted, border:'none', borderRadius:8, padding:'8px 0', cursor:'pointer', fontSize:12, fontWeight:600 }}>
                                {l}
                            </button>
                        ))}
                    </div>

                    {tab === 'equity' && (
                        <>
                            {/* Sort + filter */}
                            <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
                                <select value={sort} onChange={e=>setSort(e.target.value)} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:7, color:C.text, padding:'6px 10px', fontSize:12, cursor:'pointer' }}>
                                    {SORT_OPTIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                                </select>
                                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                                    {FILTER_OPTIONS.map(f => (
                                        <button key={f} onClick={()=>setFilter(f)} style={{ background:filter===f?(V[f]?.bg||C.blue):C.card, border:`1px solid ${filter===f?(V[f]?.border||C.blue):C.border}`, borderRadius:20, padding:'4px 10px', color:filter===f?(V[f]?.text||'#fff'):C.muted, cursor:'pointer', fontSize:10, fontWeight:700 }}>
                                            {f.replace('_',' ')}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Holdings list */}
                            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden', marginBottom:16 }}>
                                {holdings.map(h => (
                                    <HoldingRow
                                        key={h.ticker} h={h} token={session.token}
                                        expanded={expanded === h.ticker}
                                        onToggle={() => setExpanded(t => t===h.ticker?null:h.ticker)}
                                    />
                                ))}
                            </div>
                        </>
                    )}

                    {tab === 'mf' && (
                        <MFSection mf={portfolio.mf} summary={portfolio.mfSummary} />
                    )}

                    {tab === 'earnings' && (
                        <EarningsCalendar token={session.token} />
                    )}
                </>
            )}

            {/* Global disclaimer */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:'9px 14px', fontSize:10, color:'#334155', lineHeight:1.6 }}>
                <strong style={{ color:C.muted }}>Important:</strong> All analyst verdicts, signals, and screener outputs are generated algorithmically and are for informational purposes only. Astraeus is not a SEBI-registered Research Analyst or Investment Advisor. Past performance does not guarantee future returns. Capital invested in equities is subject to market risk. Pledged shares carry additional margin call risk. Tax implications are indicative — consult a Chartered Accountant.
            </div>
        </div>
    );
}
