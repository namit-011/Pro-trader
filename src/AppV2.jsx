import { useState, useEffect, useCallback, useRef } from 'react';
import PortfolioIntelligence from './components/PortfolioIntelligence.jsx';
import SignalCard from './components/SignalCard.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const T = {
    bg:       '#050a14',
    surface:  '#080e1a',
    card:     '#0a1628',
    border:   '#1a2744',
    borderSoft:'#111d35',
    text:     '#e2e8f0',
    muted:    '#64748b',
    subtle:   '#1e3a5f',
    accent:   '#3b82f6',
    accentGlow:'#3b82f633',
    pos:      '#22c55e',
    neg:      '#ef4444',
    warn:     '#f59e0b',
    purple:   '#8b5cf6',
};

const css = (obj) => obj; // inline style passthrough

// ─────────────────────────────────────────────────────────────────────────────
// SMALL HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const fmtINR = (n) => '₹' + Math.abs(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtPct = (n) => (n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%');
const API = '/api';

const useFetch = (url, ttlMs = 60000) => {
    const [data, setData]   = useState(null);
    const [loading, setLd]  = useState(false);
    const cacheRef = useRef({});
    const fetch_ = useCallback(async () => {
        const cached = cacheRef.current[url];
        if (cached && Date.now() - cached.ts < ttlMs) { setData(cached.d); return; }
        setLd(true);
        try {
            const r = await fetch(url);
            const d = await r.json();
            cacheRef.current[url] = { d, ts: Date.now() };
            setData(d);
        } catch { /* non-fatal */ } finally { setLd(false); }
    }, [url, ttlMs]);
    useEffect(() => { fetch_(); }, [fetch_]);
    return { data, loading, refetch: fetch_ };
};

// ─────────────────────────────────────────────────────────────────────────────
// SIDEBAR NAV
// ─────────────────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
    { id: 'dashboard', icon: '⬡', label: 'Dashboard' },
    { id: 'portfolio', icon: '◈', label: 'Portfolio'  },
    { id: 'rotation',  icon: '↻', label: 'Rotation'   },
    { id: 'markets',   icon: '⊕', label: 'Markets'    },
    { id: 'signals',   icon: '⊿', label: 'Signals'    },
    { id: 'terminal',  icon: '⊞', label: 'Terminal'   },
];

const Sidebar = ({ active, onNav, onSwitchToV1, collapsed }) => (
    <aside style={{
        width: collapsed ? 56 : 200, minWidth: collapsed ? 56 : 200,
        background: T.surface, borderRight: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', transition: 'width .2s',
        zIndex: 20, overflow: 'hidden',
    }}>
        {/* Logo */}
        <div style={{ padding: collapsed ? '18px 12px' : '18px 16px', borderBottom: `1px solid ${T.borderSoft}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg,${T.accent},${T.purple})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>⬡</div>
            {!collapsed && <div style={{ fontWeight: 800, fontSize: 15, color: T.text, letterSpacing: '.05em' }}>ASTRAEUS<span style={{ color: T.accent, fontSize: 10, marginLeft: 4 }}>V2</span></div>}
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '10px 0' }}>
            {NAV_ITEMS.map(({ id, icon, label }) => {
                const isActive = active === id;
                return (
                    <button key={id} onClick={() => onNav(id)} style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                        padding: collapsed ? '10px 14px' : '10px 16px',
                        background: isActive ? T.accentGlow : 'transparent',
                        border: 'none', borderLeft: `3px solid ${isActive ? T.accent : 'transparent'}`,
                        color: isActive ? T.accent : T.muted, cursor: 'pointer',
                        fontSize: 13, fontWeight: isActive ? 700 : 400, transition: 'all .15s',
                        textAlign: 'left',
                    }}>
                        <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
                        {!collapsed && label}
                    </button>
                );
            })}
        </nav>

        {/* V1 link */}
        <div style={{ padding: collapsed ? '12px 10px' : '12px 14px', borderTop: `1px solid ${T.borderSoft}` }}>
            <button onClick={onSwitchToV1} style={{
                width: '100%', background: T.card, border: `1px solid ${T.border}`,
                borderRadius: 8, padding: collapsed ? '8px 6px' : '8px 12px',
                color: T.muted, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6, justifyContent: collapsed ? 'center' : 'flex-start',
            }}>
                <span>←</span>
                {!collapsed && 'Back to V1'}
            </button>
        </div>
    </aside>
);

// ─────────────────────────────────────────────────────────────────────────────
// TOP HEADER BAR
// ─────────────────────────────────────────────────────────────────────────────
const Header = ({ view, gti, clock, onToggleSidebar }) => {
    const gtiColor = gti?.score >= 70 ? T.neg : gti?.score >= 45 ? T.warn : T.pos;
    return (
        <header style={{
            height: 52, background: T.surface, borderBottom: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0,
        }}>
            <button onClick={onToggleSidebar} style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', fontSize: 18, padding: '0 4px', lineHeight: 1 }}>☰</button>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.text, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                {NAV_ITEMS.find(n => n.id === view)?.label || view}
            </div>
            {/* GTI pill */}
            {gti && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: T.card, border: `1px solid ${gtiColor}33`, borderRadius: 20, padding: '4px 10px' }}>
                    <span style={{ fontSize: 11, color: T.muted }}>GTI</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: gtiColor }}>{gti.score}</span>
                    <span style={{ fontSize: 10, color: gtiColor }}>{gti.level}</span>
                </div>
            )}
            {/* Clock */}
            <div style={{ fontSize: 12, color: T.muted, fontVariantNumeric: 'tabular-nums' }}>{clock}</div>
        </header>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// STAT CARD (reusable)
// ─────────────────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, colour, icon }) => (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 16px', flex: 1, minWidth: 130 }}>
        <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, letterSpacing: '.06em', marginBottom: 6 }}>{icon && <span style={{ marginRight: 4 }}>{icon}</span>}{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: colour || T.text, lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>{sub}</div>}
    </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTOR HEAT TILE
// ─────────────────────────────────────────────────────────────────────────────
const HeatTile = ({ sector, heat, rank, onClick, small }) => {
    const hot  = heat > 3, cold = heat < -3;
    const col  = hot ? T.pos : cold ? T.neg : T.muted;
    const bg   = hot ? '#052e16' : cold ? '#1c0505' : T.card;
    return (
        <div onClick={onClick} style={{
            background: bg, border: `1px solid ${col}44`, borderRadius: 10,
            padding: small ? '8px 10px' : '12px 14px',
            cursor: onClick ? 'pointer' : 'default', transition: 'border .15s',
            minWidth: small ? 90 : 110,
        }}>
            <div style={{ fontSize: 10, color: T.muted, marginBottom: 2 }}>#{rank}</div>
            <div style={{ fontSize: small ? 12 : 13, fontWeight: 700, color: col }}>{sector}</div>
            <div style={{ fontSize: small ? 18 : 22, fontWeight: 800, color: col, lineHeight: 1.2 }}>
                {heat > 0 ? '+' : ''}{heat?.toFixed(1)}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// VIEW: DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
const DashboardView = ({ gti, rotation, movers, news, onNav }) => {
    const ranked = rotation?.ranked || [];
    const top3   = ranked.slice(0, 3);
    const bottom3= ranked.slice(-3).reverse();
    const cb     = rotation?.circuitBreaker;

    return (
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Circuit breaker */}
            {cb?.active && (
                <div style={{ background: '#1c0505', border: `1px solid ${T.neg}44`, borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 12 }}>
                    <span style={{ color: T.neg, fontSize: 20 }}>⚠</span>
                    <div>
                        <div style={{ color: '#fca5a5', fontWeight: 700, fontSize: 13 }}>Market Stress Mode</div>
                        <div style={{ color: '#f87171', fontSize: 12, marginTop: 2 }}>{cb.reason}</div>
                    </div>
                </div>
            )}

            {/* Top stat row */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <StatCard label="GTI SCORE" value={gti?.score ?? '—'} sub={gti?.level} colour={gti?.score >= 70 ? T.neg : gti?.score >= 45 ? T.warn : T.pos} icon="⬡" />
                <StatCard label="TOP ROTATION" value={top3[0]?.sector || '—'} sub={top3[0] ? `Heat ${top3[0].heat?.toFixed(1)}` : ''} colour={T.pos} icon="↑" />
                <StatCard label="WEAKEST SECTOR" value={bottom3[0]?.sector || '—'} sub={bottom3[0] ? `Heat ${bottom3[0].heat?.toFixed(1)}` : ''} colour={T.neg} icon="↓" />
                {movers?.gainers?.[0] && (
                    <StatCard label="TOP GAINER" value={movers.gainers[0].symbol?.replace('.NS','')} sub={fmtPct(movers.gainers[0].change)} colour={T.pos} icon="▲" />
                )}
                {movers?.losers?.[0] && (
                    <StatCard label="TOP LOSER" value={movers.losers[0].symbol?.replace('.NS','')} sub={fmtPct(movers.losers[0].change)} colour={T.neg} icon="▼" />
                )}
            </div>

            {/* Rotation heatmap */}
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, letterSpacing: '.06em' }}>SECTOR ROTATION HEAT</div>
                    <button onClick={() => onNav('rotation')} style={{ background: 'none', border: 'none', color: T.accent, cursor: 'pointer', fontSize: 12 }}>View all →</button>
                </div>
                {rotation?.dampening < 1 && (
                    <div style={{ fontSize: 11, color: T.warn, marginBottom: 8 }}>
                        ⚑ Macro event detected — signals dampened {((1 - rotation.dampening) * 100).toFixed(0)}%
                    </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {ranked.map(r => <HeatTile key={r.sector} {...r} onClick={() => onNav('rotation')} small />)}
                </div>
                {rotation?.concentrationWarning?.warning && (
                    <div style={{ marginTop: 10, fontSize: 11, color: T.warn, background: '#1c140422', borderRadius: 6, padding: '6px 10px' }}>
                        ⚑ {rotation.concentrationWarning.message}
                    </div>
                )}
            </div>

            {/* Two-column: movers + news */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {/* Movers */}
                <div style={{ flex: 1, minWidth: 260, background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, letterSpacing: '.06em', marginBottom: 10 }}>TOP MOVERS TODAY</div>
                    {[...(movers?.gainers || []).slice(0,3), ...(movers?.losers || []).slice(0,3)].map(s => (
                        <div key={s.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${T.borderSoft}` }}>
                            <div>
                                <div style={{ fontWeight: 700, color: T.text, fontSize: 13 }}>{s.symbol?.replace('.NS','')}</div>
                                <div style={{ fontSize: 11, color: T.muted }}>{fmtINR(s.price)}</div>
                            </div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: s.change >= 0 ? T.pos : T.neg }}>{fmtPct(s.change)}</div>
                        </div>
                    ))}
                </div>

                {/* News feed */}
                <div style={{ flex: 2, minWidth: 300, background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, letterSpacing: '.06em', marginBottom: 10 }}>MARKET NEWS</div>
                    {(news || []).slice(0, 8).map((n, i) => {
                        const sc = n.sentiment;
                        const scCol = sc === 'bullish' || sc === 'mildly_bullish' ? T.pos : sc === 'bearish' || sc === 'mildly_bearish' ? T.neg : T.muted;
                        return (
                            <div key={i} style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: `1px solid ${T.borderSoft}`, alignItems: 'flex-start' }}>
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: scCol, flexShrink: 0, marginTop: 5 }} />
                                <div>
                                    <a href={n.link} target="_blank" rel="noreferrer" style={{ color: T.text, fontSize: 12, lineHeight: 1.4, textDecoration: 'none' }}>{n.title}</a>
                                    <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{n.publisher} · {n.time}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// VIEW: ROTATION
// ─────────────────────────────────────────────────────────────────────────────
const SECTOR_STOCKS = {
    Banking:       ['HDFCBANK','ICICIBANK','KOTAKBANK','AXISBANK','SBIN','INDUSINDBK'],
    IT:            ['TCS','INFY','WIPRO','HCLTECH','TECHM'],
    Energy:        ['RELIANCE','ONGC','BPCL','TATAPOWER','ADANIGREEN'],
    Pharma:        ['SUNPHARMA','CIPLA','DRREDDY','DIVISLAB','LUPIN'],
    Auto:          ['MARUTI','TATAMOTORS','M&M','BAJAJ-AUTO','EICHERMOT'],
    Metals:        ['TATASTEEL','JSWSTEEL','HINDALCO','COALINDIA','NMDC'],
    FMCG:          ['HINDUNILVR','ITC','NESTLEIND','BRITANNIA','TATACONSUM'],
    Finance:       ['BAJFINANCE','BAJAJFINSV','CHOLAFIN','MUTHOOTFIN','SBICARD'],
    Realty:        ['DLF','GODREJPROP','ULTRACEMCO','AMBUJACEM','SHREECEM'],
    Infrastructure:['LT','ADANIPORTS','ADANIENT','BEL','SIEMENS'],
};

const RotationView = ({ rotation }) => {
    const [selected, setSelected] = useState(null);
    const ranked = rotation?.ranked || [];

    const activeSector = selected || ranked[0]?.sector;
    const sectorData   = rotation?.sectors?.[activeSector] || {};
    const stocks       = SECTOR_STOCKS[activeSector] || [];

    return (
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Disclaimer */}
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '9px 14px', fontSize: 11, color: T.muted }}>
                <strong style={{ color: '#94a3b8' }}>Screener output only.</strong> Not SEBI-registered investment advice. Sector heat scores are algorithmic and may lag institutional price discovery. Always verify signals independently.
            </div>

            {/* Heat grid */}
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, letterSpacing: '.06em', marginBottom: 12 }}>CLICK A SECTOR TO DRILL DOWN</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {ranked.map(r => (
                        <HeatTile
                            key={r.sector} {...r}
                            onClick={() => setSelected(r.sector)}
                        />
                    ))}
                </div>
            </div>

            {/* Sector detail panel */}
            {activeSector && (
                <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                        <div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>{activeSector}</div>
                            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                                Heat: <span style={{ color: (sectorData.heat || 0) > 0 ? T.pos : T.neg, fontWeight: 700 }}>{sectorData.heat?.toFixed(1)}</span>
                                {' · '}Price 30d: <span style={{ color: (sectorData.priceMomentum30d || 0) >= 0 ? T.pos : T.neg, fontWeight: 700 }}>{fmtPct(sectorData.priceMomentum30d)}</span>
                                {' · '}Sentiment avg: <span style={{ color: T.text, fontWeight: 700 }}>{sectorData.sentimentAvg?.toFixed(2)}</span>
                            </div>
                        </div>
                        {sectorData.heat > 3 && (
                            <div style={{ background: '#052e16', border: `1px solid ${T.pos}44`, borderRadius: 20, padding: '4px 12px', fontSize: 11, color: T.pos, fontWeight: 700 }}>↑ ROTATING IN</div>
                        )}
                        {sectorData.heat < -3 && (
                            <div style={{ background: '#1c0505', border: `1px solid ${T.neg}44`, borderRadius: 20, padding: '4px 12px', fontSize: 11, color: T.neg, fontWeight: 700 }}>↓ ROTATING OUT</div>
                        )}
                    </div>

                    {/* Component breakdown */}
                    {sectorData.components && (
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                            {[
                                ['Sentiment',   sectorData.components.sentNorm,  0.30],
                                ['Price Mom',   sectorData.components.priceNorm, 0.35],
                                ['Volume',      sectorData.components.volNorm,   0.15],
                                ['FII Flow',    sectorData.components.fiiNorm,   0.20],
                            ].map(([k, v, w]) => (
                                <div key={k} style={{ flex: 1, minWidth: 90, background: T.surface, borderRadius: 8, padding: '8px 10px' }}>
                                    <div style={{ fontSize: 10, color: T.muted, marginBottom: 4 }}>{k} <span style={{ color: '#475569' }}>×{(w*100).toFixed(0)}%</span></div>
                                    <div style={{ fontSize: 15, fontWeight: 800, color: v > 0.1 ? T.pos : v < -0.1 ? T.neg : T.muted }}>
                                        {v > 0 ? '+' : ''}{(v * 10).toFixed(1)}
                                    </div>
                                    <div style={{ background: T.border, borderRadius: 4, height: 3, marginTop: 4, overflow: 'hidden' }}>
                                        <div style={{ background: v > 0 ? T.pos : T.neg, width: `${Math.min(100, Math.abs(v) * 100)}%`, height: '100%', borderRadius: 4 }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Action card */}
                    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: '.06em', marginBottom: 8 }}>SCREENER RESULTS — {activeSector.toUpperCase()}</div>
                        <div style={{ fontSize: 11, color: '#475569', marginBottom: 10 }}>
                            Stocks from this sector ranked by availability. Verify technicals independently before acting.
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {stocks.map(sym => (
                                <div key={sym} style={{
                                    background: T.card, border: `1px solid ${T.border}`, borderRadius: 8,
                                    padding: '8px 12px', fontSize: 12,
                                }}>
                                    <div style={{ fontWeight: 700, color: T.text }}>{sym}</div>
                                    <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{activeSector}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Rotation cost warning */}
                    <div style={{ fontSize: 11, color: T.muted, background: '#0f172a', borderRadius: 6, padding: '8px 10px' }}>
                        💡 Before rotating: estimate your all-in cost (STT + brokerage + capital gains tax) in the <strong style={{ color: T.text }}>Portfolio</strong> tab. A rotation needs to beat that cost to be worthwhile.
                    </div>
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// VIEW: MARKETS (indices + rates + global)
// ─────────────────────────────────────────────────────────────────────────────
const MarketsView = () => {
    const { data: indices } = useFetch(`${API}/indicesbar`, 10000);
    const { data: rates   } = useFetch(`${API}/rates`,     30000);
    const { data: global_ } = useFetch(`${API}/global`,    15000);

    const Section = ({ title, children }) => (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: '.06em', marginBottom: 10 }}>{title}</div>
            {children}
        </div>
    );

    const Row = ({ name, price, changePercent }) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${T.borderSoft}` }}>
            <span style={{ fontSize: 12, color: T.text }}>{name}</span>
            <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{price?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                <div style={{ fontSize: 11, color: (changePercent || 0) >= 0 ? T.pos : T.neg }}>{fmtPct(changePercent)}</div>
            </div>
        </div>
    );

    return (
        <div style={{ padding: 20 }}>
            <Section title="NSE INDICES">
                {(indices || []).map(i => <Row key={i.name} name={i.name} price={i.price} changePercent={i.changePercent} />)}
            </Section>
            <Section title="RATES & COMMODITIES">
                {(rates || []).map(r => <Row key={r.symbol} name={r.name} price={r.price} changePercent={r.changePercent} />)}
            </Section>
            <Section title="GLOBAL MARKETS">
                {(global_ || []).map(g => <Row key={g.symbol} name={g.name} price={g.price} changePercent={g.changePercent} />)}
            </Section>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// VIEW: SIGNALS
// ─────────────────────────────────────────────────────────────────────────────
const SignalsView = () => {
    const { data: signals, loading } = useFetch(`${API}/signals`, 60000);
    const [filter, setFilter] = useState('All');
    const filters = ['All','BUY','SELL','HOLD'];
    const shown = (signals || []).filter(s => filter === 'All' || s.direction === filter || s.action === filter);

    return (
        <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                {filters.map(f => (
                    <button key={f} onClick={() => setFilter(f)} style={{
                        background: filter === f ? T.accent : T.card,
                        border: `1px solid ${filter === f ? T.accent : T.border}`,
                        borderRadius: 20, padding: '5px 14px', cursor: 'pointer',
                        color: filter === f ? '#fff' : T.muted, fontSize: 12, fontWeight: 600,
                    }}>{f}</button>
                ))}
            </div>
            {loading && <div style={{ color: T.muted, textAlign: 'center', padding: 40 }}>Loading signals…</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {shown.map(s => <SignalCard key={s.ticker} signal={s} />)}
            </div>
            {!loading && !shown.length && (
                <div style={{ color: T.muted, textAlign: 'center', padding: 40, fontSize: 13 }}>No signals match this filter.</div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// VIEW: TERMINAL (Quick Quote)
// ─────────────────────────────────────────────────────────────────────────────
const TerminalView = ({ onSwitchToV1 }) => {
    const [search, setSearch]   = useState('');
    const [quote, setQuote]     = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState('');

    const fetchQuote = async (sym) => {
        if (!sym) return;
        setLoading(true); setError(''); setQuote(null);
        try {
            const r = await fetch(`${API}/stock?ticker=${encodeURIComponent(sym)}&period=1d&interval=5m`);
            if (!r.ok) throw new Error('Not found');
            const d = await r.json();
            setQuote(d);
        } catch { setError(`Could not find "${sym}"`); } finally { setLoading(false); }
    };

    return (
        <div style={{ padding: 20 }}>
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, letterSpacing: '.06em', marginBottom: 10 }}>QUICK QUOTE</div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value.toUpperCase())}
                        onKeyDown={e => e.key === 'Enter' && fetchQuote(search)}
                        placeholder="RELIANCE, TCS, HDFCBANK…"
                        style={{ flex: 1, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: '9px 12px', color: T.text, fontSize: 14, outline: 'none' }}
                    />
                    <button onClick={() => fetchQuote(search)} style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                        {loading ? '…' : 'Fetch'}
                    </button>
                </div>
                {error && <div style={{ color: T.neg, fontSize: 12, marginTop: 8 }}>{error}</div>}
            </div>

            {quote && (
                <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{quote.ticker || search}</div>
                            <div style={{ fontSize: 12, color: T.muted }}>{quote.name}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 24, fontWeight: 800, color: T.text }}>
                                {fmtINR(quote.price || quote.regularMarketPrice)}
                            </div>
                            <div style={{ fontSize: 13, color: (quote.changePercent || 0) >= 0 ? T.pos : T.neg, fontWeight: 700 }}>
                                {fmtPct(quote.changePercent)}
                            </div>
                        </div>
                    </div>
                    {quote.signal && (
                        <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {[
                                ['Signal', quote.signal?.action, quote.signal?.action?.includes('BUY') ? T.pos : quote.signal?.action?.includes('SELL') ? T.neg : T.muted],
                                ['RSI', quote.rsi?.toFixed(1), T.text],
                                ['52W High', fmtINR(quote.high52Week), T.muted],
                                ['52W Low',  fmtINR(quote.low52Week),  T.muted],
                            ].filter(([,v]) => v).map(([k, v, c]) => (
                                <div key={k} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 12px' }}>
                                    <div style={{ fontSize: 10, color: T.muted }}>{k}</div>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: c }}>{v}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Full terminal upsell */}
            <div style={{ background: `linear-gradient(135deg,#0a1628,#0f2040)`, border: `1px solid ${T.accent}44`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 6 }}>Full Terminal in V1</div>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 14, maxWidth: 400, margin: '0 auto 14px' }}>
                    Candlestick charts, full option chain, F&O OI analysis, Black-Scholes pricing, and all technical indicators are available in the V1 terminal.
                </div>
                <button onClick={onSwitchToV1} style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                    ← Open V1 Terminal
                </button>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// BOTTOM INDICES TICKER
// ─────────────────────────────────────────────────────────────────────────────
const BottomBar = ({ indices }) => (
    <div style={{
        height: 36, background: T.surface, borderTop: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', overflow: 'hidden', flexShrink: 0,
    }}>
        <div style={{ display: 'flex', gap: 0, overflowX: 'auto', paddingInline: 12, scrollbarWidth: 'none' }}>
            {(indices || []).map(i => (
                <div key={i.name} style={{ display: 'flex', gap: 8, alignItems: 'center', paddingInline: 14, borderRight: `1px solid ${T.borderSoft}`, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: T.muted }}>{i.name?.replace('NIFTY ','')}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{i.price?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: (i.changePercent || 0) >= 0 ? T.pos : T.neg }}>{fmtPct(i.changePercent)}</span>
                </div>
            ))}
        </div>
    </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// ROOT: AppV2
// ─────────────────────────────────────────────────────────────────────────────
export default function AppV2({ onSwitchToV1 }) {
    const [activeView, setActiveView] = useState('dashboard');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [clock, setClock] = useState('');

    // Shared data fetches (used across views)
    const { data: gti }      = useFetch(`${API}/gti`,           90000);
    const { data: rotation } = useFetch(`${API}/sector-rotation`, 300000);
    const { data: movers }   = useFetch(`${API}/movers`,          120000);
    const { data: news }     = useFetch(`${API}/globalnews`,       90000);
    const { data: indices }  = useFetch(`${API}/indicesbar`,       10000);

    // Clock
    useEffect(() => {
        const tick = () => {
            const now = new Date();
            const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
            setClock(ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' IST');
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, []);

    // Mobile: collapse sidebar by default
    useEffect(() => {
        if (window.innerWidth < 640) setSidebarCollapsed(true);
    }, []);

    const renderView = () => {
        switch (activeView) {
            case 'dashboard': return <DashboardView gti={gti} rotation={rotation} movers={movers} news={news} onNav={setActiveView} />;
            case 'portfolio': return <PortfolioIntelligence />;
            case 'rotation':  return <RotationView rotation={rotation} />;
            case 'markets':   return <MarketsView />;
            case 'signals':   return <SignalsView />;
            case 'terminal':  return <TerminalView onSwitchToV1={onSwitchToV1} />;
            default:          return null;
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: T.bg, color: T.text, fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", overflow: 'hidden' }}>
            {/* Layout: sidebar + main column */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <Sidebar
                    active={activeView}
                    onNav={setActiveView}
                    onSwitchToV1={onSwitchToV1}
                    collapsed={sidebarCollapsed}
                />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <Header
                        view={activeView}
                        gti={gti}
                        clock={clock}
                        onToggleSidebar={() => setSidebarCollapsed(c => !c)}
                    />
                    <main style={{ flex: 1, overflowY: 'auto', background: T.bg }}>
                        {renderView()}
                    </main>
                </div>
            </div>
            <BottomBar indices={indices} />
        </div>
    );
}
