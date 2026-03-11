import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as LightweightCharts from 'lightweight-charts';

const API = '/api';

// ── Helpers ──
const fmt = (n, d = 2) => (n != null && !isNaN(n)) ? Number(n).toFixed(d) : 'N/A';
const fmtCur = (n, c = '₹') => (n != null && !isNaN(n)) ? `${c}${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'N/A';

// GTI helpers
const gtiColor  = g => g >= 80 ? '#ef4444' : g >= 60 ? '#fb923c' : g >= 35 ? '#3b82f6' : '#22c55e';
const gtiLevel  = g => g >= 80 ? 'CRITICAL' : g >= 60 ? 'ELEVATED' : g >= 35 ? 'MEDIUM' : 'LOW';
const dirColor  = d => ({ BUY: '#10b981', SELL: '#ef4444', HOLD: '#eab308' }[d] || '#94a3b8');
const sentColor = s => ({ bullish: '#10b981', bearish: '#ef4444', neutral: '#94a3b8' }[s] || '#94a3b8');
const sentLabel = s => ({ bullish: '▲ BULLISH', bearish: '▼ BEARISH', neutral: '→ NEUTRAL' }[s] || '→ NEUTRAL');
const actionColor = a => ({ 'STRONG BUY': '#10b981', 'BUY': '#10b981', 'HOLD': '#eab308', 'SELL': '#ef4444', 'STRONG SELL': '#b91c1c' }[a] || '#94a3b8');
const indiaLabel = s => ({ bullish: '▲ India', bearish: '▼ India', neutral: '~ India' }[s] || '~ India');

// Country risk map (ISO_A3 → 0-100)
const RISK = {
    PRK: 93, RUS: 88, UKR: 84, IRN: 78, SYR: 80, YEM: 82, AFG: 81, IRQ: 73,
    ISR: 70, PAK: 67, SDN: 68, MLI: 65, NGA: 61, ETH: 64, SOM: 76, LBY: 70,
    VEN: 62, MMR: 72, CHN: 44, IND: 33, USA: 28, GBR: 22, FRA: 23, DEU: 20,
    JPN: 26, AUS: 16, CAN: 17, BRA: 35, MEX: 42, SAU: 55, TUR: 48, EGY: 50,
    ZAF: 38, IDN: 30, MYS: 25, SGP: 14, KOR: 32, TWN: 58, ARE: 38, QAT: 34,
    KWT: 45, OMN: 38, BGD: 42, LKA: 50, NPL: 36, KHM: 30, THA: 32, VNM: 28,
    PHL: 40, ARG: 52, COL: 48, PER: 40, CHL: 30, POL: 28, CZE: 18, HUN: 25,
    GRC: 26, ITA: 22, ESP: 20, PRT: 16, NOR: 12, SWE: 12, DNK: 12, FIN: 14,
    NLD: 16, BEL: 16, AUT: 15, CHE: 12, NZL: 13, ZAR: 38,
};
const countryColor = iso => {
    const r = RISK[iso] ?? 22;
    if (r >= 80) return 'rgba(239,68,68,0.72)';
    if (r >= 60) return 'rgba(251,146,60,0.65)';
    if (r >= 35) return 'rgba(59,130,246,0.55)';
    return 'rgba(34,197,94,0.30)';
};

// ── StarField ──
function StarField() {
    const ref = useRef(null);
    useEffect(() => {
        const c = ref.current; if (!c) return;
        const ctx = c.getContext('2d');
        const resize = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
        resize();
        const stars = Array.from({ length: 220 }, () => ({
            x: Math.random() * c.width, y: Math.random() * c.height,
            r: Math.random() * 1.4 + 0.2,
            o: Math.random() * 0.6 + 0.25,
            sp: Math.random() * 0.6 + 0.2
        }));
        let frame, t = 0;
        const draw = () => {
            ctx.clearRect(0, 0, c.width, c.height);
            t += 0.008;
            stars.forEach(s => {
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(200,220,255,${s.o * (0.65 + 0.35 * Math.sin(t * s.sp))})`;
                ctx.fill();
            });
            frame = requestAnimationFrame(draw);
        };
        draw();
        window.addEventListener('resize', resize);
        return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); };
    }, []);
    return <canvas ref={ref} className="star-field" />;
}

// ── Globe ──
function GlobeView({ onCountryClick }) {
    const containerRef = useRef(null);
    const globeRef = useRef(null);
    const onClickRef = useRef(onCountryClick);
    onClickRef.current = onCountryClick;

    useEffect(() => {
        if (!containerRef.current || globeRef.current) return;
        let g;
        import('globe.gl').then(mod => {
            const Globe = mod.default || mod;
            g = Globe()(containerRef.current)
                .backgroundColor('rgba(0,0,0,0)')
                .showAtmosphere(true)
                .atmosphereColor('rgba(6,182,212,0.45)')
                .atmosphereAltitude(0.14)
                .showGraticules(false);

            fetch('https://raw.githubusercontent.com/vasturiano/react-globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')
                .then(r => r.json())
                .then(({ features }) => {
                    g.polygonsData(features)
                        .polygonCapColor(f => countryColor(f.properties?.ISO_A3))
                        .polygonSideColor(() => 'rgba(6,182,212,0.08)')
                        .polygonStrokeColor(() => 'rgba(6,182,212,0.35)')
                        .polygonLabel(f => `
                            <div class="globe-tip">
                                <strong>${f.properties?.NAME || ''}</strong>
                                <span>Risk Score: ${RISK[f.properties?.ISO_A3] ?? 'Low'}</span>
                                <span class="gt-click-hint">Click for market data</span>
                            </div>`)
                        .polygonsTransitionDuration(900)
                        .onPolygonClick((polygon) => {
                            const iso = polygon?.properties?.ISO_A3;
                            const name = polygon?.properties?.NAME;
                            if (iso && onClickRef.current) onClickRef.current(iso, name);
                        });
                }).catch(() => {});

            g.controls().autoRotate = true;
            g.controls().autoRotateSpeed = 0.38;
            g.controls().enableZoom = false;
            g.pointOfView({ lat: 22, lng: 55, altitude: 2.1 });

            const fit = () => {
                if (containerRef.current)
                    g.width(containerRef.current.clientWidth).height(containerRef.current.clientHeight);
            };
            fit(); // set initial size so globe fills container and is centered
            window.addEventListener('resize', fit);
            globeRef.current = { globe: g, cleanup: () => window.removeEventListener('resize', fit) };
        }).catch(() => {});

        return () => { globeRef.current?.cleanup?.(); };
    }, []);

    return <div ref={containerRef} className="globe-container" />;
}

// ── GTI Sparkline ──
function GTISparkline({ history }) {
    const vals = history.length > 1 ? history : [48, 52, 55, 58, 62, 65];
    const W = 110, H = 28;
    const mn = Math.min(...vals) - 3, mx = Math.max(...vals) + 3;
    const pts = vals.map((v, i) =>
        `${(i / (vals.length - 1)) * W},${H - ((v - mn) / (mx - mn)) * H}`).join(' ');
    const last = vals[vals.length - 1];
    const lx = W, ly = H - ((last - mn) / (mx - mn)) * H;
    return (
        <svg width={W} height={H} className="gti-spark">
            <defs>
                <linearGradient id="sparkGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity="1" />
                </linearGradient>
            </defs>
            <polyline points={pts} fill="none" stroke="url(#sparkGrad)" strokeWidth="1.8" />
            <circle cx={lx} cy={ly} r="3.5" fill="#06b6d4" />
        </svg>
    );
}

// ── Signal Card ──
function SignalCard({ sig, onAnalyze }) {
    const dc = dirColor(sig.direction);
    return (
        <div className="sig-card" onClick={() => onAnalyze(sig.ticker + '.NS')}>
            <div className="sc-top">
                <div className="sc-ticker-row">
                    <span className="sc-sym">{sig.ticker}</span>
                    <span className="sc-dir-badge" style={{ color: dc, borderColor: dc + '55', background: dc + '18' }}>{sig.direction}</span>
                </div>
                <div className="sc-price-col">
                    <span className="sc-price">₹{sig.price?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                    <span className={`sc-chg ${sig.change >= 0 ? 'pos' : 'neg'}`}>{sig.change >= 0 ? '▲' : '▼'}{Math.abs(sig.change).toFixed(2)}%</span>
                </div>
            </div>
            <div className="sc-name">{sig.name} <span className="sc-cls">· {sig.cls}</span></div>
            <div className="sc-conf-row">
                <span className="sc-conf-label">Confidence</span>
                <div className="sc-conf-track"><div className="sc-conf-fill" style={{ width: `${sig.confidence}%`, background: dc }} /></div>
                <span className="sc-conf-pct" style={{ color: dc }}>{sig.confidence}%</span>
            </div>
            <div className="sc-bars">
                <div className="sc-bar-row">
                    <span className="pos">Bull</span>
                    <div className="sc-track"><div className="sc-fill pos" style={{ width: `${sig.bull}%` }} /></div>
                    <span className="pos sc-pct">{sig.bull}%</span>
                </div>
                <div className="sc-bar-row">
                    <span className="neg">Bear</span>
                    <div className="sc-track"><div className="sc-fill neg" style={{ width: `${sig.bear}%` }} /></div>
                    <span className="neg sc-pct">{sig.bear}%</span>
                </div>
            </div>
            <div className="sc-tags">
                <span className={`sc-vol vol-${sig.vol?.toLowerCase()}`}>VOL: {sig.vol}</span>
                {sig.volSurge && <span className="sc-surge">⚡ SURGE</span>}
                <span className="sc-tag">{sig.timeframe}</span>
                <span className="sc-tag">RR {sig.rr}</span>
            </div>
            <div className="sc-geo">⚡ {sig.geoDriver}</div>
        </div>
    );
}

// ── Geo Event Ticker ──
function GeoTicker({ events }) {
    const doubled = [...events, ...events];
    return (
        <div className="geo-ticker">
            <div className="gt-live-badge"><span className="gt-dot" />LIVE</div>
            <div className="gt-runway">
                <div className="gt-scroll-track">
                    {doubled.map((e, i) => (
                        <a key={i} href={e.link || '#'} target="_blank" rel="noreferrer" className={`gt-event lvl-${(e.level || 'low').toLowerCase()}`}>
                            <span className={`gt-lvl-dot lvl-${(e.level || 'low').toLowerCase()}`} />
                            <strong>{e.title}</strong>
                            <span className="gt-meta">{e.time} · {e.region}</span>
                            <span className={`gt-badge lvl-${(e.level || 'low').toLowerCase()}`}>{e.level}</span>
                        </a>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ── Gauge ──
function Gauge({ val, label, color }) {
    const v = parseFloat(val) || 0;
    const pct = Math.min(100, Math.max(0, v));
    return (
        <div className="gauge-wrap">
            <div className="gauge-arc">
                <div className="gauge-fill" style={{ '--pct': pct, '--color': color }} />
                <div className="gauge-center"><span style={{ color }}>{v > 0 ? v.toFixed(1) : '--'}</span></div>
            </div>
            <div className="gauge-label">{label}</div>
        </div>
    );
}

// ── Country Modal ──
function CountryModal({ modal, onClose }) {
    if (!modal) return null;
    return (
        <div className="cm-overlay" onClick={onClose}>
            <div className="cm-box" onClick={e => e.stopPropagation()}>
                <div className="cm-head">
                    <div className="cm-title-block">
                        <div className="cm-country">{modal.name}</div>
                        <div className="cm-sub">MARKET INDICES · {modal.iso}</div>
                    </div>
                    <button className="cm-close" onClick={onClose}>✕</button>
                </div>
                {!modal.data ? (
                    <div className="cm-loading">⟳ Fetching market data…</div>
                ) : modal.data.length === 0 ? (
                    <div className="cm-empty">No index data available for this region</div>
                ) : (
                    <div className="cm-list">
                        {modal.data.map((idx, i) => (
                            <div key={i} className="cm-row">
                                <div className="cm-row-left">
                                    <div className="cm-sym">{idx.symbol}</div>
                                    <div className="cm-idx-name">{idx.name?.slice(0, 32)}</div>
                                </div>
                                <div className="cm-row-right">
                                    <span className="cm-price">
                                        {idx.price != null ? idx.price.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
                                        {idx.currency && idx.currency !== 'INR' ? ` ${idx.currency}` : ''}
                                    </span>
                                    <span className={`cm-chg ${(idx.changePercent || 0) >= 0 ? 'pos' : 'neg'}`}>
                                        {(idx.changePercent || 0) >= 0 ? '▲' : '▼'}{Math.abs(idx.changePercent || 0).toFixed(2)}%
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                <div className="cm-footer">⊙ Data via Yahoo Finance · Cached 60s</div>
            </div>
        </div>
    );
}

// ── App ──
export default function App() {
    // Views: geopulse | terminal | signals
    const [activeView, setActiveView] = useState('home');

    // GTI
    const [gti, setGti]           = useState({ score: 58, delta: 0, level: 'MEDIUM', events: [] });
    const [gtiHistory, setGtiHistory] = useState([48, 52, 55, 58, 60, 58]);

    // Signals
    const [signals, setSignals]   = useState([]);
    const [sigLoading, setSigLoading] = useState(false);
    const [sigFilter, setSigFilter] = useState('All');

    // Global market
    const [global, setGlobal]     = useState([]);
    const [news, setNews]         = useState([]);
    const [top15, setTop15]       = useState([]);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [futures, setFutures]   = useState([]);
    const [liveTape, setLiveTape] = useState([]);
    const [indicesBar, setIndicesBar] = useState([]);
    const [countryModal, setCountryModal] = useState(null); // { iso, name, data }

    // Terminal (stock analysis)
    const [ticker, setTicker]     = useState('RELIANCE.NS');
    const [data, setData]         = useState(null);
    const [options, setOptions]   = useState(null);
    const [loading, setLoading]   = useState(false);
    const [activeTab, setActiveTab] = useState('technical');
    const [period, setPeriod]     = useState('6mo');
    const [interval, setInterval] = useState('1d');
    const [search, setSearch]     = useState('RELIANCE.NS');
    const [selectedExpiry, setSelectedExpiry] = useState(null);
    const selectedExpiryRef = useRef(null);

    // Movers
    const [movers, setMovers]         = useState(null);
    const [moversLoading, setMoversLoading] = useState(false);
    const [activeMovTf, setActiveMovTf] = useState('1d');
    const [moversOptTicker, setMoversOptTicker] = useState(null);
    const [moversOpt, setMoversOpt]   = useState(null);
    const [moversOptLoading, setMoversOptLoading] = useState(false);
    const moversOptTickerRef = useRef(null);

    // Clock
    const [clock, setClock] = useState('');

    const chartRef = useRef(null);
    const chartContainerRef = useRef(null);

    // Clock tick
    useEffect(() => {
        const tick = () => {
            const n = new Date();
            setClock(n.toUTCString().slice(17, 25) + ' UTC');
        };
        tick();
        const t = setInterval(tick, 1000);
        return () => clearInterval(t);
    }, []);

    // Data fetchers
    const fetchGTI = useCallback(async () => {
        try {
            const r = await fetch(`${API}/gti`).then(x => x.json());
            setGti(r);
            setGtiHistory(h => [...h.slice(-19), r.score]);
        } catch {}
    }, []);

    const fetchSignals = useCallback(async () => {
        setSigLoading(true);
        try {
            const r = await fetch(`${API}/signals`).then(x => x.json());
            setSignals(Array.isArray(r) ? r : []);
        } catch {} finally { setSigLoading(false); }
    }, []);

    const fetchGlobal = useCallback(async () => {
        try {
            const [gR, nR, tR] = await Promise.all([
                fetch(`${API}/global`).then(x => x.json()),
                fetch(`${API}/globalnews`).then(x => x.json()),
                fetch(`${API}/top15`).then(x => x.json()),
            ]);
            setGlobal(Array.isArray(gR) ? gR : []);
            setNews(Array.isArray(nR) ? nR : []);
            setTop15(Array.isArray(tR) ? tR : []);
        } catch {}
    }, []);

    const fetchTerminal = useCallback(async (sym, p, i) => {
        setLoading(true);
        try {
            const exQ = selectedExpiryRef.current ? `?expiry=${encodeURIComponent(selectedExpiryRef.current)}` : '';
            const [dR, oR] = await Promise.all([
                fetch(`${API}/analyze/${encodeURIComponent(sym)}?period=${p}&interval=${i}`).then(x => x.json()),
                fetch(`${API}/options/${encodeURIComponent(sym)}${exQ}`).then(x => x.json()),
            ]);
            setData(dR); setOptions(oR);
        } catch {} finally { setLoading(false); }
    }, []);

    const fetchOptionsWithExpiry = useCallback(async (sym, expiry) => {
        try {
            const r = await fetch(`${API}/options/${encodeURIComponent(sym)}?expiry=${encodeURIComponent(expiry)}`).then(x => x.json());
            setOptions(r); setSelectedExpiry(expiry); selectedExpiryRef.current = expiry;
        } catch {}
    }, []);

    const fetchMovers = useCallback(async (tf) => {
        setMoversLoading(true);
        try {
            const r = await fetch(`${API}/movers?tf=${tf}`).then(x => x.json());
            setMovers(r?.gainers ? r : null);
        } catch {} finally { setMoversLoading(false); }
    }, []);

    const fetchMoverOpt = useCallback(async (sym) => {
        if (moversOptTickerRef.current === sym) {
            setMoversOptTicker(null); moversOptTickerRef.current = null; setMoversOpt(null); return;
        }
        setMoversOptTicker(sym); moversOptTickerRef.current = sym; setMoversOpt(null);
        setMoversOptLoading(true);
        try {
            const r = await fetch(`${API}/options/${encodeURIComponent(sym)}`).then(x => x.json());
            setMoversOpt(r);
        } catch {} finally { setMoversOptLoading(false); }
    }, []);

    const fetchFutures = useCallback(async () => {
        try {
            const r = await fetch(`${API}/futures`).then(x => x.json());
            setFutures(Array.isArray(r) ? r : []);
        } catch {}
    }, []);

    const fetchLiveTape = useCallback(async () => {
        try {
            const r = await fetch(`${API}/livetape`).then(x => x.json());
            setLiveTape(Array.isArray(r) ? r : []);
        } catch {}
    }, []);

    const fetchIndicesBar = useCallback(async () => {
        try {
            const r = await fetch(`${API}/indicesbar`).then(x => x.json());
            setIndicesBar(Array.isArray(r) ? r : []);
        } catch {}
    }, []);

    const fetchCountryIndices = useCallback(async (iso, name) => {
        setCountryModal({ iso, name, data: null });
        try {
            const r = await fetch(`${API}/country/${iso}`).then(x => x.json());
            setCountryModal({ iso, name, data: r.tickers || [] });
        } catch { setCountryModal({ iso, name, data: [] }); }
    }, []);

    // Mount & auto-refresh
    useEffect(() => {
        fetchGTI(); fetchSignals(); fetchGlobal(); fetchFutures();
        fetchLiveTape(); fetchIndicesBar();
        fetchTerminal(ticker, period, interval);
        const t1 = setInterval(fetchGTI, 60000);
        const t2 = setInterval(fetchSignals, 60000);
        const t3 = setInterval(fetchGlobal, 12000);
        const t4 = setInterval(fetchFutures, 12000);
        const t5 = setInterval(fetchLiveTape, 8000);   // 8s — Yahoo Finance movers
        const t6 = setInterval(fetchIndicesBar, 3000); // 3s — NSE live indices
        return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); clearInterval(t4); clearInterval(t5); clearInterval(t6); };
    }, []);

    useEffect(() => { fetchMovers(activeMovTf); }, [activeMovTf]);

    // Chart
    useEffect(() => {
        if (!data?.chartData?.length || !chartContainerRef.current) return;
        if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
        const chart = LightweightCharts.createChart(chartContainerRef.current, {
            layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8892b0' },
            grid: { vertLines: { color: 'rgba(6,182,212,0.05)' }, horzLines: { color: 'rgba(6,182,212,0.05)' } },
            width: chartContainerRef.current.clientWidth, height: 320,
            timeScale: { borderColor: 'rgba(6,182,212,0.2)', timeVisible: true, secondsVisible: false },
        });
        const cs = chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: '#10b981', downColor: '#ef4444', borderVisible: false,
            wickUpColor: '#10b981', wickDownColor: '#ef4444',
        });
        const vs = chart.addSeries(LightweightCharts.HistogramSeries, {
            color: '#3b82f6', priceFormat: { type: 'volume' }, priceScaleId: '',
        });
        vs.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        cs.setData(data.chartData);
        vs.setData(data.chartData.map(v => ({
            time: v.time, value: v.volume,
            color: v.close >= v.open ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)',
        })));
        chart.timeScale().fitContent();
        chartRef.current = chart;
        const onResize = () => { if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth }); };
        window.addEventListener('resize', onResize);
        return () => { window.removeEventListener('resize', onResize); if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; } };
    }, [data, interval]);

    const handleSelect = (s) => {
        if (!s) return;
        const sym = s.toUpperCase().trim();
        setTicker(sym); setSearch(sym);
        setSelectedExpiry(null); selectedExpiryRef.current = null;
        fetchTerminal(sym, period, interval);
        setActiveView('terminal');
    };

    // Derived
    const d = data, t = d?.technicals, rec = d?.recommendation;
    const cur = d?.currency === 'USD' ? '$' : '₹';
    const gtiScore = gti?.score ?? 58;
    const gtiLvl = gtiLevel(gtiScore);
    const gtiCol = gtiColor(gtiScore);

    // Options helpers
    const allStrikes = options?.expiry ? [...new Set([
        ...(options.calls || []).map(c => c.strike),
        ...(options.puts || []).map(p => p.strike),
    ])].sort((a, b) => a - b) : [];
    const callsMap = Object.fromEntries((options?.calls || []).map(c => [c.strike, c]));
    const putsMap  = Object.fromEntries((options?.puts  || []).map(p => [p.strike, p]));
    const totalOI  = (options?.totalCallOI || 0) + (options?.totalPutOI || 0);

    // Filtered signals
    const filteredSig = sigFilter === 'All' ? signals : signals.filter(s => s.direction === sigFilter);

    return (
        <div className="app-shell">
            <StarField />

            {/* ── HEADER ── */}
            <header className="geo-header">
                <div className="gh-logo" onClick={() => setActiveView('home')} style={{ cursor: 'pointer' }}>
                    <div className="gh-logo-icon">◈</div>
                    <div>
                        <div className="gh-logo-name">ProTrader<span className="gh-acc">AI</span></div>
                        <div className="gh-logo-sub">GEO INTELLIGENCE · v2.0</div>
                    </div>
                </div>

                <div className="gh-gti">
                    <div className="gti-shield">◉</div>
                    <div className="gti-block">
                        <div className="gti-label">GLOBAL TENSION INDEX (GTI)</div>
                        <div className="gti-row">
                            <span className="gti-score" style={{ color: gtiCol }}>{gtiScore}</span>
                            <span className="gti-delta" style={{ color: gtiCol }}>
                                {gti.delta >= 0 ? '▲' : '▼'}+{Math.abs(gti.delta ?? 0).toFixed(1)}
                            </span>
                            <span className="gti-badge" style={{ borderColor: gtiCol, color: gtiCol }}>{gtiLvl}</span>
                        </div>
                    </div>
                </div>

                <nav className="gh-nav">
                    {[['geopulse', '⊕ EARTH PULSE'], ['terminal', '⊞ TERMINAL'], ['signals', '⊿ AI SIGNALS']].map(([v, l]) => (
                        <button key={v} className={`gh-nav-btn${activeView === v ? ' active' : ''}`} onClick={() => setActiveView(v)}>{l}</button>
                    ))}
                </nav>

                <div className="gh-right">
                    <form className="gh-search" onSubmit={e => { e.preventDefault(); handleSelect(search); }}>
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="RELIANCE.NS, AAPL, ^NSEI…" />
                        <button type="submit">→</button>
                    </form>
                    <div className="gh-live-badge"><span className="gh-dot" />LIVE · {signals.length} feeds</div>
                    <div className="gh-clock">⏱ {clock}</div>
                </div>
            </header>

            {/* ── TICKER TAPE — Indian Large/Mid Cap Movers ── */}
            <div className="geo-tape">
                <div className="tape-label">⚡ TOP MOVERS</div>
                <div className="tape-track">
                    {[...liveTape, ...liveTape].map((s, i) => (
                        <div key={i} className="tape-chip" onClick={() => handleSelect(s.symbol)}>
                            <span className="tc-name">{s.name}</span>
                            <span className="tc-price">₹{s.price?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                            <span className={`tc-chg ${(s.changePercent || 0) >= 0 ? 'pos' : 'neg'}`}>
                                {(s.changePercent || 0) >= 0 ? '▲' : '▼'}{Math.abs(s.changePercent || 0).toFixed(2)}%
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── MAIN ── */}
            <div className="geo-main">

                {/* ════ HOME VIEW ════ */}
                {activeView === 'home' && (
                    <div className="home-view">
                        <div className="home-hero">
                            <div className="home-logo-icon">◈</div>
                            <div className="home-title">ProTrader<span>AI</span></div>
                            <div className="home-subtitle">Geo Intelligence · Real-Time Markets · v2.0</div>
                            <div className="home-tagline">AI-powered stock analysis, global risk intelligence, and live Indian market data — all in one terminal.</div>
                        </div>

                        <div className="home-stats">
                            {[
                                { val: indicesBar.length || '20+', lbl: 'NSE Indices' },
                                { val: signals.length || '—', lbl: 'AI Signals' },
                                { val: news.length || '—', lbl: 'News Stories' },
                                { val: gtiScore, lbl: 'GTI Score' },
                            ].map(s => (
                                <div key={s.lbl} className="home-stat">
                                    <div className="home-stat-val">{s.val}</div>
                                    <div className="home-stat-lbl">{s.lbl}</div>
                                </div>
                            ))}
                        </div>

                        <div className="home-cards">
                            {[
                                { icon: '⊕', title: 'Earth Pulse', desc: 'Globe view with country risk scores, live news feed, and global market intelligence.', view: 'geopulse' },
                                { icon: '⊞', title: 'Terminal', desc: 'Deep stock analysis — charts, technicals, financials, options chain, and AI signals.', view: 'terminal' },
                                { icon: '⊿', title: 'AI Signals', desc: 'GTI-adjusted buy/sell/hold signals with Black-Scholes model for Indian & global stocks.', view: 'signals' },
                            ].map(c => (
                                <div key={c.view} className="home-card" onClick={() => setActiveView(c.view)}>
                                    <div className="home-card-icon">{c.icon}</div>
                                    <div className="home-card-title">{c.title}</div>
                                    <div className="home-card-desc">{c.desc}</div>
                                </div>
                            ))}
                        </div>

                        {news.length > 0 && (
                            <div className="home-news">
                                <div className="home-news-title">Live Market News</div>
                                <div className="home-news-list">
                                    {news.slice(0, 8).map((n, i) => (
                                        <a key={i} href={n.link} target="_blank" rel="noreferrer"
                                            className={`home-news-item${n.highImpact ? ' hi' : ''}`}>
                                            <div className="home-ni-top">
                                                <span className="home-ni-sent" style={{ color: sentColor(n.sentiment) }}>{sentLabel(n.sentiment)}</span>
                                                <span className="home-ni-time">{n.time}</span>
                                            </div>
                                            <div className="home-ni-title">{n.title}</div>
                                            <div className="home-ni-pub">{n.publisher}</div>
                                        </a>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ════ GEO PULSE VIEW ════ */}
                {activeView === 'geopulse' && (
                    <div className="geopulse-view">
                        {/* India Top Strip */}
                        <div className="india-strip">
                            <div className="is-flag">🇮🇳</div>
                            <span className="is-live-badge"><span className="is-live-dot" />NSE LIVE</span>
                            {global.filter(g => ['^NSEI', '^NSEBANK', '^BSESN', '^INDIAVIX'].includes(g.symbol)).map(g => (
                                <div key={g.symbol} className={`is-idx ${g.symbol === '^INDIAVIX' ? 'is-vix' : ''}`} title={g.isLive ? 'NSE India Real-Time' : 'Yahoo Finance ~5min delay'}>
                                    <span className="is-iname">{{ '^NSEI': 'NIFTY', '^NSEBANK': 'BANKNIFTY', '^BSESN': 'SENSEX', '^INDIAVIX': 'INDIA VIX' }[g.symbol]}</span>
                                    <span className="is-iprice">{g.price?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                                    <span className={`is-ichg ${(g.changePercent || 0) >= 0 ? 'pos' : 'neg'}`}>{(g.changePercent || 0) >= 0 ? '▲' : '▼'}{Math.abs(g.changePercent || 0).toFixed(2)}%</span>
                                </div>
                            ))}
                            <div className="is-sep" />
                            <span className="is-movers-lbl">⚡ TOP MOVERS</span>
                            {[...(movers?.gainers?.slice(0, 2) || []), ...(movers?.losers?.slice(0, 1) || [])].map(m => (
                                <div key={m.symbol} className={`is-mover ${m.change >= 0 ? 'is-mv-pos' : 'is-mv-neg'}`} onClick={() => handleSelect(m.symbol)}>
                                    <span className="is-mv-sym">{m.symbol.replace('.NS', '')}</span>
                                    <span className={`is-mv-chg ${m.change >= 0 ? 'pos' : 'neg'}`}>{m.change >= 0 ? '▲' : '▼'}{Math.abs(m.change)}%</span>
                                </div>
                            ))}
                        </div>

                        {/* 3-column main */}
                        <div className="gp-cols">
                            {/* Left: Live Intelligence Feed */}
                            <div className="gp-left">
                                <div className="gpl-head">
                                    <span className="gpl-dot" />
                                    <span>LIVE INTELLIGENCE</span>
                                    <span className="gpl-count">{news.length} stories</span>
                                </div>
                                <div className="gpl-body">
                                    {news.length === 0
                                        ? <div className="geo-empty">Fetching intelligence…</div>
                                        : news.map((n, i) => (
                                            <a key={i} href={n.link} target="_blank" rel="noreferrer"
                                                className={`gpl-card${n.highImpact ? ' gpl-hi' : ''}`}>
                                                <div className="gpl-card-top">
                                                    <span className="gpl-sent" style={{ color: sentColor(n.sentiment) }}>{sentLabel(n.sentiment)}</span>
                                                    <span className="gpl-time">{n.time}</span>
                                                </div>
                                                <div className="gpl-title">{n.title}</div>
                                                <div className="gpl-footer">
                                                    <span className="gpl-pub">{n.publisher}</span>
                                                    <span className={`gpl-india ${n.indiaImpact !== 'neutral' ? 'gpl-active' : ''}`}>{indiaLabel(n.indiaImpact)}</span>
                                                </div>
                                            </a>
                                        ))}
                                </div>
                                {/* Geo events at bottom of left panel */}
                                <div className="gpl-events">
                                    <div className="gpl-events-head"><span className="gpl-dot" />GEO EVENTS</div>
                                    {(gti.events || []).slice(0, 4).map((e, i) => (
                                        <a key={i} href={e.link || '#'} target="_blank" rel="noreferrer" className={`gple lvl-bg-${(e.level || 'low').toLowerCase()}`}>
                                            <span className={`gt-lvl-dot lvl-${(e.level || 'low').toLowerCase()}`} />
                                            <span className="gple-title">{e.title}</span>
                                            <span className="gple-meta">{e.region}</span>
                                        </a>
                                    ))}
                                </div>
                            </div>

                            {/* Center: Globe */}
                            <div className="gp-center">
                                <GlobeView onCountryClick={fetchCountryIndices} />

                                {/* Risk legend */}
                                <div className="risk-legend">
                                    <div className="rl-title">RISK LEVEL</div>
                                    {[['#ef4444', 'CRITICAL', '≥80'], ['#fb923c', 'HIGH', '≥60'], ['#3b82f6', 'MEDIUM', '≥35'], ['#22c55e', 'LOW', '<35']].map(([c, l, r]) => (
                                        <div key={l} className="rl-row">
                                            <span className="rl-dot" style={{ background: c }} />
                                            <span className="rl-lbl">{l}</span>
                                            <span className="rl-rng">{r}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Globe overlay */}
                                <div className="globe-overlay">
                                    <span className="go-live"><span className="go-dot" />LIVE</span>
                                    <span className="go-gti">◈ GTI {gtiScore} · {gtiLvl}</span>
                                </div>

                                {/* Globe hint */}
                                <div className="globe-hint">⊙ Click any country for market data ›</div>

                                {/* Country modal */}
                                {countryModal && <CountryModal modal={countryModal} onClose={() => setCountryModal(null)} />}
                            </div>

                            {/* Right: Signals panel */}
                            <div className={`signals-panel${sidebarOpen ? '' : ' sp-collapsed'}`}>
                                <div className="sp-head">
                                    <span className="sp-title">◈ SIGNALS</span>
                                    <button className="sp-close-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
                                        {sidebarOpen ? '✕' : '›'}
                                    </button>
                                </div>
                                {sidebarOpen && (
                                    <div className="sp-body">
                                        {sigLoading
                                            ? <div className="geo-empty">Scanning markets…</div>
                                            : signals.slice(0, 5).map((s, i) => (
                                                <SignalCard key={i} sig={s} onAnalyze={handleSelect} />
                                            ))}
                                        <button className="sp-all-btn" onClick={() => setActiveView('signals')}>
                                            ⊞ ALL SIGNALS ({signals.length}) ›
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ════ TERMINAL VIEW ════ */}
                {activeView === 'terminal' && (
                    <div className="terminal-view">
                        {/* Globe background (dimmed) */}
                        <div className="term-globe-bg">
                            <GlobeView />
                        </div>

                        <div className="term-overlay">
                            {loading && !d && <div className="geo-loading">⟳ Loading market intelligence…</div>}
                            {d && (
                                <>
                                    {/* Stock hero */}
                                    <div className="term-hero">
                                        <div className="th-left">
                                            <div className="th-name">{d.companyName} <span className="th-sym">{d.ticker}</span></div>
                                            <div className="th-price-row">
                                                <span className="th-price">{fmtCur(d.price, cur)}</span>
                                                <span className={`th-chg ${d.change >= 0 ? 'pos' : 'neg'}`}>
                                                    {d.change >= 0 ? '▲' : '▼'} {fmt(Math.abs(d.change))} ({fmt(Math.abs(d.changePercent))}%)
                                                </span>
                                            </div>
                                            <div className="th-meta">
                                                {[
                                                    ['Open', d.openPrice ? fmtCur(d.openPrice, cur) : 'N/A'],
                                                    ['High', d.dayHigh ? fmtCur(d.dayHigh, cur) : 'N/A'],
                                                    ['Low', d.dayLow ? fmtCur(d.dayLow, cur) : 'N/A'],
                                                    ['Prev Close', d.prevClose ? fmtCur(d.prevClose, cur) : 'N/A'],
                                                    ['52W High', d.fiftyTwoWeekHigh ? fmtCur(d.fiftyTwoWeekHigh, cur) : 'N/A'],
                                                    ['52W Low', d.fiftyTwoWeekLow ? fmtCur(d.fiftyTwoWeekLow, cur) : 'N/A'],
                                                    ['Volume', d.volume ? (d.volume / 1e6).toFixed(2) + 'M' : 'N/A'],
                                                    ['Avg Vol', d.avgVolume ? (d.avgVolume / 1e6).toFixed(2) + 'M' : 'N/A'],
                                                ].map(([l, v]) => (
                                                    <div key={l} className="th-meta-item">
                                                        <span>{l}</span><strong>{v ?? 'N/A'}</strong>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="th-right">
                                            {/* GTI card */}
                                            <div className="th-gti-card">
                                                <div className="tgc-label">GTI RISK</div>
                                                <div className="tgc-score" style={{ color: gtiCol }}>{gtiScore}</div>
                                                <div className="tgc-lvl" style={{ color: gtiCol }}>{gtiLvl}</div>
                                            </div>
                                            {/* Rec box */}
                                            <div className="th-rec-box" style={{ borderColor: actionColor(rec?.action) + '66' }}>
                                                <div className="rec-action" style={{ color: actionColor(rec?.action) }}>{rec?.action || 'HOLD'}</div>
                                                <div className="rec-conf-bar">
                                                    <div className="rec-conf-fill" style={{ width: `${rec?.confidence || 50}%`, background: actionColor(rec?.action) }} />
                                                </div>
                                                <div className="rec-levels">
                                                    <span>Target: <strong className="pos">{fmtCur(rec?.targetArea, cur)}</strong></span>
                                                    <span>Stop: <strong className="neg">{fmtCur(rec?.stopLoss, cur)}</strong></span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Chart controls */}
                                    <div className="term-chart-card">
                                        <div className="tcc-ctrl">
                                            <div className="tcc-group">
                                                {['1m', '5m', '15m', '1h', '1d'].map(it => (
                                                    <button key={it} className={interval === it ? 'active' : ''} onClick={() => { setInterval(it); if (it !== '1d') setPeriod('1d'); fetchTerminal(ticker, it !== '1d' ? '1d' : period, it); }}>{it}</button>
                                                ))}
                                            </div>
                                            <div className="tcc-group">
                                                {['1d', '1wk', '1mo', '6mo', '1y'].map(p => (
                                                    <button key={p} className={period === p ? 'active' : ''} onClick={() => { setPeriod(p); setInterval('1d'); fetchTerminal(ticker, p, '1d'); }}>{p}</button>
                                                ))}
                                            </div>
                                        </div>
                                        <div ref={chartContainerRef} className="chart-box">
                                            {(!d.chartData?.length) && <div className="geo-empty">No chart data for this range</div>}
                                        </div>
                                    </div>

                                    {/* Tabs */}
                                    <div className="term-tabs">
                                        {['technical', 'financials', 'news', 'options', 'movers'].map(tb => (
                                            <button key={tb} className={activeTab === tb ? 'active' : ''} onClick={() => setActiveTab(tb)}>
                                                {tb === 'movers' ? '⚡ MOVERS' : tb.toUpperCase()}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="term-tab-body">
                                        {/* TECHNICAL */}
                                        {activeTab === 'technical' && (
                                            t ? (
                                                <div className="term-grid-3">
                                                    <div className="term-card">
                                                        <h3>Oscillators</h3>
                                                        <div className="gauge-row">
                                                            <Gauge val={t.rsi} label="RSI(14)" color={t.rsi > 70 ? '#ef4444' : t.rsi < 30 ? '#10b981' : '#eab308'} />
                                                            <Gauge val={t.stochastic?.k} label="STOCH %K" color={t.stochastic?.k > 80 ? '#ef4444' : t.stochastic?.k < 20 ? '#10b981' : '#eab308'} />
                                                            {t.adx && <Gauge val={t.adx.adx} label="ADX" color={t.adx.adx > 25 ? '#06b6d4' : '#64748b'} />}
                                                        </div>
                                                        <div className="term-list">
                                                            <div><span>MACD</span><strong className={t.macd?.MACD > 0 ? 'pos' : 'neg'}>{fmt(t.macd?.MACD, 3)}</strong></div>
                                                            <div><span>Signal</span><strong>{fmt(t.macd?.signal, 3)}</strong></div>
                                                            <div><span>Histogram</span><strong className={t.macd?.histogram > 0 ? 'pos' : 'neg'}>{fmt(t.macd?.histogram, 3)}</strong></div>
                                                            {t.adx && <div><span>+DI / -DI</span><strong><span className="pos">{fmt(t.adx.pdi, 1)}</span> / <span className="neg">{fmt(t.adx.mdi, 1)}</span></strong></div>}
                                                        </div>
                                                    </div>
                                                    <div className="term-card">
                                                        <h3>Moving Averages</h3>
                                                        <div className="term-list">
                                                            {[['EMA 9', t.ema9], ['EMA 21', t.ema21], ['SMA 50', t.sma50], ['SMA 200', t.sma200]].filter(([,v]) => v != null).map(([l, v]) => (
                                                                <div key={l}>
                                                                    <span>{l}</span>
                                                                    <strong>{fmtCur(v, cur)}</strong>
                                                                    <span className={d.price > v ? 'pos' : 'neg'}>{d.price > v ? '↑ Above' : '↓ Below'}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {t.bb && (
                                                            <>
                                                                <h3 style={{ marginTop: '12px' }}>Bollinger Bands (20,2)</h3>
                                                                <div className="term-list">
                                                                    <div><span>Upper</span><strong className="neg">{fmtCur(t.bb.upper, cur)}</strong></div>
                                                                    <div><span>Middle</span><strong>{fmtCur(t.bb.middle, cur)}</strong></div>
                                                                    <div><span>Lower</span><strong className="pos">{fmtCur(t.bb.lower, cur)}</strong></div>
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                    <div className="term-card">
                                                        <h3>Pivot Levels</h3>
                                                        <div className="term-list">
                                                            {[['R2', t.pivots.r2, 'neg'], ['R1', t.pivots.r1, 'neg'], ['Pivot', t.pivots.pivot, ''], ['S1', t.pivots.s1, 'pos'], ['S2', t.pivots.s2, 'pos']].map(([l, v, cls]) => (
                                                                <div key={l} className={cls}><span>{l}</span><strong>{fmtCur(v, cur)}</strong></div>
                                                            ))}
                                                        </div>
                                                        <h3 style={{ marginTop: '12px' }}>Range Context</h3>
                                                        <div className="term-list">
                                                            <div><span>Day High</span><strong className="pos">{fmtCur(d.dayHigh, cur)}</strong></div>
                                                            <div><span>Day Low</span><strong className="neg">{fmtCur(d.dayLow, cur)}</strong></div>
                                                            <div><span>52W High</span><strong className="pos">{fmtCur(d.fiftyTwoWeekHigh, cur)}</strong></div>
                                                            <div><span>52W Low</span><strong className="neg">{fmtCur(d.fiftyTwoWeekLow, cur)}</strong></div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : <div className="geo-empty">Insufficient data for technicals</div>
                                        )}

                                        {/* FINANCIALS */}
                                        {activeTab === 'financials' && (
                                            <div className="term-card full">
                                                <div className="fin-grid">
                                                    {Object.entries(d.financials).map(([k, v]) => (
                                                        <div key={k} className="fin-item"><span>{k}</span><strong>{v}</strong></div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* NEWS */}
                                        {activeTab === 'news' && (
                                            <div className="news-list">
                                                {d.news?.length ? d.news.map((n, i) => (
                                                    <a key={i} href={n.link} target="_blank" rel="noreferrer" className="news-card">
                                                        <div className="nc-top">
                                                            <span className="nc-sent" style={{ color: sentColor(n.sentiment), borderColor: sentColor(n.sentiment) + '55', background: sentColor(n.sentiment) + '14' }}>
                                                                {sentLabel(n.sentiment)}
                                                            </span>
                                                            <span className="nc-time">{n.time}</span>
                                                        </div>
                                                        <div className="nc-title">{n.title}</div>
                                                        <div className="nc-footer">
                                                            <span className="nc-pub">{n.publisher}</span>
                                                            <div className="nc-tags">{(n.sectors || []).map(s => <span key={s} className="nc-tag">{s}</span>)}</div>
                                                        </div>
                                                    </a>
                                                )) : <div className="geo-empty">No news available</div>}
                                            </div>
                                        )}

                                        {/* OPTIONS */}
                                        {activeTab === 'options' && (
                                            options?.expiry ? (
                                                <div className="options-pro">
                                                    <div className="opt-top-bar">
                                                        <div className="expiry-bar">
                                                            <span className="expiry-label">EXPIRY</span>
                                                            {(options.expiryDates || [options.expiry]).map(exp => (
                                                                <button key={exp} className={`expiry-btn${(selectedExpiry || options.expiry) === exp ? ' active' : ''}`}
                                                                    onClick={() => fetchOptionsWithExpiry(ticker, exp)}>{exp}</button>
                                                            ))}
                                                        </div>
                                                        <span className={`opt-source-badge ${options.source === 'THEORETICAL' ? 'src-theoretical' : 'src-live'}`}>
                                                            {options.source === 'THEORETICAL' ? `⚗ THEORETICAL · BS · IV ${options.hv}%` : '● LIVE DATA'}
                                                        </span>
                                                    </div>
                                                    <div className="opt-stats-bar">
                                                        <div className="opt-stat-item">
                                                            <span>PUT/CALL RATIO</span>
                                                            <strong style={{ color: options.pcr > 1.2 ? '#10b981' : options.pcr < 0.8 ? '#ef4444' : '#eab308' }}>{options.pcr ?? 'N/A'}</strong>
                                                            <em>{options.pcr > 1.2 ? 'Bullish Bias' : options.pcr < 0.8 ? 'Bearish Bias' : 'Neutral'}</em>
                                                        </div>
                                                        <div className="opt-stat-divider" />
                                                        <div className="opt-stat-item">
                                                            <span>MAX PAIN</span>
                                                            <strong>{fmtCur(options.maxPain, cur)}</strong>
                                                            <em>Option Writer Target</em>
                                                        </div>
                                                        <div className="opt-stat-divider" />
                                                        <div className="opt-stat-item">
                                                            <span>EXPIRY</span>
                                                            <strong>{options.expiry}</strong>
                                                        </div>
                                                        <div className="opt-stat-divider" />
                                                        <div className="opt-oi-split-block">
                                                            <div className="ois-labels">
                                                                <span className="neg">Calls {totalOI ? ((options.totalCallOI / totalOI) * 100).toFixed(0) : 50}%</span>
                                                                <span className="pos">Puts {totalOI ? ((options.totalPutOI / totalOI) * 100).toFixed(0) : 50}%</span>
                                                            </div>
                                                            <div className="ois-bar">
                                                                <div className="ois-call" style={{ width: `${totalOI ? (options.totalCallOI / totalOI) * 100 : 50}%` }} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="chain-wrap">
                                                        <div className="chain-head">
                                                            <div className="ch-side calls-head"><span>OI(K)</span><span>IV%</span><span>LTP</span><span className="bar-col">Bar</span></div>
                                                            <div className="ch-strike-head">STRIKE</div>
                                                            <div className="ch-side puts-head"><span className="bar-col">Bar</span><span>LTP</span><span>IV%</span><span>OI(K)</span></div>
                                                        </div>
                                                        <div className="chain-body">
                                                            {allStrikes.map(strike => {
                                                                const call = callsMap[strike], put = putsMap[strike];
                                                                const isAtm = d && Math.abs(strike - d.price) / d.price < 0.015;
                                                                const isMp  = strike === options.maxPain;
                                                                return (
                                                                    <div key={strike} className={`chain-row${isAtm ? ' atm' : ''}${isMp ? ' mp' : ''}`}>
                                                                        <div className={`cr-side cr-call${call?.inTheMoney ? ' itm' : ''}`}>
                                                                            {call ? <>
                                                                                <span className="ch-oi">{(call.oi / 1000).toFixed(0)}K</span>
                                                                                <span className="ch-iv">{call.iv != null ? call.iv + '%' : '—'}</span>
                                                                                <span className="ch-ltp">{call.lastPrice.toFixed(1)}</span>
                                                                                <div className="oi-bar-wrap"><div className="oi-bar call-oi" style={{ width: `${(call.oi / options.maxOI) * 100}%` }} /></div>
                                                                            </> : <span className="ch-null">—</span>}
                                                                        </div>
                                                                        <div className={`cr-strike${isAtm ? ' atm-s' : ''}${isMp ? ' mp-s' : ''}`}>
                                                                            <span>{strike.toLocaleString('en-IN')}</span>
                                                                            <div className="strike-badges">
                                                                                {isAtm && <span className="badge atm-b">ATM</span>}
                                                                                {isMp  && <span className="badge mp-b">MP</span>}
                                                                            </div>
                                                                        </div>
                                                                        <div className={`cr-side cr-put${put?.inTheMoney ? ' itm' : ''}`}>
                                                                            {put ? <>
                                                                                <div className="oi-bar-wrap"><div className="oi-bar put-oi" style={{ width: `${(put.oi / options.maxOI) * 100}%` }} /></div>
                                                                                <span className="ch-ltp">{put.lastPrice.toFixed(1)}</span>
                                                                                <span className="ch-iv">{put.iv != null ? put.iv + '%' : '—'}</span>
                                                                                <span className="ch-oi">{(put.oi / 1000).toFixed(0)}K</span>
                                                                            </> : <span className="ch-null">—</span>}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : <div className="geo-empty">No options data available</div>
                                        )}

                                        {/* MOVERS */}
                                        {activeTab === 'movers' && (
                                            <div className="movers-panel">
                                                <div className="mov-header">
                                                    <span className="mov-title">⚡ TOP MOVERS</span>
                                                    <div className="mov-tf-btns">
                                                        {[['5m', '5M'], ['15m', '15M'], ['1h', '1H'], ['1d', 'TODAY']].map(([v, l]) => (
                                                            <button key={v} className={`mov-tf-btn${activeMovTf === v ? ' active' : ''}`} onClick={() => setActiveMovTf(v)}>{l}</button>
                                                        ))}
                                                    </div>
                                                    <div className="index-pulse">
                                                        {(movers?.indices || []).map(idx => (
                                                            <div key={idx.symbol} className="idx-chip">
                                                                <span className="idx-name">{idx.name?.includes('NIFTY 50') ? 'NIFTY' : idx.name?.includes('BANK') ? 'BANKNIFTY' : 'SENSEX'}</span>
                                                                <span className="idx-price">{idx.price?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                                                <span className={`idx-chg ${idx.change >= 0 ? 'pos' : 'neg'}`}>{idx.change >= 0 ? '▲' : '▼'}{Math.abs(idx.change)}%</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                {moversLoading
                                                    ? <div className="geo-empty">Scanning market for top movers…</div>
                                                    : movers ? (
                                                        <div className="movers-grid">
                                                            <div className="movers-col">
                                                                <div className="mc-head gainers-head">📈 GAINERS</div>
                                                                {(movers.gainers || []).map(s => (
                                                                    <div key={s.symbol} className="mover-card mc-gainer">
                                                                        <div className="mc-body">
                                                                            <div className="mc-left">
                                                                                <div className="mc-sym" onClick={() => handleSelect(s.symbol)}>{s.symbol.replace('.NS', '')}</div>
                                                                                <div className="mc-name">{s.name}</div>
                                                                                <div className="mc-vol">
                                                                                    <span className="mc-rvol">{s.relVol}x vol</span>
                                                                                    {s.relVol >= 1.5 && <span className="mc-surge">⚡ SURGE</span>}
                                                                                </div>
                                                                            </div>
                                                                            <div className="mc-right">
                                                                                <div className="mc-price">₹{s.price?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                                                                                <div className="mc-chg pos">▲ {Math.abs(s.change)}%</div>
                                                                                <div className="mc-bar-wrap"><div className="mc-bar mc-bar-pos" style={{ width: `${Math.min(100, Math.abs(s.change) * 20)}%` }} /></div>
                                                                            </div>
                                                                        </div>
                                                                        <div className="mc-actions">
                                                                            <button className="mc-opt-btn" onClick={() => fetchMoverOpt(s.symbol)}>{moversOptTicker === s.symbol ? '✕ Close' : '⛓ Chain'}</button>
                                                                            <button className="mc-analyze-btn" onClick={() => handleSelect(s.symbol)}>Analyze →</button>
                                                                        </div>
                                                                        {moversOptTicker === s.symbol && (
                                                                            <div className="mc-chain-mini">
                                                                                {moversOptLoading ? <div className="geo-empty" style={{ fontSize: '11px' }}>Loading…</div> : moversOpt ? (
                                                                                    <>
                                                                                        <div className="mcm-stats">
                                                                                            <span>PCR: <strong style={{ color: moversOpt.pcr > 1.2 ? '#10b981' : '#ef4444' }}>{moversOpt.pcr}</strong></span>
                                                                                            <span>Max Pain: <strong style={{ color: '#eab308' }}>₹{moversOpt.maxPain?.toLocaleString('en-IN')}</strong></span>
                                                                                            <span className={`opt-source-badge mini-src ${moversOpt.source === 'THEORETICAL' ? 'src-theoretical' : 'src-live'}`}>
                                                                                                {moversOpt.source === 'THEORETICAL' ? `⚗ BS·IV ${moversOpt.hv}%` : '● LIVE'}
                                                                                            </span>
                                                                                        </div>
                                                                                        <div className="mcm-head"><span>LTP</span><span>IV%</span><span>OI</span><span>STRIKE</span><span>OI</span><span>IV%</span><span>LTP</span></div>
                                                                                        {(() => {
                                                                                            const strikes = [...new Set([...(moversOpt.calls || []).map(c => c.strike), ...(moversOpt.puts || []).map(p => p.strike)])].sort((a, b) => a - b);
                                                                                            const atmI = strikes.reduce((best, st, i) => Math.abs(st - s.price) < Math.abs(strikes[best] - s.price) ? i : best, 0);
                                                                                            const mini = strikes.slice(Math.max(0, atmI - 3), Math.min(strikes.length, atmI + 4));
                                                                                            const cm = Object.fromEntries((moversOpt.calls || []).map(c => [c.strike, c]));
                                                                                            const pm = Object.fromEntries((moversOpt.puts || []).map(p => [p.strike, p]));
                                                                                            return mini.map(strike => {
                                                                                                const c = cm[strike], p = pm[strike];
                                                                                                const isAtm = Math.abs(strike - s.price) / s.price < 0.015;
                                                                                                return (
                                                                                                    <div key={strike} className={`mcm-row${isAtm ? ' atm' : ''}${strike === moversOpt.maxPain ? ' mp' : ''}`}>
                                                                                                        <span>{c ? c.lastPrice.toFixed(1) : '—'}</span><span>{c ? c.iv + '%' : '—'}</span><span>{c ? (c.oi / 1000).toFixed(0) + 'K' : '—'}</span>
                                                                                                        <span className={`mcm-strike${isAtm ? ' atm-s' : ''}`}>{strike.toLocaleString('en-IN')}{isAtm && <span className="badge atm-b">A</span>}</span>
                                                                                                        <span>{p ? (p.oi / 1000).toFixed(0) + 'K' : '—'}</span><span>{p ? p.iv + '%' : '—'}</span><span>{p ? p.lastPrice.toFixed(1) : '—'}</span>
                                                                                                    </div>
                                                                                                );
                                                                                            });
                                                                                        })()}
                                                                                    </>
                                                                                ) : null}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            <div className="movers-col">
                                                                <div className="mc-head losers-head">📉 LOSERS</div>
                                                                {(movers.losers || []).map(s => (
                                                                    <div key={s.symbol} className="mover-card mc-loser">
                                                                        <div className="mc-body">
                                                                            <div className="mc-left">
                                                                                <div className="mc-sym" onClick={() => handleSelect(s.symbol)}>{s.symbol.replace('.NS', '')}</div>
                                                                                <div className="mc-name">{s.name}</div>
                                                                                <div className="mc-vol">
                                                                                    <span className="mc-rvol">{s.relVol}x vol</span>
                                                                                    {s.relVol >= 1.5 && <span className="mc-surge">⚡ SURGE</span>}
                                                                                </div>
                                                                            </div>
                                                                            <div className="mc-right">
                                                                                <div className="mc-price">₹{s.price?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                                                                                <div className="mc-chg neg">▼ {Math.abs(s.change)}%</div>
                                                                                <div className="mc-bar-wrap"><div className="mc-bar mc-bar-neg" style={{ width: `${Math.min(100, Math.abs(s.change) * 20)}%` }} /></div>
                                                                            </div>
                                                                        </div>
                                                                        <div className="mc-actions">
                                                                            <button className="mc-opt-btn" onClick={() => fetchMoverOpt(s.symbol)}>{moversOptTicker === s.symbol ? '✕ Close' : '⛓ Chain'}</button>
                                                                            <button className="mc-analyze-btn" onClick={() => handleSelect(s.symbol)}>Analyze →</button>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ) : null}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* ════ AI SIGNALS VIEW ════ */}
                {activeView === 'signals' && (
                    <div className="signals-view">
                        {/* Globe background */}
                        <div className="sig-globe-bg"><GlobeView /></div>

                        <div className="sv-overlay">
                            <div className="sv-header">
                                <div className="sv-title-row">
                                    <h2>⊿ AI SIGNAL FEED</h2>
                                    <span className="sv-meta">GTI-Adjusted · Black-Scholes · Model v2.0</span>
                                </div>
                                <div className="sv-filters">
                                    {['All', 'BUY', 'SELL', 'HOLD'].map(f => (
                                        <button key={f} className={`sv-filter-btn${sigFilter === f ? ' active' : ''}`}
                                            style={f !== 'All' && sigFilter === f ? { borderColor: dirColor(f), color: dirColor(f) } : {}}
                                            onClick={() => setSigFilter(f)}>{f}</button>
                                    ))}
                                    <span className="sv-gti-pill" style={{ borderColor: gtiCol, color: gtiCol }}>GTI {gtiScore} · {gtiLvl}</span>
                                </div>
                            </div>
                            <div className="signals-grid">
                                {sigLoading
                                    ? <div className="geo-empty">Scanning geopolitical signals…</div>
                                    : filteredSig.map((s, i) => <SignalCard key={i} sig={s} onAnalyze={handleSelect} />)}
                            </div>
                        </div>
                    </div>
                )}

            </div>{/* /geo-main */}

            {/* ── BOTTOM BAR — Scrolling NSE Indices ── */}
            <div className="geo-bottom indices-bar">
                <div className="ib-label">
                    <span className="ib-live-dot" />NSE LIVE
                </div>
                <div className="ib-track-wrap">
                    <div className="ib-track">
                        {[...indicesBar, ...indicesBar].map((idx, i) => (
                            <div key={i} className="ib-chip">
                                <span className="ib-name">{idx.name.replace('S&P BSE SENSEX', 'SENSEX').replace('NIFTY FINANCIAL SERVICES', 'NIFTY FIN SVC').replace('NIFTY HEALTHCARE INDEX', 'NIFTY HEALTH').replace('NIFTY CONSUMER DURABLES', 'NIFTY CONS DUR')}</span>
                                <span className="ib-price">{idx.price?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                                <span className={`ib-chg ${(idx.changePercent || 0) >= 0 ? 'pos' : 'neg'}`}>
                                    {(idx.changePercent || 0) >= 0 ? '▲' : '▼'}{Math.abs(idx.changePercent || 0).toFixed(2)}%
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="ib-gti" style={{ color: gtiCol }}>
                    <GTISparkline history={gtiHistory} />
                    <span className="ib-gti-score">{gtiScore}</span>
                    <span className="ib-gti-lvl">{gtiLvl}</span>
                </div>
            </div>

            {/* ── MOBILE BOTTOM NAV ── */}
            <nav className="mobile-nav">
                {[
                    { view: 'home',      icon: '⌂', label: 'Home' },
                    { view: 'geopulse', icon: '⊕', label: 'Earth' },
                    { view: 'terminal', icon: '⊞', label: 'Terminal' },
                    { view: 'signals',  icon: '⊿', label: 'Signals' },
                ].map(({ view, icon, label }) => (
                    <button key={view} className={activeView === view ? 'active' : ''} onClick={() => setActiveView(view)}>
                        <span className="mn-icon">{icon}</span>
                        {label}
                    </button>
                ))}
            </nav>
        </div>
    );
}
