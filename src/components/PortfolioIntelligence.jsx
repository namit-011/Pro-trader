import { useState, useCallback, useRef } from 'react';

// ── Verdict colours & icons ───────────────────────────────────────────────────
const VERDICT_META = {
    HOLD:        { colour: '#22c55e', bg: '#052e16', icon: '✓',  label: 'HOLD'        },
    WATCH:       { colour: '#a78bfa', bg: '#1e1b4b', icon: '◈',  label: 'WATCH'       },
    REVIEW:      { colour: '#f59e0b', bg: '#1c1404', icon: '⚑',  label: 'REVIEW'      },
    EXIT_ZONE:   { colour: '#ef4444', bg: '#1c0505', icon: '✕',  label: 'EXIT ZONE'   },
    DEAD_MONEY:  { colour: '#6b7280', bg: '#111827', icon: '—',  label: 'DEAD MONEY'  },
    NEUTRAL:     { colour: '#94a3b8', bg: '#0f172a', icon: '·',  label: 'NEUTRAL'     },
    CORE:        { colour: '#38bdf8', bg: '#082f49', icon: '⬡',  label: 'CORE'        },
    NEGLIGIBLE:  { colour: '#475569', bg: '#0f172a', icon: '○',  label: 'NEGLIGIBLE'  },
};

const fmtINR = (n) => '₹' + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtPct = (n) => (n >= 0 ? '+' : '') + n?.toFixed(2) + '%';

// ── Empty onboarding state ─────────────────────────────────────────────────────
// Test 17: deliver value before portfolio is complete
const Onboarding = ({ onDemoLoad }) => (
    <div style={{ textAlign: 'center', padding: '60px 20px', maxWidth: 520, margin: '0 auto' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>◈</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>
            Portfolio Intelligence
        </div>
        <div style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, marginBottom: 32 }}>
            Add your holdings and get a real-time <strong style={{ color: '#e2e8f0' }}>Portfolio Health Score</strong>,
            detect <strong style={{ color: '#e2e8f0' }}>Dead Money</strong> positions, and see which sectors are
            rotating — personalised to your exact holdings.
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
                onClick={onDemoLoad}
                style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
                Load Demo Portfolio
            </button>
        </div>
        <div style={{ marginTop: 24, fontSize: 11, color: '#475569', lineHeight: 1.6 }}>
            Your portfolio data stays in this browser session only.<br />
            Nothing is sent to any server except for live price lookups.
        </div>
    </div>
);

// ── Compliance disclaimer (Test 3, 21, 23) ────────────────────────────────────
const Disclaimer = () => (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: '#64748b', lineHeight: 1.6, marginBottom: 16 }}>
        <strong style={{ color: '#94a3b8' }}>Screener output only — not investment advice.</strong>{' '}
        Astraeus is not a SEBI-registered Research Analyst or Investment Advisor. All signals are algorithmic screener results
        based on publicly available data. Do not act on any output without consulting a SEBI-registered advisor.
        Past patterns do not guarantee future performance. Tax implications shown are indicative — consult your CA.
        Capital is at risk in all equity investments.
    </div>
);

// ── Circuit breaker banner (Test 25) ─────────────────────────────────────────
const CircuitBreakerBanner = ({ cb }) => {
    if (!cb?.active) return null;
    return (
        <div style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 16px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ color: '#ef4444', fontSize: 18, lineHeight: 1 }}>⚠</span>
            <div>
                <div style={{ color: '#fca5a5', fontWeight: 700, fontSize: 13 }}>Market Stress Mode Active</div>
                <div style={{ color: '#f87171', fontSize: 12, marginTop: 2 }}>{cb.reason}</div>
                <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
                    Exit signals are suppressed. Selling at market bottoms locks in losses permanently.
                    Wait for conditions to stabilise before acting on rotation suggestions.
                </div>
            </div>
        </div>
    );
};

// ── Health Score ring (Test 30: shows what makes it up) ───────────────────────
const HealthScoreCard = ({ score, label, colour, components, deadCapital, deadCapitalPct, gaps, topSectors }) => (
    <div style={{ background: '#0f172a', border: `1px solid ${colour}33`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center', minWidth: 90 }}>
                <div style={{ fontSize: 48, fontWeight: 800, color: colour, lineHeight: 1 }}>{score}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>/ 100</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: colour, marginTop: 4 }}>{label}</div>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
                {components && Object.entries({
                    'Aligned to rotation':      components.alignedToRotation,
                    'Avoiding rotating-out':    components.avoidingRotatingOut,
                    'No dead money':            components.noDeadMoney,
                    'Diversification':          components.diversification,
                }).map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>
                            <span>{k}</span><span style={{ color: '#e2e8f0' }}>{v?.toFixed(1)}</span>
                        </div>
                        <div style={{ background: '#1e293b', borderRadius: 4, height: 4 }}>
                            <div style={{ background: colour, borderRadius: 4, height: 4, width: `${Math.min(100, (v / (k.includes('Aligned') ? 40 : k.includes('Avoiding') ? 25 : k.includes('dead') ? 20 : 15)) * 100)}%` }} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
        {deadCapital > 0 && (
            <div style={{ marginTop: 14, padding: '8px 12px', background: '#1e293b', borderRadius: 8, fontSize: 12, color: '#94a3b8' }}>
                <span style={{ color: '#6b7280', fontWeight: 600 }}>Dead Capital: </span>
                <span style={{ color: '#f59e0b' }}>{fmtINR(deadCapital)} ({deadCapitalPct}%)</span>
                <span> of your portfolio is flat with no catalyst. Opportunity cost compounds daily.</span>
            </div>
        )}
        {gaps?.length > 0 && (
            <div style={{ marginTop: 8, padding: '8px 12px', background: '#1e293b', borderRadius: 8, fontSize: 12, color: '#94a3b8' }}>
                <span style={{ color: '#3b82f6', fontWeight: 600 }}>Missing rotation: </span>
                {gaps.join(', ')} — high-heat sectors with &lt;5% exposure in your portfolio.
            </div>
        )}
    </div>
);

// ── Per-holding row ───────────────────────────────────────────────────────────
const HoldingRow = ({ h, expanded, onToggle }) => {
    const vm = VERDICT_META[h.verdict] || VERDICT_META.NEUTRAL;
    return (
        <div style={{ borderBottom: '1px solid #1e293b' }}>
            <div
                onClick={onToggle}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: expanded ? '#0f172a' : 'transparent' }}
            >
                {/* verdict badge */}
                <div style={{ minWidth: 90, background: vm.bg, border: `1px solid ${vm.colour}55`, borderRadius: 6, padding: '2px 7px', textAlign: 'center', fontSize: 11, color: vm.colour, fontWeight: 700 }}>
                    {vm.icon} {vm.label}
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>{h.ticker}</span>
                        {h.isMutualFund && <span style={{ fontSize: 10, color: '#a78bfa', background: '#1e1b4b', borderRadius: 4, padding: '1px 5px' }}>MF</span>}
                        {h.isCore && <span style={{ fontSize: 10, color: '#38bdf8', background: '#082f49', borderRadius: 4, padding: '1px 5px' }}>CORE</span>}
                        {h.dataInsufficient && <span style={{ fontSize: 10, color: '#f59e0b', background: '#1c1404', borderRadius: 4, padding: '1px 5px' }}>NEW LISTING</span>}
                        {h.stale?.stale && <span style={{ fontSize: 10, color: '#ef4444', background: '#1c0505', borderRadius: 4, padding: '1px 5px' }}>STALE PRICE</span>}
                        {h.circuitBreakerOverride && <span style={{ fontSize: 10, color: '#f87171', background: '#450a0a', borderRadius: 4, padding: '1px 5px' }}>CB OVERRIDE</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{h.sector} · {h.verdictLabel}</div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 100 }}>
                    <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 13 }}>{fmtINR(h.value)}</div>
                    <div style={{ fontSize: 11, color: h.pnlPct >= 0 ? '#22c55e' : '#ef4444' }}>
                        {fmtPct(h.pnlPct)} ({h.pnl >= 0 ? '+' : ''}{fmtINR(h.pnl)})
                    </div>
                </div>
                <div style={{ color: '#475569', fontSize: 12 }}>{expanded ? '▲' : '▼'}</div>
            </div>

            {expanded && (
                <div style={{ padding: '0 14px 14px', background: '#0a0f1a' }}>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                        {[
                            ['Sector Heat', h.sectorHeat != null ? h.sectorHeat.toFixed(1) + ' / 10' : 'N/A', h.sectorHeat > 3 ? '#22c55e' : h.sectorHeat < -3 ? '#ef4444' : '#94a3b8'],
                            ['Range Pattern', h.rangeClass || 'N/A', h.rangeClass === 'ACCUMULATION' ? '#a78bfa' : h.rangeClass === 'DEAD_MONEY' ? '#6b7280' : '#94a3b8'],
                            ['Days Held', h.daysHeld != null ? h.daysHeld + 'd' : 'Unknown', '#94a3b8'],
                            ['Tax Status', h.isLTCG == null ? 'Unknown' : h.isLTCG ? 'LTCG (12.5%)' : 'STCG (20%)', h.isLTCG ? '#22c55e' : '#f59e0b'],
                            ['Liquidity', h.liquidityRisk?.level || 'N/A', h.liquidityRisk?.level === 'HIGH' ? '#ef4444' : h.liquidityRisk?.level === 'MEDIUM' ? '#f59e0b' : '#22c55e'],
                        ].map(([k, v, c]) => (
                            <div key={k} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 12px', minWidth: 110 }}>
                                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>{k}</div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: c }}>{v}</div>
                            </div>
                        ))}
                    </div>

                    {/* Test 28: Liquidity warning */}
                    {h.liquidityRisk?.level === 'HIGH' && (
                        <div style={{ background: '#1c0505', border: '1px solid #ef444444', borderRadius: 6, padding: '7px 10px', fontSize: 11, color: '#fca5a5', marginBottom: 8 }}>
                            ⚠ {h.liquidityRisk.label} — exiting this position may move the price against you.
                        </div>
                    )}

                    {/* Test 2: LTCG warning */}
                    {h.ltcgWarning && (
                        <div style={{ background: '#1c1404', border: '1px solid #f59e0b44', borderRadius: 6, padding: '7px 10px', fontSize: 11, color: '#fde68a', marginBottom: 8 }}>
                            💰 {h.ltcgWarning}
                        </div>
                    )}

                    {/* Test 20: New listing */}
                    {h.dataInsufficient && (
                        <div style={{ background: '#1c1404', border: '1px solid #f59e0b44', borderRadius: 6, padding: '7px 10px', fontSize: 11, color: '#fde68a', marginBottom: 8 }}>
                            📊 {h.dataInsufficiencyReason}
                        </div>
                    )}

                    {/* Test 4: Rotation cost (Test 1: signal throttle) */}
                    {h.rotationCost && (
                        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '10px 12px', fontSize: 11, marginBottom: 8 }}>
                            <div style={{ color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>Estimated cost to rotate this position</div>
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                                <div><span style={{ color: '#64748b' }}>Total cost: </span><span style={{ color: '#f59e0b', fontWeight: 700 }}>{fmtINR(h.rotationCost.totalCost)} ({h.rotationCost.totalCostPct}%)</span></div>
                                <div><span style={{ color: '#64748b' }}>Tax: </span><span style={{ color: '#ef4444' }}>{fmtINR(h.rotationCost.breakdown.capitalGainsTax)}</span></div>
                                <div><span style={{ color: '#64748b' }}>STT+charges: </span><span style={{ color: '#94a3b8' }}>{fmtINR(h.rotationCost.breakdown.stt + h.rotationCost.breakdown.exchangeCharges)}</span></div>
                            </div>
                            {/* Test 1: throttle — warn if rotation gain needs to be substantial */}
                            <div style={{ marginTop: 6, color: '#64748b', fontStyle: 'italic' }}>
                                Rotation must generate &gt;{h.rotationCost.warningIfRotationGainBelow} gain just to break even on transaction costs.
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ── Holding input form ─────────────────────────────────────────────────────────
const DEMO_HOLDINGS = [
    { ticker: 'RELIANCE', qty: 50,  avgBuy: 2450, buyDate: '2023-03-15', isCore: false },
    { ticker: 'TCS',      qty: 20,  avgBuy: 3600, buyDate: '2022-11-10', isCore: true  },
    { ticker: 'HDFCBANK', qty: 100, avgBuy: 1580, buyDate: '2024-01-20', isCore: false },
    { ticker: 'SBIN',     qty: 200, avgBuy: 540,  buyDate: '2023-08-05', isCore: false },
    { ticker: 'INFY',     qty: 30,  avgBuy: 1490, buyDate: '2024-03-01', isCore: false },
    { ticker: 'ITC',      qty: 400, avgBuy: 410,  buyDate: '2022-06-15', isCore: false },
];

const emptyRow = () => ({ ticker: '', qty: '', avgBuy: '', buyDate: '', isCore: false, id: Math.random() });

const HoldingForm = ({ onAnalyse, loading }) => {
    const [rows, setRows]   = useState([emptyRow()]);
    const [error, setError] = useState('');

    const update = (id, field, val) =>
        setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));

    const addRow    = () => setRows(prev => [...prev, emptyRow()]);
    const removeRow = (id) => setRows(prev => prev.filter(r => r.id !== id));

    const loadDemo = () => setRows(DEMO_HOLDINGS.map(h => ({ ...h, id: Math.random() })));

    const submit = () => {
        const valid = rows.filter(r => r.ticker && r.qty > 0 && r.avgBuy > 0);
        if (!valid.length) { setError('Add at least one holding with ticker, quantity, and average buy price.'); return; }
        setError('');
        onAnalyse(valid.map(({ ticker, qty, avgBuy, buyDate, isCore }) => ({
            ticker, qty: +qty, avgBuy: +avgBuy, buyDate: buyDate || null, isCore,
        })));
    };

    const col = { color: '#64748b', fontSize: 11, fontWeight: 600, padding: '0 4px 4px' };
    const inp = {
        background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
        color: '#e2e8f0', fontSize: 13, padding: '6px 8px', width: '100%', outline: 'none',
    };

    return (
        <div>
            {/* Test 17: show value immediately with demo data option */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 13, color: '#94a3b8' }}>Enter your holdings below</div>
                <button onClick={loadDemo} style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12 }}>
                    Load demo data
                </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 580 }}>
                    <thead>
                        <tr>
                            {['Ticker', 'Qty', 'Avg Buy (₹)', 'Buy Date', 'Core?', ''].map(h => (
                                <th key={h} style={{ ...col, textAlign: 'left' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.id}>
                                <td style={{ padding: '3px 4px' }}><input style={inp} placeholder="HDFCBANK" value={r.ticker} onChange={e => update(r.id, 'ticker', e.target.value.toUpperCase())} /></td>
                                <td style={{ padding: '3px 4px' }}><input style={{ ...inp, width: 70 }} type="number" placeholder="100" value={r.qty} onChange={e => update(r.id, 'qty', e.target.value)} /></td>
                                <td style={{ padding: '3px 4px' }}><input style={{ ...inp, width: 100 }} type="number" placeholder="1580" value={r.avgBuy} onChange={e => update(r.id, 'avgBuy', e.target.value)} /></td>
                                <td style={{ padding: '3px 4px' }}><input style={{ ...inp, width: 110 }} type="date" value={r.buyDate} onChange={e => update(r.id, 'buyDate', e.target.value)} /></td>
                                <td style={{ padding: '3px 4px', textAlign: 'center' }}>
                                    {/* Test 29: long-term core designation */}
                                    <input type="checkbox" checked={r.isCore} onChange={e => update(r.id, 'isCore', e.target.checked)}
                                        title="Mark as long-term core — excluded from rotation analysis" />
                                </td>
                                <td style={{ padding: '3px 4px' }}>
                                    <button onClick={() => removeRow(r.id)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {error && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button onClick={addRow} style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontSize: 13 }}>
                    + Add row
                </button>
                <button onClick={submit} disabled={loading} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 20px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13, opacity: loading ? 0.7 : 1 }}>
                    {loading ? 'Analysing…' : 'Analyse Portfolio'}
                </button>
            </div>

            <div style={{ marginTop: 10, fontSize: 11, color: '#334155' }}>
                ☐ Core = long-term conviction position, excluded from rotation signals (e.g. family stock, multi-year compounder)
            </div>
        </div>
    );
};

// ── Sector rotation mini-heatmap ──────────────────────────────────────────────
const SectorHeatmap = ({ sectors, ranked, concentrationWarning, dampening }) => {
    if (!ranked?.length) return null;
    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>SECTOR ROTATION HEAT</span>
                {dampening < 1 && <span style={{ color: '#f59e0b' }}>⚑ Macro event detected — signals dampened {((1 - dampening) * 100).toFixed(0)}%</span>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ranked.map(({ sector, heat, rank }) => {
                    const hot = heat > 3, cold = heat < -3;
                    const col = hot ? '#22c55e' : cold ? '#ef4444' : '#64748b';
                    const bg  = hot ? '#052e16' : cold ? '#1c0505' : '#0f172a';
                    return (
                        <div key={sector} style={{ background: bg, border: `1px solid ${col}44`, borderRadius: 8, padding: '6px 12px', minWidth: 100 }}>
                            <div style={{ fontSize: 11, color: col, fontWeight: 700 }}>#{rank} {sector}</div>
                            <div style={{ fontSize: 15, fontWeight: 800, color: col }}>{heat > 0 ? '+' : ''}{heat?.toFixed(1)}</div>
                        </div>
                    );
                })}
            </div>
            {/* Test 26: flow concentration warning */}
            {concentrationWarning?.warning && (
                <div style={{ marginTop: 8, background: '#1c1404', border: '1px solid #f59e0b44', borderRadius: 6, padding: '7px 10px', fontSize: 11, color: '#fde68a' }}>
                    ⚑ Crowded trade risk: {concentrationWarning.message}
                </div>
            )}
        </div>
    );
};

// ── MF flag banner (Test 5/15) ────────────────────────────────────────────────
const MFBanner = ({ mfFlagged }) => {
    if (!mfFlagged?.length) return null;
    return (
        <div style={{ background: '#1e1b4b', border: '1px solid #a78bfa44', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#c4b5fd', marginBottom: 12 }}>
            <strong>Mutual fund tickers detected:</strong> {mfFlagged.join(', ')}<br />
            MF units are shown as holdings but cannot be sector-mapped or scored. The Health Score reflects your direct equity only.
            For a complete picture, your MF portfolio's equity allocation is not included.
        </div>
    );
};

// ── Test 30: Signal accuracy note ────────────────────────────────────────────
const AccuracyNote = () => (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#475569', marginTop: 12 }}>
        <strong style={{ color: '#64748b' }}>About signal accuracy:</strong> Rotation signals are based on news sentiment momentum and
        price data. In high-volatility or low-liquidity markets, signal accuracy degrades. Signals that prove wrong in hindsight
        are not hidden — check sector heat trends over 7 vs 30 days to see if a rotation call was premature or reversed.
    </div>
);

// ── Main component ────────────────────────────────────────────────────────────
export default function PortfolioIntelligence() {
    const [holdings, setHoldings]           = useState([]);
    const [result, setResult]               = useState(null);
    const [rotation, setRotation]           = useState(null);
    const [loading, setLoading]             = useState(false);
    const [rotLoading, setRotLoading]       = useState(false);
    const [error, setError]                 = useState('');
    const [expandedTicker, setExpandedTicker] = useState(null);
    const [showForm, setShowForm]           = useState(true);

    // Fetch sector rotation independently so heatmap loads fast
    const fetchRotation = useCallback(async () => {
        setRotLoading(true);
        try {
            const r = await fetch('/api/sector-rotation');
            if (r.ok) setRotation(await r.json());
        } catch { /* non-fatal */ } finally { setRotLoading(false); }
    }, []);

    const handleAnalyse = useCallback(async (rawHoldings) => {
        setLoading(true);
        setError('');
        try {
            if (!rotation) fetchRotation();
            const r = await fetch('/api/portfolio/analyse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ holdings: rawHoldings }),
            });
            if (!r.ok) throw new Error((await r.json()).error || 'Analysis failed');
            const data = await r.json();
            setResult(data);
            setShowForm(false);
        } catch (e) { setError(e.message); } finally { setLoading(false); }
    }, [rotation, fetchRotation]);

    // Group holdings by verdict for display order
    const VERDICT_ORDER = ['EXIT_ZONE','DEAD_MONEY','REVIEW','WATCH','NEUTRAL','HOLD','CORE','NEGLIGIBLE'];
    const sortedHoldings = result?.holdings
        ? [...result.holdings].sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict))
        : [];

    const verdictCounts = VERDICT_ORDER.reduce((acc, v) => {
        const n = (result?.holdings || []).filter(h => h.verdict === v).length;
        if (n) acc[v] = n;
        return acc;
    }, {});

    return (
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 12px', fontFamily: 'inherit' }}>
            <Disclaimer />

            {/* Rotation heatmap — loads independently */}
            {rotation && (
                <SectorHeatmap
                    sectors={rotation.sectors}
                    ranked={rotation.ranked}
                    concentrationWarning={rotation.concentrationWarning}
                    dampening={rotation.dampening}
                />
            )}

            {/* Circuit breaker */}
            {result?.circuitBreaker && <CircuitBreakerBanner cb={result.circuitBreaker} />}

            {/* MF flag */}
            {result?.mfFlagged?.length > 0 && <MFBanner mfFlagged={result.mfFlagged} />}

            {/* Health Score */}
            {result?.healthScore?.score != null && (
                <HealthScoreCard {...result.healthScore} />
            )}

            {/* Toggle form */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>
                    {result ? `${result.holdings.length} holdings · ${fmtINR(result.totalValue)} total` : 'YOUR HOLDINGS'}
                </div>
                {result && (
                    <button onClick={() => setShowForm(f => !f)}
                        style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12 }}>
                        {showForm ? 'Hide form' : 'Edit holdings'}
                    </button>
                )}
            </div>

            {/* Verdict summary pills */}
            {Object.keys(verdictCounts).length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                    {Object.entries(verdictCounts).map(([v, n]) => {
                        const vm = VERDICT_META[v];
                        return (
                            <div key={v} style={{ background: vm.bg, border: `1px solid ${vm.colour}55`, borderRadius: 20, padding: '3px 10px', fontSize: 11, color: vm.colour, fontWeight: 700 }}>
                                {vm.icon} {n} {vm.label}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Input form */}
            {showForm && (
                <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                    {!result && holdings.length === 0
                        ? <Onboarding onDemoLoad={() => {
                            setShowForm(true);
                          }} />
                        : null
                    }
                    <HoldingForm onAnalyse={handleAnalyse} loading={loading} />
                </div>
            )}

            {error && (
                <div style={{ background: '#1c0505', border: '1px solid #ef444444', borderRadius: 6, padding: '10px 14px', color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>
                    {error}
                </div>
            )}

            {/* Holdings list */}
            {sortedHoldings.length > 0 && (
                <div style={{ background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
                    {sortedHoldings.map(h => (
                        <HoldingRow
                            key={h.ticker}
                            h={h}
                            expanded={expandedTicker === h.ticker}
                            onToggle={() => setExpandedTicker(t => t === h.ticker ? null : h.ticker)}
                        />
                    ))}
                </div>
            )}

            {result && <AccuracyNote />}
        </div>
    );
}
