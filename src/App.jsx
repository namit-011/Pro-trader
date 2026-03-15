import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as LightweightCharts from 'lightweight-charts';

const API = '/api';

// ── Helpers ──
const fmt = (n, d = 2) => (n != null && !isNaN(n)) ? Number(n).toFixed(d) : 'N/A';
const fmtCur = (n, c = '₹') => (n != null && !isNaN(n) && n !== 0) ? `${c}${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'N/A';

// GTI helpers
const gtiColor  = g => g >= 80 ? '#ef4444' : g >= 60 ? '#fb923c' : g >= 35 ? '#3b82f6' : '#22c55e';
const gtiLevel  = g => g >= 80 ? 'CRITICAL' : g >= 60 ? 'ELEVATED' : g >= 35 ? 'MEDIUM' : 'LOW';
const dirColor  = d => ({ BUY: '#10b981', SELL: '#ef4444', HOLD: '#eab308' }[d] || '#94a3b8');
const sentColor = s => ({ bullish: '#10b981', bearish: '#ef4444', neutral: '#94a3b8' }[s] || '#94a3b8');
const sentLabel = s => ({ bullish: '▲ BULLISH', bearish: '▼ BEARISH', neutral: '→ NEUTRAL' }[s] || '→ NEUTRAL');
const actionColor = a => ({ 'STRONG BUY': '#10b981', 'BUY': '#10b981', 'HOLD': '#eab308', 'SELL': '#ef4444', 'STRONG SELL': '#b91c1c' }[a] || '#94a3b8');
const indiaLabel = s => ({ bullish: '▲ India', bearish: '▼ India', neutral: '~ India' }[s] || '~ India');

// NSE index name → Yahoo Finance symbol (for clickable chips)
const NSE_YAHOO = {
    'NIFTY 50': '^NSEI', 'NIFTY BANK': '^NSEBANK', 'INDIA VIX': '^INDIAVIX',
    'S&P BSE SENSEX': '^BSESN', 'NIFTY MIDCAP 100': '^CNXMIDCAP', 'NIFTY SMALLCAP 100': '^CNXSC',
    'NIFTY IT': '^CNXIT', 'NIFTY AUTO': '^CNXAUTO', 'NIFTY PHARMA': '^CNXPHARMA',
    'NIFTY FMCG': '^CNXFMCG', 'NIFTY METAL': '^CNXMETAL', 'NIFTY ENERGY': '^CNXENERGY',
    'NIFTY REALTY': '^CNXREALTY', 'NIFTY FINANCIAL SERVICES': '^NSEBANK',
    'NIFTY INFRA': '^CNXINFRA', 'NIFTY MEDIA': '^CNXMEDIA',
};
const nseShortName = n => n.replace('NIFTY FINANCIAL SERVICES','FINNIFTY').replace('NIFTY MIDCAP 100','MIDCAP').replace('NIFTY SMALLCAP 100','SMALLCAP').replace('S&P BSE SENSEX','SENSEX').replace('NIFTY BANK','BANKNIFTY').replace('NIFTY 50','NIFTY').replace('INDIA VIX','VIX').replace('NIFTY ','');

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
    const [period, setPeriod]     = useState('1d');
    const [interval, setInterval] = useState('5m');
    const [newsFilter, setNewsFilter] = useState('All'); // terminal news sentiment filter
    const [search, setSearch]     = useState('RELIANCE.NS');
    const [selectedExpiry, setSelectedExpiry] = useState(null);
    const selectedExpiryRef = useRef(null);

    // Market breadth + rates
    const [marketBreadth, setMarketBreadth] = useState(null);
    const [rates, setRates]               = useState([]);

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

    // HFT Model
    const [hftLoggedIn, setHftLoggedIn] = useState(() => localStorage.getItem('hft_auth') === 'true');
    const [hftLoginForm, setHftLoginForm] = useState({ email: '', password: '' });
    const [hftLoginErr, setHftLoginErr] = useState('');
    const [hftData, setHftData] = useState(null);
    const [hftTicker, setHftTicker] = useState('RELIANCE.NS');
    const [hftLoading, setHftLoading] = useState(false);
    const [trades, setTrades] = useState(() => {
        try { return JSON.parse(localStorage.getItem('hft_trades') || '[]'); } catch { return []; }
    });
    const [tradeForm, setTradeForm] = useState({ symbol: '', direction: 'LONG', entry: '', exit: '', qty: '', time: '', notes: '' });
    const [hftTab, setHftTab] = useState('dashboard');
    // F&O Scanner
    const [foData, setFoData] = useState(null);
    const [foLoading, setFoLoading] = useState(false);

    // Alerts
    const [alerts, setAlerts] = useState(() => {
        try { return JSON.parse(localStorage.getItem('tx_alerts') || '[]'); } catch { return []; }
    });
    const [alertsOpen, setAlertsOpen] = useState(false);
    const [alertForm, setAlertForm] = useState({ symbol: '', price: '', direction: 'ABOVE' });
    const [firedAlerts, setFiredAlerts] = useState([]);
    const alertsRef = useRef(null);

    // Close alerts panel when clicking outside
    useEffect(() => {
        if (!alertsOpen) return;
        const handler = (e) => {
            if (alertsRef.current && !alertsRef.current.contains(e.target)) {
                setAlertsOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [alertsOpen]);

    // Price flash
    const prevPricesRef = useRef({});

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

    const fetchMarketBreadth = useCallback(async () => {
        try {
            const r = await fetch(`${API}/marketbreadth`).then(x => x.json());
            if (r?.total >= 0) setMarketBreadth(r);
        } catch {}
    }, []);

    const fetchRates = useCallback(async () => {
        try {
            const r = await fetch(`${API}/rates`).then(x => x.json());
            setRates(Array.isArray(r) ? r : []);
        } catch {}
    }, []);

    const fetchCountryIndices = useCallback(async (iso, name) => {
        setCountryModal({ iso, name, data: null });
        try {
            const r = await fetch(`${API}/country/${iso}`).then(x => x.json());
            setCountryModal({ iso, name, data: r.tickers || [] });
        } catch { setCountryModal({ iso, name, data: [] }); }
    }, []);

    const fetchHFT = useCallback(async (sym) => {
        setHftLoading(true);
        try {
            const r = await fetch(`${API}/hft/${encodeURIComponent(sym)}`).then(x => x.json());
            setHftData(r);
        } catch {} finally { setHftLoading(false); }
    }, []);

    const fetchFO = useCallback(async () => {
        setFoLoading(true);
        try {
            const r = await fetch(`${API}/fo-scanner`).then(x => x.json());
            setFoData(Array.isArray(r) ? r : []);
        } catch { setFoData([]); } finally { setFoLoading(false); }
    }, []);

    // Check price alerts against live data
    useEffect(() => {
        const check = () => {
            const allPrices = {};
            indicesBar.forEach(idx => { if (NSE_YAHOO[idx.name]) allPrices[NSE_YAHOO[idx.name]] = idx.price; });
            liveTape.forEach(s => { allPrices[s.symbol] = s.price; });
            const triggered = alerts.filter(a => {
                const p = allPrices[a.symbol];
                if (!p) return false;
                return a.direction === 'ABOVE' ? p >= parseFloat(a.price) : p <= parseFloat(a.price);
            });
            if (triggered.length > 0) {
                setFiredAlerts(prev => [...new Set([...prev, ...triggered.map(a => a.id)])]);
            }
        };
        check();
    }, [indicesBar, liveTape, alerts]);

    // Mount & auto-refresh
    useEffect(() => {
        fetchGTI(); fetchSignals(); fetchGlobal(); fetchFutures();
        fetchLiveTape(); fetchIndicesBar(); fetchMarketBreadth(); fetchRates();
        fetchTerminal(ticker, period, interval);
        const t1 = setInterval(fetchGTI, 60000);
        const t2 = setInterval(fetchSignals, 60000);
        const t3 = setInterval(fetchGlobal, 12000);
        const t4 = setInterval(fetchFutures, 12000);
        const t5 = setInterval(fetchLiveTape, 8000);
        const t6 = setInterval(fetchIndicesBar, 3000);
        const t7 = setInterval(fetchMarketBreadth, 30000);
        const t8 = setInterval(fetchRates, 15000);
        return () => { [t1,t2,t3,t4,t5,t6,t7,t8].forEach(clearInterval); };
    }, []);

    // Keyboard shortcuts: F1=home F2=geopulse F3=terminal F4=signals F5=hftmodel
    useEffect(() => {
        const handler = (e) => {
            if (e.target.tagName === 'INPUT') return;
            if (e.key === 'F1') { e.preventDefault(); setActiveView('home'); }
            if (e.key === 'F2') { e.preventDefault(); setActiveView('geopulse'); }
            if (e.key === 'F3') { e.preventDefault(); setActiveView('terminal'); }
            if (e.key === 'F4') { e.preventDefault(); setActiveView('signals'); }
            if (e.key === 'F5') { e.preventDefault(); setActiveView('hftmodel'); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
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
        cs.setData(data.chartData);
        // Only show volume histogram when there is actual volume data (not for indices)
        const allVols = data.chartData.map(v => v.volume || 0).filter(v => v > 0);
        const hasVolume = allVols.length > 0 && !data.isIndex;
        if (hasVolume) {
            const vs = chart.addSeries(LightweightCharts.HistogramSeries, {
                color: '#3b82f6', priceFormat: { type: 'volume' }, priceScaleId: '',
            });
            vs.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
            // Compute average volume for spike detection
            const avgVol = allVols.length > 1 ? allVols.slice(0, -1).reduce((a, b) => a + b, 0) / (allVols.length - 1) : 0;
            vs.setData(data.chartData.map(v => {
                const isSpike = avgVol > 0 && (v.volume || 0) > avgVol * 1.5;
                const color = isSpike
                    ? (v.close >= v.open ? 'rgba(0,255,180,0.85)' : 'rgba(255,80,80,0.85)')
                    : (v.close >= v.open ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)');
                return { time: v.time, value: v.volume, color };
            }));
        }
        chart.timeScale().fitContent();
        chartRef.current = chart;
        const onResize = () => { if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth }); };
        window.addEventListener('resize', onResize);
        return () => { window.removeEventListener('resize', onResize); if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; } };
    }, [data, interval]);

    const handleSelect = (s) => {
        if (!s) return;
        let sym = s.toUpperCase().trim();
        // Auto-append .NS for bare Indian stock symbols (no suffix, no ^, no =F)
        if (sym && !sym.includes('.') && !sym.startsWith('^') && !sym.endsWith('=F') && !sym.endsWith('=X')) {
            sym = sym + '.NS';
        }
        setTicker(sym); setSearch(sym);
        setSelectedExpiry(null); selectedExpiryRef.current = null;
        setPeriod('1d'); setInterval('5m');
        fetchTerminal(sym, '1d', '5m');
        setActiveView('terminal');
    };

    // Market status (NSE: Mon-Fri 09:15-15:30 IST = UTC+5:30)
    const marketStatus = (() => {
        const now = new Date();
        const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const day = ist.getDay(); // 0=Sun 6=Sat
        const mins = ist.getHours() * 60 + ist.getMinutes();
        if (day === 0 || day === 6) return { label: 'CLOSED', color: '#64748b', open: false };
        if (mins < 555) return { label: 'PRE-MKT', color: '#eab308', open: false };      // before 09:15
        if (mins < 930) return { label: 'OPEN', color: '#10b981', open: true };           // 09:15-15:30
        if (mins < 960) return { label: 'CLOSING', color: '#fb923c', open: false };       // 15:30-16:00
        return { label: 'CLOSED', color: '#64748b', open: false };
    })();

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
                        <div className="gh-logo-name">Terminal<span className="gh-acc">X</span></div>
                        <div className="gh-logo-sub">MARKET INTELLIGENCE · v3.0</div>
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
                    {[['geopulse', '⊕ EARTH PULSE'], ['terminal', '⊞ TERMINAL'], ['signals', '⊿ AI SIGNALS'], ['hftmodel', '◈ HFT MODEL']].map(([v, l]) => (
                        <button key={v} className={`gh-nav-btn${activeView === v ? ' active' : ''}`} onClick={() => setActiveView(v)}>{l}</button>
                    ))}
                </nav>

                <div className="gh-right">
                    {activeView !== 'home' && (
                    <form className="gh-search" onSubmit={e => { e.preventDefault(); handleSelect(search); setActiveView('terminal'); }}>
                        <input value={search} onChange={e => setSearch(e.target.value.toUpperCase())} placeholder="Symbol · e.g. RELIANCE.NS" className="gh-search-input" />
                        <button type="submit" className="gh-search-btn" aria-label="Search">→</button>
                    </form>
                    )}
                    <div className="gh-alerts-btn" ref={alertsRef} onClick={() => setAlertsOpen(o => !o)}>
                        🔔{firedAlerts.length > 0 && <span className="alert-badge">{firedAlerts.length}</span>}
                        {alertsOpen && (
                            <div className="alerts-panel" onClick={e => e.stopPropagation()}>
                                <div className="ap-hdr">PRICE ALERTS</div>
                                <div className="ap-form">
                                    <input placeholder="Symbol (e.g. RELIANCE.NS)" value={alertForm.symbol} onChange={e => setAlertForm(f => ({...f, symbol: e.target.value.toUpperCase()}))} />
                                    <input type="number" placeholder="Price" value={alertForm.price} onChange={e => setAlertForm(f => ({...f, price: e.target.value}))} />
                                    <select value={alertForm.direction} onChange={e => setAlertForm(f => ({...f, direction: e.target.value}))}>
                                        <option>ABOVE</option><option>BELOW</option>
                                    </select>
                                    <button onClick={() => {
                                        if (!alertForm.symbol || !alertForm.price) return;
                                        const a = { ...alertForm, id: Date.now() };
                                        const updated = [...alerts, a];
                                        setAlerts(updated);
                                        localStorage.setItem('tx_alerts', JSON.stringify(updated));
                                        setAlertForm({ symbol: '', price: '', direction: 'ABOVE' });
                                    }}>+ SET</button>
                                </div>
                                {alerts.length === 0 && <div className="ap-empty">No alerts set</div>}
                                {alerts.map(a => (
                                    <div key={a.id} className={`ap-alert${firedAlerts.includes(a.id) ? ' ap-fired' : ''}`}>
                                        <span>{a.symbol}</span>
                                        <span>{a.direction} ₹{a.price}</span>
                                        {firedAlerts.includes(a.id) && <span className="ap-triggered">🔥 TRIGGERED</span>}
                                        <span className="ap-del" onClick={() => {
                                            const updated = alerts.filter(x => x.id !== a.id);
                                            setAlerts(updated);
                                            localStorage.setItem('tx_alerts', JSON.stringify(updated));
                                        }}>✕</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
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

            {/* ── NSE INDICES STRIP — Pinned Clickable ── */}
            <div className="nse-idx-strip">
                <div className="nis-label"><span className="nis-dot" />NSE</div>
                {indicesBar.slice(0, 10).map((idx, i) => {
                    const sym = NSE_YAHOO[idx.name];
                    const chg = idx.changePercent ?? 0;
                    const prevPrice = prevPricesRef.current[idx.name];
                    const flashing = prevPrice !== undefined && prevPrice !== idx.price;
                    const flashDir = flashing ? (idx.price > prevPrice ? ' flash-up' : ' flash-down') : '';
                    if (idx.price) prevPricesRef.current[idx.name] = idx.price;
                    return (
                        <div key={i} className={`nis-chip${sym ? ' nis-clickable' : ''}${flashDir}`}
                            onClick={sym ? () => handleSelect(sym) : undefined}
                            title={sym ? `Click to analyze ${idx.name}` : idx.name}>
                            <span className="nis-name">{nseShortName(idx.name)}</span>
                            <span className="nis-price">{idx.price?.toLocaleString('en-IN', { maximumFractionDigits: idx.name === 'INDIA VIX' ? 2 : 0 })}</span>
                            <span className={`nis-chg ${chg >= 0 ? 'pos' : 'neg'}`}>{chg >= 0 ? '▲' : '▼'}{Math.abs(chg).toFixed(2)}%</span>
                        </div>
                    );
                })}
                <div className="nis-status" style={{ color: marketStatus.color }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: marketStatus.color, display: 'inline-block', marginRight: 4, boxShadow: `0 0 5px ${marketStatus.color}` }} />
                    {marketStatus.label}
                </div>
            </div>

            {/* ── MAIN ── */}
            <div className="geo-main">

                {/* ════ HOME VIEW — TERMINALX BLOOMBERG ════ */}
                {activeView === 'home' && (() => {
                    const alerts     = news.filter(n => n.highImpact || n.sentimentScore <= 25 || n.sentimentScore >= 80).slice(0, 10);
                    const feedNews   = news.filter(n => !alerts.includes(n)).slice(0, 30);
                    const mktItems   = indicesBar;
                    const callOpps   = signals.filter(s => s.direction === 'BUY' || s.action === 'STRONG BUY').sort((a,b) => b.confidence - a.confidence).slice(0, 8);
                    const putOpps    = signals.filter(s => s.direction === 'SELL' || s.action === 'STRONG SELL').sort((a,b) => b.confidence - a.confidence).slice(0, 6);
                    const foOpps     = [...callOpps.map(s => ({...s, type:'CALL'})), ...putOpps.map(s => ({...s, type:'PUT'}))].sort((a,b) => b.confidence - a.confidence).slice(0, 14);
                    const volSurges  = signals.filter(s => s.volSurge).length;
                    const strongSigs = signals.filter(s => s.action === 'STRONG BUY' || s.action === 'STRONG SELL').length;
                    const approxStrike = p => !p ? 0 : p > 10000 ? Math.round(p/500)*500 : p > 3000 ? Math.round(p/100)*100 : p > 1000 ? Math.round(p/50)*50 : Math.round(p/10)*10;
                    const topSigs    = [...signals].sort((a,b) => b.confidence - a.confidence).slice(0, 12);

                    // Sector heatmap from breadth
                    const sectorEntries = Object.entries(marketBreadth?.sectors || {}).sort((a,b) => b[1].changePercent - a[1].changePercent);

                    // Rates helpers
                    const rateItem = sym => rates.find(r => r.symbol === sym);
                    const usdInr   = rateItem('USDINR=X');
                    const gold     = rateItem('GC=F');
                    const crude    = rateItem('CL=F');
                    const vix      = rateItem('^INDIAVIX');

                    // Economic calendar (upcoming key events)
                    const calendar = [
                        { date: 'Mar 19', event: 'RBI MPC Minutes', impact: 'HIGH',   type: 'RBI'   },
                        { date: 'Mar 20', event: 'US FOMC Decision', impact: 'HIGH',  type: 'FED'   },
                        { date: 'Mar 21', event: 'India WPI Inflation', impact: 'MED', type: 'DATA' },
                        { date: 'Mar 28', event: 'US GDP Q4 Final', impact: 'MED',    type: 'DATA'  },
                        { date: 'Apr 02', event: 'India PMI Manufacturing', impact: 'MED', type: 'DATA' },
                        { date: 'Apr 07', event: 'RBI Policy Meeting', impact: 'HIGH', type: 'RBI'  },
                    ];

                    return (
                    <div className="home-view hb-home">

                        {/* ── Command Bar ── */}
                        <div className="hb-cmd-bar">
                            <div className="hbc-logo">
                                <span className="hbc-logo-icon">◈</span>
                                <span className="hbc-logo-text">Terminal<span>X</span></span>
                                <span className="hbc-logo-sub">PROFESSIONAL MARKET TERMINAL</span>
                            </div>
                            <form className="hbc-search" onSubmit={e => { e.preventDefault(); handleSelect(search); }}>
                                <span className="hbc-search-label">SYMBOL&gt;</span>
                                <input
                                    value={search}
                                    onChange={e => setSearch(e.target.value.toUpperCase())}
                                    placeholder="RELIANCE · HDFCBANK · ^NSEI · AAPL · GC=F"
                                    className="hbc-search-input"
                                    autoCapitalize="characters"
                                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleSelect(search))}
                                />
                                <button type="submit" className="hbc-search-btn">GO ›</button>
                            </form>
                            <div className="hbc-quick">
                                {[
                                    ['RELIANCE','RELIANCE.NS'],['TCS','TCS.NS'],['HDFCBANK','HDFCBANK.NS'],
                                    ['INFY','INFY.NS'],['SBIN','SBIN.NS'],['BHARTIARTL','BHARTIARTL.NS'],
                                    ['ICICIBANK','ICICIBANK.NS'],['NIFTY','^NSEI'],['BANKNIFTY','^NSEBANK'],
                                    ['SENSEX','^BSESN'],['GOLD','GC=F'],['CRUDE','CL=F'],
                                ].map(([lbl,s]) => (
                                    <button key={s} className="hbc-quick-btn" onClick={() => handleSelect(s)}>{lbl}</button>
                                ))}
                            </div>
                            <div className="hbc-status-grp">
                                <div className="hbc-mkt-status" style={{ color: marketStatus.color, borderColor: marketStatus.color + '55' }}>
                                    <span className="hbc-status-dot" style={{ background: marketStatus.color, boxShadow: `0 0 5px ${marketStatus.color}` }} />
                                    NSE {marketStatus.label}
                                </div>
                                <div className="hbc-time">{clock}</div>
                            </div>
                        </div>

                        {/* ── Market Overview Bar ── */}
                        <div className="hb-mkt-bar">
                            <div className="hbm-label">NSE LIVE</div>
                            <div className="hbm-track-wrap">
                                <div className="hbm-track">
                                    {[...mktItems, ...mktItems].map((item, i) => {
                                        const chg = item.changePercent ?? item.change ?? 0;
                                        const isPos = chg >= 0;
                                        return (
                                            <div key={i} className={`hbm-chip ${isPos ? 'hbm-pos' : 'hbm-neg'}`}>
                                                <span className="hbm-sym">{(item.symbol || item.name || '').replace('.NS','').replace('^','')}</span>
                                                <span className="hbm-price">{item.price != null ? item.price.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}</span>
                                                <span className="hbm-chg">{isPos ? '▲' : '▼'}{Math.abs(chg).toFixed(2)}%</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="hbm-gti" style={{ color: gtiCol }}>
                                GTI <span className="hbm-gti-score">{gtiScore}</span>
                                <span className="hbm-gti-lvl" style={{ borderColor: gtiCol, color: gtiCol }}>{gtiLvl}</span>
                            </div>
                        </div>

                        {/* ── Stats Row ── */}
                        <div className="hb-stats-row">
                            {[
                                { val: signals.length  || '—',             lbl: 'SIGNALS',      color: 'var(--accent)' },
                                { val: callOpps.length || '—',             lbl: 'CALL OPP',     color: 'var(--pos)'    },
                                { val: putOpps.length  || '—',             lbl: 'PUT OPP',      color: 'var(--neg)'    },
                                { val: volSurges       || '0',             lbl: 'VOL SURGES',   color: 'var(--high)'   },
                                { val: strongSigs      || '0',             lbl: 'STRONG SIG',   color: '#a78bfa'       },
                                { val: marketBreadth ? `${marketBreadth.advances}↑` : '—', lbl: 'ADVANCES', color: 'var(--pos)' },
                                { val: marketBreadth ? `${marketBreadth.declines}↓` : '—', lbl: 'DECLINES', color: 'var(--neg)' },
                                { val: marketBreadth?.adRatio ?? '—',     lbl: 'A/D RATIO',    color: marketBreadth?.adRatio > 1 ? 'var(--pos)' : 'var(--neg)' },
                                { val: gtiScore,                           lbl: 'GTI',          color: gtiCol          },
                                { val: news.length     || '—',            lbl: 'NEWS FEEDS',   color: 'var(--warn)'   },
                            ].map(s => (
                                <div key={s.lbl} className="hbs-stat">
                                    <div className="hbs-val" style={{ color: s.color }}>{s.val}</div>
                                    <div className="hbs-lbl">{s.lbl}</div>
                                </div>
                            ))}
                        </div>

                        {/* ── Dashboard Grid (3 columns) ── */}
                        <div className="hb-dash-grid">

                            {/* ── LEFT COLUMN: News ── */}
                            <div className="hbd-left">
                                {/* MARKET ALERTS */}
                                <div className="hbd-panel hbd-alerts-panel">
                                    <div className="hbd-panel-hdr hbd-hdr-alert">
                                        <span className="hbd-dot hbd-dot-alert" />
                                        MARKET ALERTS
                                        {alerts.length > 0 && <span className="hbd-badge hbd-badge-alert">{alerts.length}</span>}
                                        <span className="hbd-panel-sub">HIGH IMPACT · MULTI-SOURCE VERIFIED</span>
                                    </div>
                                    {alerts.length === 0
                                        ? <div className="hbd-empty">No high-impact alerts detected</div>
                                        : alerts.map((n, i) => (
                                            <a key={i} href={n.link} target="_blank" rel="noreferrer" className="hbd-news-row hbd-alert-row">
                                                <span className="hbdr-sent" style={{ color: sentColor(n.sentiment) }}>{sentLabel(n.sentiment)}</span>
                                                <span className="hbdr-title">
                                                    {n.confirmed && <span className="hbdr-chk">✓</span>}
                                                    {n.title}
                                                </span>
                                                <span className="hbdr-pub">{(n.publisher||'').slice(0,14)}</span>
                                                <span className="hbdr-time">{n.time}</span>
                                            </a>
                                        ))
                                    }
                                </div>

                                {/* LIVE NEWS FEED */}
                                <div className="hbd-panel hbd-news-panel">
                                    <div className="hbd-panel-hdr">
                                        <span className="hbd-dot hbd-dot-live" />
                                        LIVE MARKET INTELLIGENCE
                                        <span className="hbd-panel-sub">{news.length} STORIES · 6 SOURCES</span>
                                    </div>
                                    {feedNews.length === 0
                                        ? <div className="hbd-empty">Fetching market intelligence…</div>
                                        : feedNews.map((n, i) => (
                                            <a key={i} href={n.link} target="_blank" rel="noreferrer"
                                                className={`hbd-news-row${n.highImpact ? ' hbdr-hi' : ''}`}>
                                                <span className="hbdr-sent" style={{ color: sentColor(n.sentiment) }}>{sentLabel(n.sentiment)}</span>
                                                <span className="hbdr-title">{n.title}</span>
                                                <span className="hbdr-pub">{(n.publisher||'').slice(0,14)}</span>
                                                <span className="hbdr-time">{n.time}</span>
                                            </a>
                                        ))
                                    }
                                </div>
                            </div>{/* /hbd-left */}

                            {/* ── MIDDLE COLUMN: Breadth + Rates + Calendar ── */}
                            <div className="hbd-mid">

                                {/* SECTOR HEATMAP */}
                                <div className="hbd-panel hbd-sector-panel">
                                    <div className="hbd-panel-hdr">
                                        <span className="hbd-dot hbd-dot-live" />
                                        SECTOR PERFORMANCE
                                        <span className="hbd-panel-sub">NSE LIVE · {sectorEntries.length} SECTORS</span>
                                    </div>
                                    <div className="hbd-sector-grid">
                                        {sectorEntries.length === 0
                                            ? Array.from({length: 10}, (_,i) => (
                                                <div key={i} className="hbd-sector-cell loading-cell">
                                                    <span className="hbsc-name">{'—'}</span>
                                                    <span className="hbsc-chg">—</span>
                                                </div>
                                            ))
                                            : sectorEntries.map(([sector, data]) => {
                                                const chg = data.changePercent;
                                                const intensity = Math.min(1, Math.abs(chg) / 3);
                                                const bg = chg > 0
                                                    ? `rgba(16,185,129,${0.08 + intensity * 0.25})`
                                                    : chg < 0
                                                    ? `rgba(239,68,68,${0.08 + intensity * 0.25})`
                                                    : 'rgba(100,116,139,0.08)';
                                                return (
                                                    <div key={sector} className="hbd-sector-cell" style={{ background: bg, borderColor: chg > 0 ? 'rgba(16,185,129,0.3)' : chg < 0 ? 'rgba(239,68,68,0.3)' : 'rgba(100,116,139,0.15)' }}>
                                                        <span className="hbsc-name">{sector.toUpperCase()}</span>
                                                        <span className="hbsc-chg" style={{ color: chg > 0 ? 'var(--pos)' : chg < 0 ? 'var(--neg)' : 'var(--muted)' }}>
                                                            {chg > 0 ? '▲' : chg < 0 ? '▼' : '~'}{Math.abs(chg).toFixed(2)}%
                                                        </span>
                                                        <span className="hbsc-adv">{data.advances}↑ {data.declines}↓</span>
                                                    </div>
                                                );
                                            })
                                        }
                                    </div>
                                </div>

                                {/* MARKET BREADTH */}
                                {marketBreadth && (
                                    <div className="hbd-panel hbd-breadth-panel">
                                        <div className="hbd-panel-hdr">
                                            <span className="hbd-dot" style={{ background: marketBreadth.breadthSignal === 'BULLISH' ? 'var(--pos)' : marketBreadth.breadthSignal === 'BEARISH' ? 'var(--neg)' : 'var(--warn)', boxShadow: '0 0 5px currentColor' }} />
                                            MARKET BREADTH
                                            <span className="hbd-panel-sub" style={{ color: marketBreadth.breadthSignal === 'BULLISH' ? 'var(--pos)' : marketBreadth.breadthSignal === 'BEARISH' ? 'var(--neg)' : 'var(--warn)' }}>
                                                {marketBreadth.breadthSignal} · A/D {marketBreadth.adRatio}
                                            </span>
                                        </div>
                                        <div className="hbd-breadth-body">
                                            <div className="hbb-stats">
                                                <div className="hbb-stat-item"><span className="pos">▲ ADV</span><strong className="pos">{marketBreadth.advances}</strong></div>
                                                <div className="hbb-stat-item"><span className="neg">▼ DEC</span><strong className="neg">{marketBreadth.declines}</strong></div>
                                                <div className="hbb-stat-item"><span>~ UNC</span><strong>{marketBreadth.unchanged}</strong></div>
                                                <div className="hbb-stat-item"><span>A/D</span><strong style={{ color: marketBreadth.adRatio >= 1 ? 'var(--pos)' : 'var(--neg)' }}>{marketBreadth.adRatio}</strong></div>
                                            </div>
                                            <div className="hbb-bar-wrap">
                                                <div className="hbb-bar-adv" style={{ width: `${(marketBreadth.advances / marketBreadth.total) * 100}%` }} />
                                                <div className="hbb-bar-unc" style={{ width: `${(marketBreadth.unchanged / marketBreadth.total) * 100}%` }} />
                                                <div className="hbb-bar-dec" style={{ width: `${(marketBreadth.declines / marketBreadth.total) * 100}%` }} />
                                            </div>
                                            <div className="hbb-pct">
                                                <span className="pos">{marketBreadth.breadthPct}% Advancing</span>
                                                <span className="neg">{(100 - marketBreadth.breadthPct).toFixed(1)}% Declining</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* RATES BOARD */}
                                <div className="hbd-panel hbd-rates-panel">
                                    <div className="hbd-panel-hdr">
                                        <span className="hbd-dot hbd-dot-live" />
                                        RATES &amp; COMMODITIES
                                        <span className="hbd-panel-sub">LIVE · USD · FOREX</span>
                                    </div>
                                    <div className="hbd-rates-grid">
                                        {rates.length === 0
                                            ? <div className="hbd-empty">Fetching rates…</div>
                                            : rates.map((r,i) => {
                                                const clickable = r.symbol.endsWith('=F') || r.symbol.startsWith('^');
                                                return (
                                                    <div key={i} className="hbd-rate-row"
                                                        style={{ cursor: clickable ? 'pointer' : 'default' }}
                                                        onClick={clickable ? () => handleSelect(r.symbol) : undefined}>
                                                        <span className="hbrate-name">{r.name}</span>
                                                        <span className="hbrate-price">
                                                            {r.unit}{r.price != null ? r.price.toLocaleString('en-US', { maximumFractionDigits: r.symbol.includes('INR') ? 2 : r.symbol === '^TNX' ? 3 : 2 }) : '—'}
                                                        </span>
                                                        <span className={`hbrate-chg ${r.changePercent >= 0 ? 'pos' : 'neg'}`}>
                                                            {r.changePercent >= 0 ? '▲' : '▼'}{Math.abs(r.changePercent).toFixed(2)}%
                                                        </span>
                                                    </div>
                                                );
                                            })
                                        }
                                    </div>
                                </div>

                                {/* ECONOMIC CALENDAR */}
                                <div className="hbd-panel hbd-cal-panel">
                                    <div className="hbd-panel-hdr">
                                        <span className="hbd-dot" style={{ background: '#a78bfa', boxShadow: '0 0 5px #a78bfa' }} />
                                        ECONOMIC CALENDAR
                                        <span className="hbd-panel-sub">UPCOMING KEY EVENTS</span>
                                    </div>
                                    {calendar.map((ev, i) => (
                                        <div key={i} className="hbd-cal-row">
                                            <span className="hbcal-date">{ev.date}</span>
                                            <span className={`hbcal-type hbcal-type-${ev.type.toLowerCase()}`}>{ev.type}</span>
                                            <span className="hbcal-event">{ev.event}</span>
                                            <span className={`hbcal-impact ${ev.impact === 'HIGH' ? 'neg' : 'warn'}`}>{ev.impact}</span>
                                        </div>
                                    ))}
                                </div>

                            </div>{/* /hbd-mid */}

                            {/* ── RIGHT COLUMN: GTI + F&O + Signals ── */}
                            <div className="hbd-right">

                                {/* GTI PANEL */}
                                <div className="hbd-panel hbd-gti-panel">
                                    <div className="hbd-panel-hdr">
                                        <span className="hbd-dot" style={{ background: gtiCol, boxShadow: `0 0 6px ${gtiCol}` }} />
                                        GLOBAL TENSION INDEX
                                        <span className="hbd-gti-score" style={{ color: gtiCol }}>{gtiScore}</span>
                                        <span className="hbd-badge" style={{ borderColor: gtiCol, color: gtiCol, background: 'transparent' }}>{gtiLvl}</span>
                                    </div>
                                    <div className="hbd-gti-body">
                                        <div className="hbg-bar-track">
                                            <div className="hbg-bar-fill" style={{ width: `${gtiScore}%`, background: gtiCol }} />
                                        </div>
                                        <div className="hbg-zones">
                                            <span style={{ color: 'var(--low)' }}>LOW 0-35</span>
                                            <span style={{ color: 'var(--med)' }}>MED 35-60</span>
                                            <span style={{ color: 'var(--high)' }}>HIGH 60-80</span>
                                            <span style={{ color: 'var(--crit)' }}>CRIT 80+</span>
                                        </div>
                                        <div className="hbg-spark">
                                            {gtiHistory.map((v, i) => (
                                                <div key={i} className="hbg-spark-bar" style={{ height: `${(v/100)*100}%`, background: gtiColor(v) }} />
                                            ))}
                                        </div>
                                        {(gti.events||[]).slice(0,3).map((e,i) => (
                                            <div key={i} className={`hbg-event lvl-${(e.level||'low').toLowerCase()}`}>
                                                <span className={`hbg-dot lvl-${(e.level||'low').toLowerCase()}`} />
                                                <span className="hbg-evt-title">{e.title}</span>
                                                <span className="hbg-evt-meta">{e.region}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* F&O OPPORTUNITIES */}
                                <div className="hbd-panel hbd-fo-panel">
                                    <div className="hbd-panel-hdr hbd-hdr-fo">
                                        <span className="hbd-dot hbd-dot-fo" />
                                        F&amp;O OPPORTUNITIES
                                        <span className="hbd-fo-callcount">▲ CALL {callOpps.length}</span>
                                        <span className="hbd-fo-putcount">▼ PUT {putOpps.length}</span>
                                    </div>
                                    <div className="hbd-fo-colhdr">
                                        <span>TYPE</span><span>SYM</span><span>~STRIKE</span><span>RSI</span><span>CONF</span><span>R/R</span><span>SIG</span>
                                    </div>
                                    {foOpps.length === 0
                                        ? <div className="hbd-empty">Loading F&amp;O signals…</div>
                                        : foOpps.map((s, i) => (
                                            <div key={i} className={`hbd-fo-row ${s.type === 'CALL' ? 'fo-call-row' : 'fo-put-row'}`}
                                                onClick={() => handleSelect((s.ticker||'') + '.NS')}>
                                                <span className={`hbfo-type ${s.type === 'CALL' ? 'fo-call' : 'fo-put'}`}>{s.type}</span>
                                                <span className="hbfo-sym">{s.ticker}</span>
                                                <span className="hbfo-strike">₹{approxStrike(s.price)?.toLocaleString('en-IN')}</span>
                                                <span className="hbfo-rsi" style={{ color: s.rsi < 35 ? 'var(--pos)' : s.rsi > 65 ? 'var(--neg)' : 'var(--muted)' }}>
                                                    {s.rsi ?? '—'}
                                                </span>
                                                <span className="hbfo-conf" style={{ color: s.confidence >= 80 ? '#34d399' : s.confidence >= 65 ? 'var(--warn)' : 'var(--muted)' }}>
                                                    {s.confidence}%
                                                </span>
                                                <span className="hbfo-rr">{s.rr}x</span>
                                                <span className="hbfo-action" style={{ color: actionColor(s.action || s.direction) }}>{s.action || s.direction}</span>
                                            </div>
                                        ))
                                    }
                                </div>

                                {/* AI SIGNALS TABLE */}
                                <div className="hbd-panel hbd-sig-panel">
                                    <div className="hbd-panel-hdr">
                                        <span className="hbd-dot hbd-dot-live" />
                                        AI SIGNAL FEED
                                        <span className="hbd-panel-sub">{signals.length} STOCKS · {volSurges} SURGE · {strongSigs} STRONG</span>
                                    </div>
                                    <div className="hbd-sig-colhdr">
                                        <span>SYMBOL</span><span>SECTOR</span><span>ACTION</span><span>PRICE</span><span>RSI</span><span>CONF</span><span>R/R</span>
                                    </div>
                                    {topSigs.length === 0
                                        ? <div className="hbd-empty">Loading signals…</div>
                                        : topSigs.map((s, i) => (
                                            <div key={i} className={`hbd-sig-row${s.volSurge ? ' sig-surge' : ''}`}
                                                onClick={() => handleSelect((s.ticker||'') + '.NS')}>
                                                <span className="hbsr-sym">{(s.ticker||'').replace('.NS','')}</span>
                                                <span className="hbsr-cls">{s.cls}</span>
                                                <span className="hbsr-action" style={{ color: actionColor(s.action || s.direction) }}>{s.action || s.direction}</span>
                                                <span className="hbsr-price">₹{s.price ? Number(s.price).toLocaleString('en-IN',{maximumFractionDigits:0}) : '—'}</span>
                                                <span className="hbsr-rsi" style={{ color: s.rsi < 35 ? 'var(--pos)' : s.rsi > 65 ? 'var(--neg)' : 'var(--muted)' }}>
                                                    {s.rsi ?? '—'}
                                                </span>
                                                <span className="hbsr-conf" style={{ color: s.confidence >= 80 ? '#34d399' : s.confidence >= 65 ? 'var(--warn)' : 'var(--muted)' }}>
                                                    {s.confidence ? `${s.confidence}%` : '—'}
                                                </span>
                                                <span className="hbsr-rr">{s.rr ? `${s.rr}x` : '—'}</span>
                                            </div>
                                        ))
                                    }
                                </div>

                                {/* NAVIGATION */}
                                <div className="hbd-panel hbd-nav-panel">
                                    <div className="hbd-panel-hdr">
                                        <span className="hbd-dot hbd-dot-live" />
                                        TERMINAL MODULES
                                    </div>
                                    {[
                                        { icon: '⊕', key: 'F2', title: 'EARTH PULSE', sub: 'Globe · Country Risk · Geo Events',       view: 'geopulse', color: 'var(--accent)' },
                                        { icon: '⊞', key: 'F3', title: 'TERMINAL',    sub: 'Charts · Technicals · Options Chain',     view: 'terminal',  color: 'var(--pos)'    },
                                        { icon: '⊿', key: 'F4', title: 'AI SIGNALS',  sub: `NIFTY 50 · MACD+RSI · ${signals.length} active`, view: 'signals', color: 'var(--warn)' },
                                    ].map(c => (
                                        <div key={c.view} className="hbd-nav-btn" onClick={() => setActiveView(c.view)}>
                                            <span className="hbn-key" style={{ color: c.color, borderColor: c.color }}>{c.key}</span>
                                            <span className="hbn-icon" style={{ color: c.color }}>{c.icon}</span>
                                            <div className="hbn-text">
                                                <span className="hbn-title" style={{ color: c.color }}>{c.title}</span>
                                                <span className="hbn-sub">{c.sub}</span>
                                            </div>
                                            <span className="hbn-arrow">›</span>
                                        </div>
                                    ))}
                                </div>

                            </div>{/* /hbd-right */}
                        </div>{/* /hb-dash-grid */}
                    </div>
                    );
                })()}

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
                                            {d.volSpike && (
                                                <div className="vol-spike-alert">
                                                    ⚡ VOL SPIKE {d.volSpikeRatio}x avg · {d.volume ? (d.volume/1e6).toFixed(1)+'M' : ''}
                                                </div>
                                            )}
                                            <div className="th-meta">
                                                {[
                                                    ['Open', d.openPrice ? fmtCur(d.openPrice, cur) : 'N/A'],
                                                    ['High', d.dayHigh ? fmtCur(d.dayHigh, cur) : 'N/A'],
                                                    ['Low', d.dayLow ? fmtCur(d.dayLow, cur) : 'N/A'],
                                                    ['Prev Close', d.prevClose ? fmtCur(d.prevClose, cur) : 'N/A'],
                                                    ['52W High', d.fiftyTwoWeekHigh ? fmtCur(d.fiftyTwoWeekHigh, cur) : 'N/A'],
                                                    ['52W Low', d.fiftyTwoWeekLow ? fmtCur(d.fiftyTwoWeekLow, cur) : 'N/A'],
                                                    ['Prev Day H', t?.prevDayH ? fmtCur(t.prevDayH, cur) : 'N/A'],
                                                    ['Prev Day L', t?.prevDayL ? fmtCur(t.prevDayL, cur) : 'N/A'],
                                                    ['VWAP', t?.vwap ? fmtCur(t.vwap, cur) : 'N/A'],
                                                    ['Volume', d.volume ? (
                                                        <span style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
                                                            {(d.volume / 1e6).toFixed(2) + 'M'}
                                                            {d.volSpike && <span className="ha-badge" style={{padding: '2px 5px', fontSize: '8px', animation: 'pulse 1.5s infinite'}}>SPIKE {d.volSpikeRatio}x</span>}
                                                        </span>
                                                    ) : 'N/A'],
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

                                    {/* ── SPLIT: Chart (left) + Options/Futures (right) ── */}
                                    <div className="term-body-split">

                                        {/* LEFT — Chart */}
                                        <div className="tbs-left">
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
                                        </div>

                                        {/* RIGHT — Options Chain + Futures */}
                                        <div className="tbs-right">

                                            {/* Mini Options Chain */}
                                            <div className="tsr-panel">
                                                <div className="tsr-hdr">
                                                    <span className="tsr-dot" />⛓ OPTIONS CHAIN
                                                    {options?.expiry && <span className="tsr-sub">{options.expiry} · PCR <strong style={{ color: options.pcr > 1.2 ? 'var(--pos)' : options.pcr < 0.8 ? 'var(--neg)' : 'var(--warn)' }}>{options.pcr}</strong></span>}
                                                    {options?.source === 'THEORETICAL' && <span className="tsr-badge src-theoretical">⚗ BS</span>}
                                                </div>
                                                {options?.expiry ? (() => {
                                                    const strikes = [...new Set([...(options.calls||[]).map(c=>c.strike), ...(options.puts||[]).map(p=>p.strike)])].sort((a,b)=>a-b);
                                                    const atmI = strikes.reduce((b,s,i) => Math.abs(s-d.price) < Math.abs(strikes[b]-d.price) ? i : b, 0);
                                                    const mini = strikes.slice(Math.max(0,atmI-4), Math.min(strikes.length, atmI+5));
                                                    const cm = Object.fromEntries((options.calls||[]).map(c=>[c.strike,c]));
                                                    const pm = Object.fromEntries((options.puts||[]).map(p=>[p.strike,p]));
                                                    return (
                                                        <>
                                                            <div className="tsr-opt-stats">
                                                                <div><span>MAX PAIN</span><strong className="warn">{fmtCur(options.maxPain, cur)}</strong></div>
                                                                <div><span>CALL OI</span><strong className="neg">{((options.totalCallOI||0)/1000).toFixed(0)}K</strong></div>
                                                                <div><span>PUT OI</span><strong className="pos">{((options.totalPutOI||0)/1000).toFixed(0)}K</strong></div>
                                                            </div>
                                                            <div className="tsr-chain-hdr">
                                                                <span>LTP</span><span>IV%</span><span>OI(K)</span>
                                                                <span className="tsr-strike-col">STRIKE</span>
                                                                <span>OI(K)</span><span>IV%</span><span>LTP</span>
                                                            </div>
                                                            {mini.map(strike => {
                                                                const c=cm[strike], p=pm[strike];
                                                                const isAtm = Math.abs(strike-d.price)/d.price < 0.015;
                                                                const isMp = strike === options.maxPain;
                                                                return (
                                                                    <div key={strike} className={`tsr-chain-row${isAtm?' atm':''}${isMp?' mp':''}`}>
                                                                        <span className="tsr-call">{c ? c.lastPrice.toFixed(1) : '—'}</span>
                                                                        <span className="tsr-call">{c ? (c.iv??'—')+'%' : '—'}</span>
                                                                        <span className="tsr-call">{c ? (c.oi/1000).toFixed(0) : '—'}</span>
                                                                        <span className={`tsr-strike${isAtm?' atm-s':''}`}>
                                                                            {strike.toLocaleString('en-IN')}
                                                                            {isAtm && <span className="badge atm-b">A</span>}
                                                                            {isMp  && <span className="badge mp-b">P</span>}
                                                                        </span>
                                                                        <span className="tsr-put">{p ? (p.oi/1000).toFixed(0) : '—'}</span>
                                                                        <span className="tsr-put">{p ? (p.iv??'—')+'%' : '—'}</span>
                                                                        <span className="tsr-put">{p ? p.lastPrice.toFixed(1) : '—'}</span>
                                                                    </div>
                                                                );
                                                            })}
                                                            <div className="tsr-full-btn" onClick={() => setActiveTab('options')}>
                                                                View full chain ›
                                                            </div>
                                                        </>
                                                    );
                                                })() : <div className="geo-empty" style={{fontSize:'11px'}}>No options data for this symbol</div>}
                                            </div>

                                            {/* Related Futures / Global Context */}
                                            <div className="tsr-panel">
                                                <div className="tsr-hdr">
                                                    <span className="tsr-dot" />⬡ FUTURES &amp; GLOBAL
                                                </div>
                                                {futures.filter(f => !['USDINR=X'].includes(f.symbol)).slice(0, 8).map((f, i) => {
                                                    const chg = f.changePercent ?? 0;
                                                    return (
                                                        <div key={i} className="tsr-fut-row"
                                                            onClick={() => handleSelect(f.symbol)}
                                                            style={{ cursor: 'pointer' }}>
                                                            <span className="tsr-fut-name">{(f.name||f.symbol).replace('Futures','').replace('S&P 500','SPX').replace('DOW JONES','DOW').replace('NASDAQ','NDX').trim()}</span>
                                                            <span className="tsr-fut-price">{f.price?.toLocaleString('en-US',{maximumFractionDigits:2})}</span>
                                                            <span className={`tsr-fut-chg ${chg>=0?'pos':'neg'}`}>{chg>=0?'▲':'▼'}{Math.abs(chg).toFixed(2)}%</span>
                                                        </div>
                                                    );
                                                })}
                                                {rates.filter(r => ['GC=F','CL=F','SI=F','NG=F'].includes(r.symbol)).map((r,i) => {
                                                    const chg = r.changePercent ?? 0;
                                                    return (
                                                        <div key={'r'+i} className="tsr-fut-row"
                                                            onClick={() => handleSelect(r.symbol)}
                                                            style={{ cursor: 'pointer' }}>
                                                            <span className="tsr-fut-name">{r.name}</span>
                                                            <span className="tsr-fut-price">{r.unit}{r.price?.toLocaleString('en-US',{maximumFractionDigits:2})}</span>
                                                            <span className={`tsr-fut-chg ${chg>=0?'pos':'neg'}`}>{chg>=0?'▲':'▼'}{Math.abs(chg).toFixed(2)}%</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                        </div>{/* /tbs-right */}
                                    </div>{/* /term-body-split */}

                                    {/* Tabs */}
                                    <div className="term-tabs">
                                        {['technical', 'financials', 'options', 'movers'].map(tb => (
                                            <button key={tb} className={activeTab === tb ? 'active' : ''} onClick={() => setActiveTab(tb)}>
                                                {tb === 'movers' ? '⚡ MOVERS' : tb === 'options' ? '⛓ OPTIONS FULL' : tb.toUpperCase()}
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
                                                            {t.vwap && (
                                                                <div>
                                                                    <span>VWAP</span>
                                                                    <strong>{fmtCur(t.vwap, cur)}</strong>
                                                                    <span className={d.price > t.vwap ? 'pos' : 'neg'}>{d.price > t.vwap ? '↑ Above' : '↓ Below'}</span>
                                                                </div>
                                                            )}
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

                                        {/* (news moved below) */}

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
                                    </div>{/* /term-tab-body */}

                                    {/* ── STOCK NEWS with Sentiment Filter ── */}
                                    <div className="term-news-section">
                                        <div className="tns-hdr">
                                            <span className="tns-title">STOCK &amp; SECTOR NEWS</span>
                                            <span className="tns-count">{d.news?.length || 0} articles</span>
                                            <div className="tns-filters">
                                                {['All', 'bullish', 'bearish', 'neutral'].map(f => (
                                                    <button key={f}
                                                        className={`tns-filter-btn${newsFilter === f ? ' active' : ''}`}
                                                        style={newsFilter === f && f !== 'All' ? { borderColor: sentColor(f), color: sentColor(f), background: sentColor(f) + '18' } : {}}
                                                        onClick={() => setNewsFilter(f)}>
                                                        {f === 'All' ? 'ALL' : sentLabel(f)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="tns-grid">
                                            {(() => {
                                                const filtered = (d.news || []).filter(n => newsFilter === 'All' || n.sentiment === newsFilter);
                                                return filtered.length ? filtered.map((n, i) => (
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
                                                )) : <div className="geo-empty">No {newsFilter !== 'All' ? newsFilter : ''} news available</div>;
                                            })()}
                                        </div>
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

                {/* ════ HFT MODEL VIEW ════ */}
                {activeView === 'hftmodel' && !hftLoggedIn && (
                    <div className="hft-login-wrap">
                        <div className="hft-login-box">
                            <div className="hft-login-icon">◈</div>
                            <div className="hft-login-title">HFT MODEL <span className="hft-private-badge">PRIVATE</span></div>
                            <div className="hft-login-sub">Restricted access · Authorized personnel only</div>
                            <form className="hft-login-form" onSubmit={e => {
                                e.preventDefault();
                                const emailOk = hftLoginForm.email.trim().toLowerCase().replace(/\s/g,'') === '01nami01@gmail.com';
                                const passOk  = hftLoginForm.password.trim().replace(/\s/g,'') === 'HFT@2026';
                                if (emailOk && passOk) {
                                    localStorage.setItem('hft_auth', 'true');
                                    setHftLoggedIn(true);
                                    setHftLoginErr('');
                                } else {
                                    setHftLoginErr('Invalid credentials. Access denied.');
                                }
                            }}>
                                <div className="hft-lf-field">
                                    <label>EMAIL</label>
                                    <input type="text" value={hftLoginForm.email} onChange={e => setHftLoginForm(f => ({...f, email: e.target.value}))} placeholder="your@email.com" autoComplete="username" />
                                </div>
                                <div className="hft-lf-field">
                                    <label>PASSWORD</label>
                                    <input type="password" value={hftLoginForm.password} onChange={e => setHftLoginForm(f => ({...f, password: e.target.value}))} placeholder="••••••••" autoComplete="current-password" />
                                </div>
                                {hftLoginErr && <div className="hft-login-err">{hftLoginErr}</div>}
                                <button type="submit" className="hft-login-btn">AUTHENTICATE</button>
                            </form>
                        </div>
                    </div>
                )}
                {activeView === 'hftmodel' && hftLoggedIn && (() => {
                    const closedTrades = trades.filter(t => t.exit && t.exit !== '');
                    const pnlList = closedTrades.map(t => {
                        const mult = t.direction === 'LONG' ? 1 : -1;
                        return mult * (parseFloat(t.exit) - parseFloat(t.entry)) * (parseFloat(t.qty) || 1);
                    });
                    const totalPnl = pnlList.reduce((a, b) => a + b, 0);
                    const wins = pnlList.filter(p => p > 0).length;
                    const losses = pnlList.filter(p => p < 0).length;
                    const winRate = closedTrades.length > 0 ? ((wins / closedTrades.length) * 100).toFixed(1) : '—';
                    const avgWin = wins > 0 ? (pnlList.filter(p => p > 0).reduce((a,b)=>a+b,0) / wins).toFixed(2) : '—';
                    const avgLoss = losses > 0 ? Math.abs(pnlList.filter(p => p < 0).reduce((a,b)=>a+b,0) / losses).toFixed(2) : '—';
                    const rr = avgWin !== '—' && avgLoss !== '—' ? (avgWin / avgLoss).toFixed(2) : '—';
                    const maxDD = pnlList.length > 0 ? Math.abs(Math.min(...pnlList)).toFixed(2) : '—';
                    const profitFactor = losses > 0 && wins > 0
                        ? (pnlList.filter(p=>p>0).reduce((a,b)=>a+b,0) / Math.abs(pnlList.filter(p=>p<0).reduce((a,b)=>a+b,0))).toFixed(2)
                        : '—';

                    const timePatterns = {};
                    closedTrades.forEach((t, i) => {
                        if (!t.time) return;
                        const hour = t.time.slice(0, 2) + ':00';
                        if (!timePatterns[hour]) timePatterns[hour] = { wins: 0, losses: 0, pnl: 0 };
                        if (pnlList[i] > 0) timePatterns[hour].wins++;
                        else timePatterns[hour].losses++;
                        timePatterns[hour].pnl += pnlList[i];
                    });

                    const addTrade = () => {
                        if (!tradeForm.symbol || !tradeForm.entry) return;
                        const newTrade = { ...tradeForm, id: Date.now(), date: new Date().toISOString().split('T')[0] };
                        const updated = [newTrade, ...trades];
                        setTrades(updated);
                        localStorage.setItem('hft_trades', JSON.stringify(updated));
                        setTradeForm({ symbol: '', direction: 'LONG', entry: '', exit: '', qty: '', time: '', notes: '' });
                    };

                    const deleteTrade = (id) => {
                        const updated = trades.filter(t => t.id !== id);
                        setTrades(updated);
                        localStorage.setItem('hft_trades', JSON.stringify(updated));
                    };

                    return (
                        <div className="hftmodel-view">
                            {/* Header */}
                            <div className="hft-header">
                                <div className="hft-title">
                                    <span className="hft-icon">◈</span>
                                    <div>
                                        <div className="hft-title-main">HFT MODEL <span className="hft-private-badge">PRIVATE</span></div>
                                        <div className="hft-title-sub">Intraday High-Frequency Trading Analytics · Your Personal Edge</div>
                                    </div>
                                </div>
                                <div className="hft-live-signal">
                                    <form onSubmit={e => { e.preventDefault(); fetchHFT(hftTicker); }}>
                                        <span className="hft-sym-label">ANALYZE›</span>
                                        <input value={hftTicker} onChange={e => setHftTicker(e.target.value.toUpperCase())} className="hft-sym-input" placeholder="RELIANCE.NS" />
                                        <button type="submit" className="hft-sym-btn">SCAN</button>
                                    </form>
                                </div>
                                <div className="hft-tabs">
                                    {[['dashboard','⊞ DASHBOARD'],['signals','⊿ SIGNALS'],['fo','⚡ F&O MODEL'],['journal','✎ JOURNAL'],['patterns','◉ PATTERNS']].map(([tab,label]) => (
                                        <button key={tab} className={`hft-tab-btn${hftTab === tab ? ' active' : ''}${tab === 'fo' ? ' hft-fo-tab' : ''}`} onClick={() => { setHftTab(tab); if (tab === 'signals') fetchHFT(hftTicker); if (tab === 'fo') fetchFO(); }}>{label}</button>
                                    ))}
                                    <button className="hft-logout-btn" onClick={() => { localStorage.removeItem('hft_auth'); setHftLoggedIn(false); }}>⏻ LOGOUT</button>
                                </div>
                            </div>

                            {/* DASHBOARD TAB */}
                            {hftTab === 'dashboard' && (
                                <div className="hft-dashboard">
                                    <div className="hft-kpi-row">
                                        {[
                                            { val: closedTrades.length, lbl: 'TOTAL TRADES', color: 'var(--accent)' },
                                            { val: `${winRate}%`, lbl: 'WIN RATE', color: parseFloat(winRate) >= 55 ? 'var(--pos)' : parseFloat(winRate) >= 45 ? 'var(--warn)' : 'var(--neg)' },
                                            { val: `₹${totalPnl.toFixed(0)}`, lbl: 'TOTAL P&L', color: totalPnl >= 0 ? 'var(--pos)' : 'var(--neg)' },
                                            { val: rr !== '—' ? `${rr}:1` : '—', lbl: 'RISK:REWARD', color: parseFloat(rr) >= 1.5 ? 'var(--pos)' : 'var(--warn)' },
                                            { val: profitFactor !== '—' ? profitFactor : '—', lbl: 'PROFIT FACTOR', color: parseFloat(profitFactor) >= 1.5 ? 'var(--pos)' : 'var(--neg)' },
                                            { val: `₹${avgWin}`, lbl: 'AVG WIN', color: 'var(--pos)' },
                                            { val: `₹${avgLoss}`, lbl: 'AVG LOSS', color: 'var(--neg)' },
                                            { val: `₹${maxDD}`, lbl: 'MAX LOSS', color: 'var(--neg)' },
                                        ].map(k => (
                                            <div key={k.lbl} className="hft-kpi">
                                                <div className="hft-kpi-val" style={{ color: k.color }}>{k.val || '—'}</div>
                                                <div className="hft-kpi-lbl">{k.lbl}</div>
                                            </div>
                                        ))}
                                    </div>

                                    {pnlList.length > 1 && (() => {
                                        let cum = 0;
                                        const curve = pnlList.map(p => { cum += p; return +cum.toFixed(2); });
                                        const W = 600, H = 80;
                                        const mn = Math.min(0, ...curve) - 10, mx = Math.max(...curve) + 10;
                                        const pts = curve.map((v, i) => `${(i / (curve.length-1)) * W},${H - ((v-mn)/(mx-mn)) * H}`).join(' ');
                                        const isPos = curve[curve.length-1] >= 0;
                                        return (
                                            <div className="hft-curve-card">
                                                <div className="hft-curve-label">EQUITY CURVE · {pnlList.length} TRADES</div>
                                                <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="hft-curve-svg">
                                                    <defs>
                                                        <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor={isPos ? '#10b981' : '#ef4444'} stopOpacity="0.3" />
                                                            <stop offset="100%" stopColor={isPos ? '#10b981' : '#ef4444'} stopOpacity="0" />
                                                        </linearGradient>
                                                    </defs>
                                                    <polyline points={pts} fill="none" stroke={isPos ? '#10b981' : '#ef4444'} strokeWidth="2" />
                                                    <line x1="0" y1={H - ((0-mn)/(mx-mn))*H} x2={W} y2={H - ((0-mn)/(mx-mn))*H} stroke="rgba(255,255,255,0.1)" strokeDasharray="4,4" />
                                                </svg>
                                            </div>
                                        );
                                    })()}

                                    <div className="hft-recent">
                                        <div className="hft-section-hdr">RECENT TRADES</div>
                                        {closedTrades.length === 0
                                            ? <div className="geo-empty">No closed trades yet. Add trades in the Journal tab.</div>
                                            : closedTrades.slice(0, 10).map((t, i) => (
                                                <div key={t.id} className={`hft-trade-row ${pnlList[i] >= 0 ? 'tr-win' : 'tr-loss'}`}>
                                                    <span className="htr-date">{t.date}</span>
                                                    <span className="htr-sym">{t.symbol}</span>
                                                    <span className={`htr-dir ${t.direction === 'LONG' ? 'pos' : 'neg'}`}>{t.direction}</span>
                                                    <span className="htr-entry">E: ₹{t.entry}</span>
                                                    <span className="htr-exit">X: ₹{t.exit || '—'}</span>
                                                    <span className="htr-qty">Q: {t.qty || 1}</span>
                                                    <span className={`htr-pnl ${pnlList[i] >= 0 ? 'pos' : 'neg'}`}>
                                                        {pnlList[i] >= 0 ? '+' : ''}₹{pnlList[i]?.toFixed(2)}
                                                    </span>
                                                </div>
                                            ))
                                        }
                                    </div>
                                </div>
                            )}

                            {/* SIGNALS TAB */}
                            {hftTab === 'signals' && (
                                <div className="hft-signals-view">
                                    {hftLoading ? <div className="geo-loading">⟳ Scanning {hftTicker}…</div>
                                    : hftData && !hftData.error ? (
                                        <>
                                            <div className="hft-sig-hero">
                                                <div className="hft-sig-badge" style={{ borderColor: actionColor(hftData.signal), color: actionColor(hftData.signal), background: actionColor(hftData.signal) + '18' }}>
                                                    {hftData.signal}
                                                </div>
                                                <div className="hft-sig-meta">
                                                    <span>{hftData.sym}</span>
                                                    <span className="hft-regime" style={{ color: hftData.regimes === 'HIGH_VOL' ? 'var(--neg)' : hftData.regimes === 'LOW_VOL' ? 'var(--pos)' : 'var(--warn)' }}>
                                                        {hftData.regimes} REGIME
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="hft-sig-grid">
                                                {/* VWAP Bands */}
                                                <div className="hft-sig-panel">
                                                    <div className="hft-sp-hdr">VWAP ANALYSIS</div>
                                                    {[
                                                        ['VWAP +2σ', hftData.vwapUpper2, 'neg'],
                                                        ['VWAP +1σ', hftData.vwapUpper1, 'neg'],
                                                        ['VWAP', hftData.vwap, ''],
                                                        ['Price', hftData.price, hftData.price >= hftData.vwap ? 'pos' : 'neg'],
                                                        ['VWAP -1σ', hftData.vwapLower1, 'pos'],
                                                        ['VWAP -2σ', hftData.vwapLower2, 'pos'],
                                                    ].map(([l, v, c]) => v != null && (
                                                        <div key={l} className={`hft-sp-row${l === 'Price' ? ' hft-price-row' : ''}`}>
                                                            <span>{l}</span>
                                                            <strong className={c}>₹{v?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
                                                        </div>
                                                    ))}
                                                    <div className="hft-sp-signal">
                                                        {hftData.vwap && hftData.price > hftData.vwap
                                                            ? <span className="pos">▲ Price ABOVE VWAP — Bullish Bias</span>
                                                            : <span className="neg">▼ Price BELOW VWAP — Bearish Bias</span>}
                                                    </div>
                                                </div>

                                                {/* CVD */}
                                                <div className="hft-sig-panel">
                                                    <div className="hft-sp-hdr">CUMULATIVE VOL DELTA</div>
                                                    <div className="hft-cvd-val" style={{ color: hftData.cvdTrend === 'BUYING' ? 'var(--pos)' : 'var(--neg)' }}>
                                                        {hftData.cvdTrend === 'BUYING' ? '▲' : '▼'} {hftData.cvdTrend}
                                                    </div>
                                                    <div className="hft-sp-row"><span>CVD Value</span><strong style={{ color: hftData.cvdCurrent > 0 ? 'var(--pos)' : 'var(--neg)' }}>{hftData.cvdCurrent?.toLocaleString()}</strong></div>
                                                    <div className="hft-sp-desc">
                                                        {hftData.cvdTrend === 'BUYING'
                                                            ? 'Net buy pressure. Institutions accumulating.'
                                                            : 'Net sell pressure. Institutions distributing.'}
                                                    </div>
                                                    {hftData.cvdArr?.length > 1 && (() => {
                                                        const arr = hftData.cvdArr;
                                                        const mn = Math.min(...arr), mx = Math.max(...arr);
                                                        const W2 = 200, H2 = 40;
                                                        const pts = arr.map((v, i) => `${(i/(arr.length-1))*W2},${H2 - ((v-mn)/(mx-mn||1))*H2}`).join(' ');
                                                        const isPos2 = arr[arr.length-1] > arr[0];
                                                        return (
                                                            <svg width="100%" height={H2} viewBox={`0 0 ${W2} ${H2}`} preserveAspectRatio="none">
                                                                <polyline points={pts} fill="none" stroke={isPos2 ? '#10b981' : '#ef4444'} strokeWidth="1.5" />
                                                            </svg>
                                                        );
                                                    })()}
                                                </div>

                                                {/* StochRSI */}
                                                <div className="hft-sig-panel">
                                                    <div className="hft-sp-hdr">STOCHASTIC RSI</div>
                                                    {hftData.stochRsi ? (
                                                        <>
                                                            <div className="hft-sp-row">
                                                                <span>%K (Fast)</span>
                                                                <strong style={{ color: hftData.stochRsi.k < 20 ? 'var(--pos)' : hftData.stochRsi.k > 80 ? 'var(--neg)' : 'var(--warn)' }}>
                                                                    {hftData.stochRsi.k}
                                                                </strong>
                                                            </div>
                                                            <div className="hft-sp-row">
                                                                <span>%D (Signal)</span>
                                                                <strong>{hftData.stochRsi.d}</strong>
                                                            </div>
                                                            <div className="hft-sp-signal">
                                                                {hftData.stochRsi.k < 20 ? <span className="pos">OVERSOLD — Potential long entry</span>
                                                                : hftData.stochRsi.k > 80 ? <span className="neg">OVERBOUGHT — Potential short</span>
                                                                : <span className="warn">NEUTRAL ZONE</span>}
                                                            </div>
                                                        </>
                                                    ) : <div className="geo-empty" style={{fontSize:'11px'}}>Insufficient data</div>}
                                                </div>

                                                {/* Z-Score + ATR */}
                                                <div className="hft-sig-panel">
                                                    <div className="hft-sp-hdr">MEAN REVERSION + ATR</div>
                                                    <div className="hft-sp-row"><span>Z-Score (20)</span>
                                                        <strong style={{ color: Math.abs(hftData.zScore) > 2 ? (hftData.zScore < 0 ? 'var(--pos)' : 'var(--neg)') : 'var(--warn)' }}>
                                                            {hftData.zScore}σ
                                                        </strong>
                                                    </div>
                                                    <div className="hft-sp-row"><span>ATR (14)</span><strong>{hftData.atr}</strong></div>
                                                    <div className="hft-sp-row"><span>ATR %</span><strong style={{ color: hftData.atrPct > 2 ? 'var(--neg)' : 'var(--pos)' }}>{hftData.atrPct}%</strong></div>
                                                    <div className="hft-sp-row"><span>Point of Control</span><strong className="warn">₹{hftData.pointOfControl?.toLocaleString('en-IN')}</strong></div>
                                                    <div className="hft-sp-signal">
                                                        {hftData.zScore < -2 ? <span className="pos">OVERSOLD — Z {hftData.zScore}σ below mean</span>
                                                        : hftData.zScore > 2 ? <span className="neg">OVERBOUGHT — Z {hftData.zScore}σ above mean</span>
                                                        : <span className="warn">FAIR VALUE ZONE</span>}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="hft-setup-card">
                                                <div className="hft-setup-hdr">◈ SUGGESTED TRADE SETUP</div>
                                                <div className="hft-setup-body">
                                                    <div className="hft-setup-sig" style={{ color: actionColor(hftData.signal) }}>{hftData.signal}</div>
                                                    {hftData.vwap && (
                                                        <div className="hft-setup-levels">
                                                            <div><span>ENTRY ZONE</span><strong>{hftData.signal?.includes('BUY') ? `₹${hftData.vwapLower1?.toLocaleString('en-IN') || hftData.vwap?.toLocaleString('en-IN')}` : `₹${hftData.vwapUpper1?.toLocaleString('en-IN') || hftData.vwap?.toLocaleString('en-IN')}`}</strong></div>
                                                            <div><span>TARGET 1</span><strong className="pos">{hftData.signal?.includes('BUY') ? `₹${hftData.vwap?.toLocaleString('en-IN')}` : `₹${hftData.vwapLower1?.toLocaleString('en-IN')}`}</strong></div>
                                                            <div><span>TARGET 2</span><strong className="pos">{hftData.signal?.includes('BUY') ? `₹${hftData.vwapUpper1?.toLocaleString('en-IN')}` : `₹${hftData.vwapLower2?.toLocaleString('en-IN')}`}</strong></div>
                                                            <div><span>STOP LOSS</span><strong className="neg">{hftData.atr ? `ATR-based: ±${hftData.atr}` : 'Use ATR stop'}</strong></div>
                                                            <div><span>ATR STOP</span><strong className="neg">₹{hftData.atr && hftData.price ? (hftData.signal?.includes('BUY') ? hftData.price - hftData.atr : hftData.price + hftData.atr)?.toLocaleString('en-IN', {maximumFractionDigits:2}) : '—'}</strong></div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="hft-sig-empty">
                                            <div className="hft-sig-empty-icon">⊿</div>
                                            <div>Enter a symbol above and click SCAN to run HFT signal analysis</div>
                                            <div className="hft-sig-empty-sub">Uses StochRSI · VWAP Bands · CVD · Z-Score · ATR · Volume Profile</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* JOURNAL TAB */}
                            {hftTab === 'journal' && (
                                <div className="hft-journal">
                                    <div className="hft-add-form">
                                        <div className="hft-form-hdr">✎ LOG TRADE</div>
                                        <div className="hft-form-grid">
                                            <div className="hft-form-field">
                                                <label>SYMBOL</label>
                                                <input value={tradeForm.symbol} onChange={e => setTradeForm(f => ({...f, symbol: e.target.value.toUpperCase()}))} placeholder="RELIANCE.NS" />
                                            </div>
                                            <div className="hft-form-field">
                                                <label>DIRECTION</label>
                                                <select value={tradeForm.direction} onChange={e => setTradeForm(f => ({...f, direction: e.target.value}))}>
                                                    <option>LONG</option><option>SHORT</option>
                                                </select>
                                            </div>
                                            <div className="hft-form-field">
                                                <label>ENTRY ₹</label>
                                                <input type="number" value={tradeForm.entry} onChange={e => setTradeForm(f => ({...f, entry: e.target.value}))} placeholder="0.00" />
                                            </div>
                                            <div className="hft-form-field">
                                                <label>EXIT ₹</label>
                                                <input type="number" value={tradeForm.exit} onChange={e => setTradeForm(f => ({...f, exit: e.target.value}))} placeholder="0.00" />
                                            </div>
                                            <div className="hft-form-field">
                                                <label>QTY / LOTS</label>
                                                <input type="number" value={tradeForm.qty} onChange={e => setTradeForm(f => ({...f, qty: e.target.value}))} placeholder="1" />
                                            </div>
                                            <div className="hft-form-field">
                                                <label>TIME (HH:MM)</label>
                                                <input value={tradeForm.time} onChange={e => setTradeForm(f => ({...f, time: e.target.value}))} placeholder="09:30" />
                                            </div>
                                            <div className="hft-form-field hft-notes-field">
                                                <label>NOTES / SETUP</label>
                                                <input value={tradeForm.notes} onChange={e => setTradeForm(f => ({...f, notes: e.target.value}))} placeholder="VWAP reclaim, news catalyst, breakout..." />
                                            </div>
                                            <button className="hft-add-btn" onClick={addTrade}>+ ADD TRADE</button>
                                        </div>
                                    </div>

                                    <div className="hft-journal-list">
                                        <div className="hft-journal-hdr">
                                            <span>DATE</span><span>SYM</span><span>DIR</span><span>ENTRY</span><span>EXIT</span><span>QTY</span><span>P&L</span><span>NOTES</span><span></span>
                                        </div>
                                        {trades.length === 0
                                            ? <div className="geo-empty">No trades logged yet</div>
                                            : trades.map((t) => {
                                                const pnl = t.exit ? ((t.direction === 'LONG' ? 1 : -1) * (parseFloat(t.exit) - parseFloat(t.entry)) * (parseFloat(t.qty)||1)) : null;
                                                return (
                                                    <div key={t.id} className={`hft-j-row ${pnl != null ? (pnl >= 0 ? 'jrow-win' : 'jrow-loss') : ''}`}>
                                                        <span>{t.date}</span>
                                                        <span className="hft-j-sym" onClick={() => { setHftTicker(t.symbol); setHftTab('signals'); fetchHFT(t.symbol); }}>{t.symbol}</span>
                                                        <span className={t.direction === 'LONG' ? 'pos' : 'neg'}>{t.direction}</span>
                                                        <span>₹{t.entry}</span>
                                                        <span>{t.exit ? `₹${t.exit}` : <em>open</em>}</span>
                                                        <span>{t.qty || 1}</span>
                                                        <span className={pnl != null ? (pnl >= 0 ? 'pos' : 'neg') : ''}>
                                                            {pnl != null ? `${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}` : '—'}
                                                        </span>
                                                        <span className="hft-j-notes">{t.notes}</span>
                                                        <span className="hft-j-del" onClick={() => deleteTrade(t.id)}>✕</span>
                                                    </div>
                                                );
                                            })
                                        }
                                    </div>
                                </div>
                            )}

                            {/* F&O MODEL TAB */}
                            {hftTab === 'fo' && (
                                <div className="hft-fo-wrap">
                                    <div className="hft-fo-header">
                                        <div className="hft-fo-title">
                                            <span className="hft-fo-icon">⚡</span>
                                            <div>
                                                <div className="hft-fo-main">F&O INTRADAY SCANNER</div>
                                                <div className="hft-fo-sub">Black-Scholes premium · ATR stops · EMA trend filter · Next weekly expiry</div>
                                            </div>
                                        </div>
                                        <button className="hft-fo-refresh" onClick={fetchFO} disabled={foLoading}>
                                            {foLoading ? '⟳ SCANNING...' : '⟳ REFRESH'}
                                        </button>
                                    </div>

                                    {foLoading && (
                                        <div className="hft-fo-loading">
                                            <div className="hft-fo-spinner"></div>
                                            <span>Scanning 30 F&O stocks · Computing signals...</span>
                                        </div>
                                    )}

                                    {!foLoading && !foData && (
                                        <div className="hft-fo-empty">
                                            <div style={{ fontSize: 36, opacity: 0.3 }}>⚡</div>
                                            <div>Click REFRESH to scan F&O opportunities</div>
                                            <div style={{ fontSize: 10, opacity: 0.5 }}>Analyzes 30 liquid NSE F&O stocks for CE/PE setups</div>
                                        </div>
                                    )}

                                    {!foLoading && foData && foData.length === 0 && (
                                        <div className="hft-fo-empty">
                                            <div style={{ fontSize: 36, opacity: 0.3 }}>⊘</div>
                                            <div>No high-conviction F&O setups found right now</div>
                                            <div style={{ fontSize: 10, opacity: 0.5 }}>Try again during market hours for live signals</div>
                                        </div>
                                    )}

                                    {!foLoading && foData && foData.length > 0 && (
                                        <>
                                            <div className="hft-fo-legend">
                                                <span className="fo-leg-ce">■ CE = CALL (Bullish)</span>
                                                <span className="fo-leg-pe">■ PE = PUT (Bearish)</span>
                                                <span className="fo-leg-note">Premium based on Black-Scholes · Strikes adjusted to market lot · ATR-based stops</span>
                                            </div>
                                            <div className="hft-fo-table-wrap">
                                                <table className="hft-fo-table">
                                                    <thead>
                                                        <tr>
                                                            <th>SYMBOL</th>
                                                            <th>LTP</th>
                                                            <th>CHG%</th>
                                                            <th>TYPE</th>
                                                            <th>STRIKE</th>
                                                            <th>PREM (ATM)</th>
                                                            <th>PREM (OTM)</th>
                                                            <th>RSI</th>
                                                            <th>IV%</th>
                                                            <th>TREND</th>
                                                            <th>STOP (LTP)</th>
                                                            <th>TGT (LTP)</th>
                                                            <th>OPT TGT</th>
                                                            <th>OPT SL</th>
                                                            <th>SCORE</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {foData.map(s => (
                                                            <tr key={s.sym} className={s.signal === 'CE' ? 'fo-row-ce' : 'fo-row-pe'}
                                                                onClick={() => { handleSelect(s.sym); setActiveView('terminal'); }}>
                                                                <td className="fo-sym">
                                                                    <span className="fo-sym-name">{s.name}</span>
                                                                    <span className="fo-sym-tick">{s.sym.replace('.NS','')}</span>
                                                                </td>
                                                                <td className="fo-price">₹{s.price?.toLocaleString('en-IN')}</td>
                                                                <td className={s.change >= 0 ? 'fo-pos' : 'fo-neg'}>{s.change >= 0 ? '+' : ''}{s.change}%</td>
                                                                <td><span className={`fo-type-badge fo-${s.signal.toLowerCase()}`}>{s.signal}</span></td>
                                                                <td className="fo-mono">{s.strike}</td>
                                                                <td className="fo-mono fo-prem">₹{s.premium}</td>
                                                                <td className="fo-mono fo-prem-otm">₹{s.premOtm}</td>
                                                                <td className={s.rsi < 35 ? 'fo-pos' : s.rsi > 65 ? 'fo-neg' : 'fo-neutral'}>{s.rsi}</td>
                                                                <td className="fo-mono">{s.iv}%</td>
                                                                <td>
                                                                    <span className={`fo-trend-badge fo-trend-${s.emaTrend?.toLowerCase()}`}>{s.emaTrend}</span>
                                                                </td>
                                                                <td className="fo-mono fo-neg">₹{s.stopLoss}</td>
                                                                <td className="fo-mono fo-pos">₹{s.target}</td>
                                                                <td className="fo-mono fo-pos">₹{s.optTarget}</td>
                                                                <td className="fo-mono fo-neg">₹{s.optStop}</td>
                                                                <td>
                                                                    <div className="fo-score-bar">
                                                                        <div className="fo-score-fill" style={{ width: `${Math.min(s.strength * 2, 100)}%`, background: s.signal === 'CE' ? 'var(--pos)' : 'var(--neg)' }}></div>
                                                                        <span className="fo-score-val">{s.strength}</span>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <div className="hft-fo-disclaimer">
                                                ⚠ Signals are algorithmic. Not investment advice. Verify with your broker before trading. F&O involves substantial risk.
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* PATTERNS TAB */}
                            {hftTab === 'patterns' && (
                                <div className="hft-patterns">
                                    <div className="hft-section-hdr">TIME-OF-DAY PERFORMANCE</div>
                                    {Object.keys(timePatterns).length === 0
                                        ? <div className="geo-empty">Add trades with times to see patterns</div>
                                        : (
                                            <div className="hft-time-grid">
                                                {Object.entries(timePatterns).sort().map(([hour, data]) => {
                                                    const total = data.wins + data.losses;
                                                    const wr = total > 0 ? ((data.wins/total)*100).toFixed(0) : 0;
                                                    return (
                                                        <div key={hour} className="hft-time-cell" style={{ borderColor: data.pnl >= 0 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)', background: data.pnl >= 0 ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)' }}>
                                                            <div className="htc-hour">{hour}</div>
                                                            <div className="htc-wr" style={{ color: parseFloat(wr) >= 60 ? 'var(--pos)' : parseFloat(wr) >= 45 ? 'var(--warn)' : 'var(--neg)' }}>{wr}% WR</div>
                                                            <div className="htc-pnl" style={{ color: data.pnl >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{data.pnl >= 0 ? '+' : ''}₹{data.pnl.toFixed(0)}</div>
                                                            <div className="htc-trades">{data.wins}W {data.losses}L</div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )
                                    }
                                    <div className="hft-section-hdr" style={{ marginTop: 20 }}>SETUP ANALYSIS</div>
                                    {(() => {
                                        const setupMap = {};
                                        closedTrades.forEach((t, i) => {
                                            if (!t.notes) return;
                                            const setup = t.notes.split(',')[0].trim().toLowerCase();
                                            if (!setupMap[setup]) setupMap[setup] = { wins: 0, losses: 0, pnl: 0 };
                                            if (pnlList[i] > 0) setupMap[setup].wins++;
                                            else setupMap[setup].losses++;
                                            setupMap[setup].pnl += pnlList[i];
                                        });
                                        const setups = Object.entries(setupMap).sort((a,b) => b[1].pnl - a[1].pnl);
                                        return setups.length === 0
                                            ? <div className="geo-empty">Add trade notes to analyze setups</div>
                                            : setups.map(([setup, data]) => {
                                                const total = data.wins + data.losses;
                                                return (
                                                    <div key={setup} className="hft-setup-row">
                                                        <span className="hsr-setup">{setup}</span>
                                                        <span className="hsr-wr">{total > 0 ? ((data.wins/total)*100).toFixed(0) : 0}% WR</span>
                                                        <span className="hsr-trades">{total} trades</span>
                                                        <span className={`hsr-pnl ${data.pnl >= 0 ? 'pos' : 'neg'}`}>{data.pnl >= 0 ? '+' : ''}₹{data.pnl.toFixed(0)}</span>
                                                        <div className="hsr-bar-wrap"><div className="hsr-bar" style={{ width: `${Math.min(100, Math.abs(data.pnl)/10)}%`, background: data.pnl >= 0 ? 'var(--pos)' : 'var(--neg)' }} /></div>
                                                    </div>
                                                );
                                            });
                                    })()}
                                </div>
                            )}
                        </div>
                    );
                })()}

            </div>{/* /geo-main */}

            {/* ── BOTTOM BAR — Global Markets + Commodities ── */}
            {(() => {
                // Futures already has DJI, S&P, NASDAQ, CRUDE, GOLD, USD/INR
                // Add Silver + NatGas from rates (not in futures)
                const extraSyms = ['SI=F','NG=F'];
                const extraItems = rates.filter(r => extraSyms.includes(r.symbol)).map(r => ({
                    name: r.name, symbol: r.symbol,
                    price: r.price, changePercent: r.changePercent,
                    unit: r.unit,
                }));
                const globalItems = [
                    ...futures,
                    ...extraItems,
                ];
                const barItems = globalItems.length > 0 ? globalItems : [];
                return (
                    <div className="geo-bottom indices-bar">
                        <div className="ib-label">
                            <span className="ib-live-dot" />GLOBAL MKT
                        </div>
                        <div className="ib-track-wrap">
                            <div className="ib-track">
                                {[...barItems, ...barItems].map((item, i) => {
                                    const chg = item.changePercent ?? 0;
                                    const isComm = ['SI=F','NG=F','GC=F','CL=F','USDINR=X'].includes(item.symbol);
                                    return (
                                        <div key={i} className="ib-chip" style={{ cursor: isComm ? 'default' : 'pointer' }}
                                            onClick={isComm ? undefined : () => handleSelect(item.symbol)}>
                                            <span className="ib-name">{(item.name || item.symbol || '').replace('Futures','').replace('S&P 500','SPX').replace('Dow Jones','DJIA').replace('NASDAQ','NDX').replace('FTSE 100','FTSE').replace('Nikkei 225','NIKKEI').replace('DAX PERFORMANCE-INDEX','DAX').replace('Hang Seng','HSI').trim()}</span>
                                            <span className="ib-price">
                                                {item.unit || ''}{item.price != null ? item.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
                                            </span>
                                            <span className={`ib-chg ${chg >= 0 ? 'pos' : 'neg'}`}>
                                                {chg >= 0 ? '▲' : '▼'}{Math.abs(chg).toFixed(2)}%
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="ib-gti" style={{ color: gtiCol }}>
                            <GTISparkline history={gtiHistory} />
                            <span className="ib-gti-score">{gtiScore}</span>
                            <span className="ib-gti-lvl">{gtiLvl}</span>
                        </div>
                    </div>
                );
            })()}

            {/* ── MOBILE BOTTOM NAV ── */}
            <nav className="mobile-nav">
                {[
                    { view: 'home',      icon: '⌂', label: 'Home' },
                    { view: 'geopulse', icon: '⊕', label: 'Earth' },
                    { view: 'terminal', icon: '⊞', label: 'Terminal' },
                    { view: 'signals',  icon: '⊿', label: 'Signals' },
                    { view: 'hftmodel', icon: '◈', label: 'HFT' },
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
