'use strict';

const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const fs           = require('fs');
const compression  = require('compression');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const YahooFinance = require('yahoo-finance2').default;
const { SMA, EMA, MACD, RSI, BollingerBands, Stochastic, ADX } = require('technicalindicators');

const { getRelativeTime, toPeriod1, cleanName, parseNum, fmtCap } = require('./utils/helpers');
const { LM_STRONG_BULL, LM_BULL, LM_STRONG_BEAR, LM_BEAR, dSent, sentScore, dSentScore, dSec, dIndiaImpact, detectConglomerate } = require('./utils/sentiment');
const { btEMA, btMACD, btRSI, btATR, btVWAP }                     = require('./utils/indicators');
const { isIndianTicker, bsPrice, bsGreeks, getNSEExpiries, buildTheoreticalChain } = require('./utils/blackScholes');
const { RSS_SOURCES, RSS_TTL, rssCache: _rssInit, fetchRSS }      = require('./utils/rss');
const { NSE_HDR, getNSEIndices, getNSESession, fetchNSEOptionChain, getLivePCR, fetchGiftNifty } = require('./utils/nse');
const {
    SECTORS, recordSectorSentiment, getSectorMomentumDelta, computeSectorHeat,
    getMacroEventDampening, updateCircuitBreaker, getCircuitBreaker,
    classifyRangeboundStock, getFlowConcentrationWarning,
} = require('./utils/rotationEngine');
const {
    normaliseTicker, getSector, analyseHolding, computeHealthScore,
    isMutualFundTicker, checkDataSufficiency, estimateRotationCost,
} = require('./utils/portfolio');
const {
    NSE_FNO_LIQUID, NIFTY100_LIST, NSE_KEY_IDX, NSE_IDX_MAP,
    COUNTRY_INDICES, SECTOR_MAP, SIG_STOCKS, CLS_DRIVERS, FO_STOCKS, TRADER_EDGE,
} = require('./constants/indices');

// ── App ───────────────────────────────────────────────────────────────────────
const app          = express();
const yahooFinance = new YahooFinance();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, message: { error: 'Too many requests.' } }));

// ── Module-level caches ───────────────────────────────────────────────────────
let rssCache       = { data: null, ts: 0 };
let liveTapeCache  = { data: null, ts: 0 };
let indicesBarCache= { data: null, ts: 0 };
let futuresCache   = { data: null, ts: 0 };
let breadthCache   = { data: null, ts: 0 };
let ratesCache     = { data: null, ts: 0 };
let gtiCache       = null, gtiCacheTs = 0;
let sigCache       = null, sigCacheTs = 0;
let foCache        = null, foCacheTs  = 0;
let personalModelCache = null, pmCacheTs = 0;
const moversCache  = {};
const countryCache = {};

const LIVETAPE_TTL  = 8_000;
const INDICESBAR_TTL= 3_000;
const FUTURES_TTL   = 10_000;
const BREADTH_TTL   = 30_000;
const RATES_TTL     = 15_000;
const MOVERS_TTL    = 2 * 60 * 1000;
const COUNTRY_TTL   = 60_000;

// ── GTI helpers ───────────────────────────────────────────────────────────────
const GTI_POS = { war:20,attack:16,nuclear:22,military:12,crisis:11,conflict:10,missile:18,sanction:9,embargo:9,terror:18,bomb:17,tension:7,invasion:20,protest:5,coup:16,assassination:17,blockade:13,threat:8,escalat:12,airstrike:17 };
const GTI_NEG = { peace:-9,ceasefire:-13,deal:-6,agreement:-8,rally:-5,growth:-4,recovery:-6,surplus:-4,truce:-11,diplomacy:-8 };

const computeGTI = (items) => {
    let score = 48;
    items.forEach(n => {
        const low = (n.title || '').toLowerCase();
        Object.entries(GTI_POS).forEach(([k, w]) => { if (low.includes(k)) score += w * 0.28; });
        Object.entries(GTI_NEG).forEach(([k, w]) => { if (low.includes(k)) score += w * 0.28; });
    });
    return Math.max(15, Math.min(95, Math.round(score)));
};

const getRegion = (t) => {
    const low = t.toLowerCase();
    if (/india|sensex|nifty|mumbai|rbi|sebi|rupee|dalal/.test(low))           return 'India';
    if (/middle east|iran|saudi|gulf|israel|syria|iraq|yemen|oman/.test(low))  return 'Middle East';
    if (/russia|ukraine|nato|moscow|kyiv|kremlin/.test(low))                   return 'E. Europe';
    if (/china|taiwan|beijing|shanghai|hong kong|south china/.test(low))       return 'Asia-Pacific';
    if (/fed|dollar|wall street|us |america|nasdaq|s&p|treasury|pentagon/.test(low)) return 'N. America';
    if (/europe|ecb|euro|germany|france|uk|britain|london/.test(low))         return 'Europe';
    if (/africa|nigeria|kenya|egypt|ethiopia|sudan/.test(low))                 return 'Africa';
    return 'Global';
};

const getEventLevel = (t) => {
    const low = t.toLowerCase();
    if (/war|attack|nuclear|missile|bomb|terror|coup|invasion|assassination|airstrike/.test(low)) return 'CRITICAL';
    if (/crisis|conflict|sanction|embargo|tension|blockade|escalat|threat/.test(low))            return 'HIGH';
    if (/concern|uncertainty|risk|protest|dispute/.test(low))                                     return 'MEDIUM';
    return 'LOW';
};

// ── News helpers ──────────────────────────────────────────────────────────────
const HIGH_IMPACT_WORDS = [
    'rbi','crash','surge','fed','interest rate','nifty','sensex','sebi','budget','gdp',
    'rate hike','rate cut','inflation','recession','war','sanctions','ban','crisis',
    'default','collapse','record high','all-time high','circuit','fii','tariff','oil price',
];

const mapNewsItem = (title, link, publisher, timestamp) => {
    // Test 10: detect conglomerate-specific events before sector tagging
    const cg = detectConglomerate(title || '');
    // Test 7 & 8: source-weighted, negation-aware sentiment
    const ss = sentScore(title, publisher);
    return {
        title, link, publisher, timestamp,
        time:             getRelativeTime(new Date(timestamp)),
        rawTime:          new Date(timestamp).toLocaleString('en-IN'),
        sectors:          dSec(title, cg),
        conglomerate:     cg ? cg.name : null,
        sentiment:        ss.sentiment,
        sentimentScore:   ss.score,
        confidence:       ss.confidence,
        sourceWeight:     ss.sourceWeight,
        indiaImpact:      dIndiaImpact(title),
        highImpact:       HIGH_IMPACT_WORDS.some(w => title.toLowerCase().includes(w)),
        confirmed:        false,
    };
};

// ── F&O scanner: Black-Scholes (local, avoids importing duplicate) ─────────────
const normCdf = (z) => {
    if (z < -6) return 0; if (z > 6) return 1;
    const k = 1 / (1 + 0.2316419 * Math.abs(z));
    const poly = k * (0.319381530 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
    const p = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
    return z >= 0 ? p : 1 - p;
};
const bsCall = (S, K, T, r, sigma) => {
    if (T <= 0 || sigma <= 0) return Math.max(S - K, 0);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d1 - sigma * Math.sqrt(T));
};
const bsPut = (S, K, T, r, sigma) => {
    if (T <= 0 || sigma <= 0) return Math.max(K - S, 0);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
};

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── Global indices ────────────────────────────────────────────────────────────
app.get('/api/global', async (req, res) => {
    try {
        const [nseRes, yfRes] = await Promise.allSettled([
            getNSEIndices(),
            yahooFinance.quote(['^DJI', '^IXIC', 'GC=F', 'CL=F', 'USDINR=X']),
        ]);
        const out = [];
        if (nseRes.status === 'fulfilled') {
            nseRes.value.forEach(idx => {
                const key = idx.index || idx.indexSymbol || '';
                const mapped = NSE_IDX_MAP[key];
                if (mapped) out.push({ symbol: mapped.sym, name: mapped.name, price: idx.last ?? idx.current ?? null, change: idx.variation ?? 0, changePercent: idx.percentChange ?? 0, isLive: true });
            });
        } else {
            const fb = await yahooFinance.quote(['^NSEI', '^NSEBANK', '^BSESN', '^INDIAVIX']).catch(() => []);
            (Array.isArray(fb) ? fb : []).forEach(q => out.push({ symbol: q.symbol, name: q.shortName || q.symbol, price: q.regularMarketPrice, change: q.regularMarketChange, changePercent: q.regularMarketChangePercent, isLive: false }));
        }
        if (yfRes.status === 'fulfilled') {
            (Array.isArray(yfRes.value) ? yfRes.value : []).forEach(q => out.push({ symbol: q.symbol, name: q.shortName || q.symbol, price: q.regularMarketPrice, change: q.regularMarketChange, changePercent: q.regularMarketChangePercent, isLive: false }));
        }
        res.json(out);
    } catch { res.json([]); }
});

// ── Global news (RSS + Yahoo Finance) ────────────────────────────────────────
app.get('/api/globalnews', async (req, res) => {
    const now = Date.now();
    try {
        const getRSS = async () => {
            if (rssCache.data && now - rssCache.ts < RSS_TTL) return rssCache.data;
            const results = await Promise.allSettled(
                RSS_SOURCES.map(s => fetchRSS(s.url, 15).then(items => items.map(i => mapNewsItem(i.title, i.link, s.pub, i.ts))))
            );
            const mapped = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
            rssCache = { data: mapped, ts: now };
            return mapped;
        };
        const getYF = async () => {
            const searches = await Promise.all(
                ['RELIANCE.NS', 'TCS.NS', '^NSEI', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS'].map(sym =>
                    yahooFinance.search(sym, { newsCount: 5 }).catch(() => ({ news: [] }))
                )
            );
            const seen = new Set();
            return searches.flatMap(r => r.news || [])
                .filter(n => { if (seen.has(n.uuid)) return false; seen.add(n.uuid); return true; })
                .map(n => {
                    const ts = n.providerPublishTime instanceof Date ? n.providerPublishTime.getTime() : (n.providerPublishTime || 0) * 1000;
                    return mapNewsItem(n.title, n.link, n.publisher || 'Yahoo Finance', ts);
                });
        };
        const [rssRes, yfRes] = await Promise.allSettled([getRSS(), getYF()]);
        const rssItems = rssRes.status === 'fulfilled' ? rssRes.value : [];
        const yfItems  = yfRes.status  === 'fulfilled' ? yfRes.value  : [];
        const seen = new Set();
        const deduped = [...rssItems, ...yfItems]
            .filter(n => { const key = (n.title || '').slice(0, 45).toLowerCase().replace(/\s+/g, ''); if (seen.has(key)) return false; seen.add(key); return true; })
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, 50);
        const merged = deduped.map(item => {
            const words = (item.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 4);
            const confirmedBy = deduped.filter(other => other !== item && other.publisher !== item.publisher && words.filter(w => (other.title || '').toLowerCase().includes(w)).length >= 3);
            return confirmedBy.length > 0 ? { ...item, confirmed: true } : item;
        });
        res.json(merged);
    } catch { res.json([]); }
});

// ── Options chain ─────────────────────────────────────────────────────────────
app.get('/api/options/:ticker', async (req, res) => {
    try {
        const ticker = req.params.ticker.toUpperCase().replace(/[^A-Z0-9^.=\-_]/g, '');
        if (!ticker || ticker.length > 20) return res.status(400).json({ error: 'Invalid ticker' });
        const { expiry: requestedExpiry } = req.query;
        if (isIndianTicker(ticker)) {
            const p1 = toPeriod1('1mo');
            const chart = await yahooFinance.chart(ticker, { interval: '1d', period1: p1 }).catch(() => ({ quotes: [] }));
            const closes = (chart.quotes || []).filter(x => x && x.close).map(x => x.close);
            let hv = 28;
            if (closes.length > 5) {
                const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
                const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
                hv = Math.round(Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length * 252) * 100 * 1.25);
            }
            hv = Math.max(10, Math.min(80, hv));
            const expiryDates = getNSEExpiries(4);
            const targetExpiry = requestedExpiry || expiryDates[0];
            const quote = await yahooFinance.quote(ticker).catch(() => ({}));
            const price = quote.regularMarketPrice || (closes.length ? closes[closes.length - 1] : 100);
            const chain = buildTheoreticalChain(price, hv, targetExpiry);
            return res.json({ ...chain, expiry: targetExpiry, expiryDates, source: 'THEORETICAL', hv });
        }
        const r = await yahooFinance.options(ticker);
        if (!r?.options?.[0]) return res.json({ calls: [], puts: [], expiry: null });
        const c = r.options[0];
        const allC = c.calls || [], allP = c.puts || [];
        const totalCallOI = allC.reduce((s, o) => s + (o.openInterest || 0), 0);
        const totalPutOI  = allP.reduce((s, o) => s + (o.openInterest || 0), 0);
        const pcr = totalCallOI > 0 ? +(totalPutOI / totalCallOI).toFixed(2) : null;
        const strikes = [...new Set([...allC.map(o => o.strike), ...allP.map(o => o.strike)])].sort((a, b) => a - b);
        let minLoss = Infinity, maxPain = null;
        for (const p of strikes) {
            const loss = allC.reduce((s, o) => s + Math.max(0, p - o.strike) * (o.openInterest || 0), 0)
                       + allP.reduce((s, o) => s + Math.max(0, o.strike - p) * (o.openInterest || 0), 0);
            if (loss < minLoss) { minLoss = loss; maxPain = p; }
        }
        const m = o => ({ strike: o.strike, lastPrice: o.lastPrice || 0, bid: o.bid || 0, ask: o.ask || 0, iv: o.impliedVolatility ? +(o.impliedVolatility * 100).toFixed(1) : null, oi: o.openInterest || 0, vol: o.volume || 0, inTheMoney: o.inTheMoney || false });
        const topC = allC.map(m).sort((a, b) => b.oi - a.oi).slice(0, 12).sort((a, b) => a.strike - b.strike);
        const topP = allP.map(m).sort((a, b) => b.oi - a.oi).slice(0, 12).sort((a, b) => a.strike - b.strike);
        const maxOI = Math.max(...[...topC, ...topP].map(o => o.oi), 1);
        const expDate = c.expirationDate instanceof Date ? c.expirationDate : new Date(c.expirationDate * 1000);
        res.json({ expiry: expDate.toLocaleDateString('en-IN'), calls: topC, puts: topP, pcr, maxPain, maxOI, totalCallOI, totalPutOI, source: 'LIVE' });
    } catch { res.json({ calls: [], puts: [], expiry: null }); }
});

// ── Analyze ticker ────────────────────────────────────────────────────────────
app.get('/api/analyze/:ticker', async (req, res) => {
    try {
        const sym = req.params.ticker.toUpperCase().replace(/[^A-Z0-9^.=\-_]/g, '');
        if (!sym || sym.length > 20) return res.status(400).json({ error: 'Invalid ticker' });
        let { period = '6mo', interval = '1d' } = req.query;
        const isIntraday   = interval.includes('m') || interval === '1h';
        const intradayRange = interval === '1m' ? '2d' : '5d';
        const mainRangeKey  = isIntraday ? intradayRange : (period || '6mo');
        const params = { interval, period1: toPeriod1(mainRangeKey) };

        const [quote, summary, chart, dailyChart, searchRes, weekly1yChart] = await Promise.all([
            yahooFinance.quote(sym).catch(() => ({})),
            yahooFinance.quoteSummary(sym, { modules: ['summaryDetail', 'financialData', 'defaultKeyStatistics'] }).catch(() => ({})),
            yahooFinance.chart(sym, params).catch(() => ({ quotes: [] })),
            yahooFinance.chart(sym, { interval: '1d', period1: toPeriod1('5d') }).catch(() => ({ quotes: [] })),
            yahooFinance.search(sym, { newsCount: 15 }).catch(() => ({ news: [] })),
            yahooFinance.chart(sym, { interval: '1wk', range: '1y' }).catch(() => ({ quotes: [] })),
        ]);

        const q  = (chart?.quotes || []).filter(x => x && x.close != null);
        const dq = (dailyChart?.quotes || []).filter(x => x && x.close != null);
        const price = quote.regularMarketPrice || (q.length ? q[q.length - 1].close : 0);

        const chartDayHigh = q.length ? Math.max(...q.map(x => x.high).filter(Boolean)) : 0;
        const chartDayLow  = q.length ? Math.min(...q.map(x => x.low).filter(v => v > 0)) : 0;
        const prevDayCandle = dq.length >= 2 ? dq[dq.length - 2] : dq.length === 1 ? dq[0] : null;
        const dayHigh  = quote.regularMarketDayHigh  || chartDayHigh  || null;
        const dayLow   = quote.regularMarketDayLow   || chartDayLow   || null;
        const prevClose= quote.regularMarketPreviousClose || prevDayCandle?.close || null;
        const openPrice= quote.regularMarketOpen || (q[0]?.open) || null;

        let wkHigh52 = quote.fiftyTwoWeekHigh || null;
        let wkLow52  = quote.fiftyTwoWeekLow  || null;
        if ((!wkHigh52 || !wkLow52) && weekly1yChart?.quotes?.length) {
            const wq = weekly1yChart.quotes.filter(x => x && x.high != null && x.low != null);
            if (wq.length) { wkHigh52 = Math.max(...wq.map(x => x.high)); wkLow52 = Math.min(...wq.map(x => x.low)); }
        }

        const volumes = q.map(x => x.volume || 0).filter(v => v > 0);
        const avgVol10 = volumes.length > 2 ? volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1) : 0;
        const lastVol  = volumes[volumes.length - 1] || 0;
        const volSpikeRatio = avgVol10 > 0 ? +(lastVol / avgVol10).toFixed(2) : null;
        const volSpike = volSpikeRatio != null && volSpikeRatio >= 1.5;

        let tech = null;
        if (q.length > 5) {
            const cl = q.map(x => x.close), hi = q.map(x => x.high), lo = q.map(x => x.low);
            const pivH = prevDayCandle?.high  || hi[hi.length - 1];
            const pivL = prevDayCandle?.low   || lo[lo.length - 1];
            const pivC = prevDayCandle?.close || cl[cl.length - 1];
            const P = (pivH + pivL + pivC) / 3;

            const rsi  = q.length >= 14 ? RSI.calculate({ values: cl, period: 14 }).pop() : null;
            const macd = q.length >= 26 ? MACD.calculate({ values: cl, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }).pop() : null;
            const bb   = q.length >= 20 ? BollingerBands.calculate({ values: cl, period: 20, stdDev: 2 }).pop() : null;
            const adx  = q.length >= 14 ? ADX.calculate({ high: hi, low: lo, close: cl, period: 14 }).pop() : null;

            let vwap = null;
            if (isIntraday && volumes.length > 0) {
                const totalPV = q.reduce((s, x) => s + ((x.high + x.low + x.close) / 3) * (x.volume || 0), 0);
                const totalV  = q.reduce((s, x) => s + (x.volume || 0), 0);
                vwap = totalV > 0 ? +(totalPV / totalV).toFixed(2) : null;
            }

            let ivRank = null, ivPercentile = null, hvCurrent = null;
            if (dq.length >= 30) {
                const dcl = dq.map(x => x.close).filter(Boolean);
                const dailyReturns = dcl.slice(1).map((c, j) => Math.log(c / dcl[j]));
                const hvWindows = [];
                for (let w = 0; w + 30 <= dailyReturns.length; w++) {
                    const win = dailyReturns.slice(w, w + 30);
                    const mean = win.reduce((a, b) => a + b, 0) / 30;
                    hvWindows.push(Math.sqrt(win.reduce((s, r) => s + (r - mean) ** 2, 0) / 30 * 252) * 100);
                }
                if (hvWindows.length >= 2) {
                    hvCurrent = +hvWindows[hvWindows.length - 1].toFixed(1);
                    const hvMin = Math.min(...hvWindows), hvMax = Math.max(...hvWindows);
                    ivRank = hvMax > hvMin ? +((hvCurrent - hvMin) / (hvMax - hvMin) * 100).toFixed(0) : 50;
                    ivPercentile = +((hvWindows.filter(h => h <= hvCurrent).length / hvWindows.length) * 100).toFixed(0);
                }
            }

            tech = {
                rsi: rsi != null ? +rsi.toFixed(2) : null, macd,
                ema9:  q.length >= 9   ? +EMA.calculate({ values: cl, period: 9 }).pop().toFixed(2)   : null,
                ema21: q.length >= 21  ? +EMA.calculate({ values: cl, period: 21 }).pop().toFixed(2)  : null,
                sma50: q.length >= 50  ? +SMA.calculate({ values: cl, period: 50 }).pop().toFixed(2)  : null,
                sma200:q.length >= 200 ? +SMA.calculate({ values: cl, period: 200 }).pop().toFixed(2) : null,
                stochastic: q.length >= 14 ? Stochastic.calculate({ high: hi, low: lo, close: cl, period: 14, signalPeriod: 3 }).pop() : null,
                bb, adx, vwap, ivRank, ivPercentile, hvCurrent,
                pivots: { pivot: +P.toFixed(2), r1: +(2*P - pivL).toFixed(2), s1: +(2*P - pivH).toFixed(2), r2: +(P + (pivH-pivL)).toFixed(2), s2: +(P - (pivH-pivL)).toFixed(2) },
                prevDayH: prevDayCandle?.high || null, prevDayL: prevDayCandle?.low || null, prevDayC: prevDayCandle?.close || null,
                volSpike, volSpikeRatio, candleCount: q.length,
            };
        }

        const det = summary.summaryDetail || {}, f = summary.financialData || {}, ks = summary.defaultKeyStatistics || {};
        res.json({
            ticker: sym, companyName: quote.shortName || sym, price,
            change: quote.regularMarketChange || 0, changePercent: quote.regularMarketChangePercent || 0,
            volume: quote.regularMarketVolume || lastVol || null,
            openPrice, dayHigh, dayLow, prevClose,
            fiftyTwoWeekHigh: wkHigh52, fiftyTwoWeekLow: wkLow52,
            avgVolume: quote.averageDailyVolume3Month || null,
            volSpike, volSpikeRatio, currency: quote.currency || 'INR', isIndex: sym.startsWith('^'),
            financials: {
                'Market Cap':    det.marketCap     ? fmtCap(det.marketCap)                    : 'N/A',
                'P/E Ratio':     det.trailingPE    ? Number(det.trailingPE).toFixed(2)         : 'N/A',
                'EPS (TTM)':     ks.trailingEps    ? Number(ks.trailingEps).toFixed(2)         : 'N/A',
                'Revenue':       f.totalRevenue    ? fmtCap(f.totalRevenue)                    : 'N/A',
                'Profit Margin': f.profitMargins   ? (f.profitMargins*100).toFixed(2)+'%'      : 'N/A',
                'ROE':           f.returnOnEquity  ? (f.returnOnEquity*100).toFixed(2)+'%'     : 'N/A',
                'Debt/Equity':   f.debtToEquity    ? Number(f.debtToEquity).toFixed(2)         : 'N/A',
                'Div Yield':     det.dividendYield ? (det.dividendYield*100).toFixed(2)+'%'    : 'N/A',
                'Beta':          det.beta          ? Number(det.beta).toFixed(2)               : 'N/A',
                '52W High':      wkHigh52          ? Number(wkHigh52).toFixed(2)               : 'N/A',
                '52W Low':       wkLow52           ? Number(wkLow52).toFixed(2)                : 'N/A',
                'Avg Volume':    quote.averageDailyVolume3Month ? fmtCap(quote.averageDailyVolume3Month) : 'N/A',
                'Prev Day H':    prevDayCandle?.high  ? Number(prevDayCandle.high).toFixed(2)  : 'N/A',
                'Prev Day L':    prevDayCandle?.low   ? Number(prevDayCandle.low).toFixed(2)   : 'N/A',
                'Prev Day C':    prevDayCandle?.close ? Number(prevDayCandle.close).toFixed(2) : 'N/A',
            },
            technicals: tech,
            recommendation: (() => {
                let score = 0, sigs = 0;
                const rsi = tech?.rsi;
                if (rsi != null)       { sigs += 2; score += rsi < 35 ? 2 : rsi > 70 ? -2 : rsi < 50 ? 1 : -1; }
                if (tech?.macd)        { sigs++;    score += tech.macd.MACD > tech.macd.signal ? 1 : -1; }
                if (tech?.ema9 && tech?.ema21) { sigs++; score += tech.ema9 > tech.ema21 ? 1 : -1; }
                if (tech?.bb && price) { sigs++;    score += price < tech.bb.lower ? 2 : price > tech.bb.upper ? -2 : 0; }
                const norm = sigs > 0 ? score / sigs : 0;
                const action = norm >= 1 ? 'STRONG BUY' : norm >= 0.4 ? 'BUY' : norm <= -1 ? 'STRONG SELL' : norm <= -0.4 ? 'SELL' : 'HOLD';
                return { action, confidence: Math.min(95, Math.round(55 + Math.abs(norm) * 22)), targetArea: price * (norm >= 0 ? 1.055 : 1.02), stopLoss: price * (norm >= 0 ? 0.965 : 0.95) };
            })(),
            chartData: q.map(x => ({
                time: isIntraday ? Math.floor(new Date(x.date).getTime() / 1000) : x.date.toISOString().split('T')[0],
                open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume || 0,
            })),
            news: searchRes.news.map(n => {
                const pubDate = n.providerPublishTime instanceof Date ? n.providerPublishTime : new Date(n.providerPublishTime * 1000);
                const ss = sentScore(n.title);
                return { title: n.title, link: n.link, publisher: n.publisher, time: getRelativeTime(pubDate), sentiment: ss.sentiment, sentimentScore: ss.score, confidence: ss.confidence, sectors: dSec(n.title) };
            }),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Top 15 quick tickers ───────────────────────────────────────────────────────
app.get('/api/top15', async (req, res) => {
    try {
        const l = ['RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS', 'SBIN.NS', 'ITC.NS', 'NVDA', 'AAPL', 'GC=F'];
        const q = await yahooFinance.quote(l);
        res.json(q.map(x => ({ ticker: x.symbol, changePercent: x.regularMarketChangePercent?.toFixed(2), action: x.regularMarketChangePercent > 0 ? 'BUY' : 'SELL' })));
    } catch { res.json([]); }
});

// ── GTI (Geopolitical Tension Index) ─────────────────────────────────────────
app.get('/api/gti', async (_req, res) => {
    if (gtiCache && Date.now() - gtiCacheTs < 90000) return res.json(gtiCache);
    try {
        const searches = await Promise.all(
            ['RELIANCE.NS', 'TCS.NS', '^NSEI', 'GC=F', 'CL=F'].map(sym =>
                yahooFinance.search(sym, { newsCount: 8 }).catch(() => ({ news: [] }))
            )
        );
        const seen = new Set();
        const allNews = searches.flatMap(r => r.news || []).filter(n => { if (seen.has(n.uuid)) return false; seen.add(n.uuid); return true; });
        const score = computeGTI(allNews);
        const delta = +(score - (gtiCache?.score || score)).toFixed(1);
        const level = score >= 80 ? 'CRITICAL' : score >= 60 ? 'ELEVATED' : score >= 35 ? 'MEDIUM' : 'LOW';
        const events = allNews.slice(0, 10).map(n => {
            const pubDate = n.providerPublishTime instanceof Date ? n.providerPublishTime : new Date(n.providerPublishTime * 1000);
            return { title: n.title?.length > 55 ? n.title.slice(0, 55) + '…' : n.title, region: getRegion(n.title || ''), level: getEventLevel(n.title || ''), time: pubDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), link: n.link };
        });
        gtiCache = { score, delta, level, events, ts: Date.now() };
        gtiCacheTs = Date.now();
        res.json(gtiCache);
    } catch { res.json({ score: 58, delta: 0, level: 'MEDIUM', events: [], ts: Date.now() }); }
});

// ── AI Signals ────────────────────────────────────────────────────────────────
app.get('/api/signals', async (_req, res) => {
    if (sigCache && Date.now() - sigCacheTs < 60000) return res.json(sigCache);
    try {
        const syms = SIG_STOCKS.map(s => s.sym);
        const quotes = await yahooFinance.quote(syms).catch(() => []);
        const qMap = {};
        quotes.forEach(q => { if (q?.symbol) qMap[q.symbol] = q; });
        const p1 = toPeriod1('1mo');
        const charts = await Promise.allSettled(syms.map(sym => yahooFinance.chart(sym, { interval: '1d', period1: p1 }).catch(() => null)));
        const gtiData = gtiCache || { events: [] };

        const signals = SIG_STOCKS.map(({ sym, name, cls }, i) => {
            const q = qMap[sym] || {};
            const cr = charts[i];
            let rsi = 50, closes = [], macdBull = false, emaCross = false;
            if (cr.status === 'fulfilled' && cr.value?.quotes) {
                const qs = cr.value.quotes.filter(x => x?.close);
                closes = qs.map(x => x.close);
                if (closes.length >= 14) {
                    const rsiArr = RSI.calculate({ values: closes, period: 14 });
                    if (rsiArr.length) rsi = rsiArr[rsiArr.length - 1];
                }
                if (closes.length >= 26) {
                    const macdArr = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
                    if (macdArr.length >= 2) {
                        const last = macdArr[macdArr.length - 1], prev = macdArr[macdArr.length - 2];
                        macdBull = (last.histogram > 0 && prev.histogram <= 0) || (last.MACD > last.signal && prev.MACD <= prev.signal);
                    }
                }
                if (closes.length >= 21) {
                    const ema9  = EMA.calculate({ values: closes, period: 9 });
                    const ema21 = EMA.calculate({ values: closes, period: 21 });
                    if (ema9.length >= 2 && ema21.length >= 2)
                        emaCross = ema9[ema9.length-1] > ema21[ema21.length-1] && ema9[ema9.length-2] <= ema21[ema21.length-2];
                }
            }
            const price  = q.regularMarketPrice || (closes.length ? closes[closes.length - 1] : 0);
            const change = q.regularMarketChangePercent || 0;
            const extreme = Math.abs(rsi - 50);
            let direction, confBonus = 0;
            if (rsi < 38)      { direction = 'BUY';  if (macdBull || emaCross) confBonus = 8; }
            else if (rsi > 62) { direction = 'SELL'; if (!macdBull) confBonus = 5; }
            else               { direction = 'HOLD'; }
            const action     = rsi < 30 ? 'STRONG BUY' : rsi < 38 ? 'BUY' : rsi > 70 ? 'STRONG SELL' : rsi > 62 ? 'SELL' : 'HOLD';
            const confidence = Math.min(94, Math.round(52 + extreme * 1.3 + confBonus));
            const avgVol     = q.averageDailyVolume10Day || 1;
            const relVol     = +((q.regularMarketVolume || 0) / avgVol).toFixed(2);
            let avgVol7 = 0;
            if (closes.length > 6) {
                const rets = closes.slice(-8).slice(1).map((c, j) => Math.abs((c - closes[closes.length - 8 + j]) / closes[closes.length - 8 + j]) * 100);
                avgVol7 = rets.reduce((s, r) => s + r, 0) / rets.length;
            }
            const high52 = q.fiftyTwoWeekHigh || price * 1.2, low52 = q.fiftyTwoWeekLow || price * 0.8;
            return {
                ticker: sym.replace('.NS', ''), name, cls,
                price: +price.toFixed(2), change: +change.toFixed(2),
                direction, action, confidence,
                bull: Math.round(Math.max(10, 100 - rsi)), bear: Math.round(Math.min(90, rsi)),
                vol: avgVol7 > 2.5 ? 'HIGH' : avgVol7 > 1.2 ? 'MEDIUM' : 'LOW',
                relVol, volSurge: relVol >= 1.5,
                rr: String(+(direction === 'BUY' ? 2.1 : direction === 'SELL' ? 1.8 : 1.5) + (confBonus > 0 ? 0.3 : 0)),
                timeframe: extreme > 20 ? 'Short-term' : 'Intraday',
                geoDriver: (gtiData.events?.[i % Math.max(1, gtiData.events.length)]?.title) || CLS_DRIVERS[cls] || 'Global macro',
                macdBull, emaCross,
                pctFrom52High: +((price / high52 - 1) * 100).toFixed(1),
                pctFrom52Low:  +((price / low52  - 1) * 100).toFixed(1),
                rsi: +rsi.toFixed(1),
            };
        });
        sigCache = signals; sigCacheTs = Date.now();
        res.json(signals);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Live Tape ─────────────────────────────────────────────────────────────────
app.get('/api/livetape', async (_req, res) => {
    if (liveTapeCache.data && Date.now() - liveTapeCache.ts < LIVETAPE_TTL) return res.json(liveTapeCache.data);
    try {
        const quotes = await yahooFinance.quote(NIFTY100_LIST);
        const data = (Array.isArray(quotes) ? quotes : [])
            .filter(q => q?.regularMarketPrice)
            .map(q => ({ symbol: q.symbol, name: (q.shortName || q.symbol.replace('.NS','')).replace(' Ltd.','').replace(' Limited','').replace(' Ltd','').trim().slice(0,18), price: q.regularMarketPrice, change: q.regularMarketChange || 0, changePercent: q.regularMarketChangePercent || 0 }))
            .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
            .slice(0, 15);
        if (data.length) liveTapeCache = { data, ts: Date.now() };
        res.json(liveTapeCache.data || data);
    } catch { res.json(liveTapeCache.data || []); }
});

// ── NSE Indices Bar ───────────────────────────────────────────────────────────
app.get('/api/indicesbar', async (_req, res) => {
    if (indicesBarCache.data && Date.now() - indicesBarCache.ts < INDICESBAR_TTL) return res.json(indicesBarCache.data);
    try {
        const indices = await getNSEIndices();
        const data = NSE_KEY_IDX
            .map(name => indices.find(i => (i.index || i.indexSymbol) === name))
            .filter(Boolean)
            .map(i => ({ name: i.index || i.indexSymbol, price: i.last ?? i.current ?? 0, change: i.variation ?? i.change ?? 0, changePercent: i.percentChange ?? 0 }));
        if (data.length) indicesBarCache = { data, ts: Date.now() };
        res.json(indicesBarCache.data || data);
    } catch { res.json(indicesBarCache.data || []); }
});

// ── Top Movers ────────────────────────────────────────────────────────────────
app.get('/api/movers', async (req, res) => {
    const tf = req.query.tf || '1d';
    if (moversCache[tf] && Date.now() - moversCache[tf].ts < MOVERS_TTL) return res.json(moversCache[tf].data);
    try {
        const [quotes, indices] = await Promise.all([
            yahooFinance.quote(NSE_FNO_LIQUID).catch(() => []),
            yahooFinance.quote(['^NSEI', '^NSEBANK', '^BSESN']).catch(() => []),
        ]);
        const qList = (Array.isArray(quotes) ? quotes : []).filter(q => q?.regularMarketPrice).map(q => ({
            symbol: q.symbol, name: cleanName(q.shortName || q.symbol, q.symbol),
            price: +((q.regularMarketPrice || 0).toFixed(2)), change: +((q.regularMarketChangePercent || 0).toFixed(2)),
            relVol: +((q.regularMarketVolume || 0) / Math.max(1, q.averageDailyVolume10Day || 1)).toFixed(2),
        }));
        const sorted  = [...qList].sort((a, b) => b.change - a.change);
        const gainers = sorted.slice(0, 5);
        const losers  = sorted.slice(-5).reverse();
        const indexData = (Array.isArray(indices) ? indices : []).map(q => ({ symbol: q.symbol, name: q.shortName || q.symbol, price: q.regularMarketPrice, change: +((q.regularMarketChangePercent || 0).toFixed(2)) }));
        const result = { gainers, losers, indices: indexData, tf };
        moversCache[tf] = { data: result, ts: Date.now() };
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Futures / GIFT NIFTY ──────────────────────────────────────────────────────
app.get('/api/futures', async (_req, res) => {
    if (futuresCache.data && Date.now() - futuresCache.ts < FUTURES_TTL) return res.json(futuresCache.data);
    try {
        const [giftRes, yfRes, nseRes] = await Promise.allSettled([
            fetchGiftNifty(),
            yahooFinance.quote(['^DJI', '^GSPC', '^IXIC', 'YM=F', 'NQ=F', 'ES=F', 'CL=F', 'GC=F', 'USDINR=X']),
            getNSEIndices(),
        ]);
        const data = [];
        if (giftRes.status === 'fulfilled') {
            data.push(giftRes.value);
        } else {
            const nseIdxArr = nseRes.status === 'fulfilled' ? nseRes.value : [];
            const niftySpot = nseIdxArr.find(x => (x.index || x.indexSymbol) === 'NIFTY 50');
            if (niftySpot) data.push({ symbol: 'GIFT-NIFTY', name: 'NIFTY 50 (Live)', price: niftySpot.last ?? niftySpot.current, change: niftySpot.variation ?? 0, changePercent: niftySpot.percentChange ?? 0, isLive: true, src: 'NSE Live' });
        }
        const YF_NAMES = { '^DJI':'DOW JONES','^GSPC':'S&P 500','^IXIC':'NASDAQ','YM=F':'DOW FUT','NQ=F':'NASDAQ FUT','ES=F':'S&P FUT','CL=F':'CRUDE OIL','GC=F':'GOLD','USDINR=X':'USD/INR' };
        if (yfRes.status === 'fulfilled') {
            (Array.isArray(yfRes.value) ? yfRes.value : []).forEach(q => data.push({ symbol: q.symbol, name: YF_NAMES[q.symbol] || q.shortName || q.symbol, price: q.regularMarketPrice, change: q.regularMarketChange, changePercent: q.regularMarketChangePercent, isLive: false, src: 'Yahoo' }));
        }
        if (data.length) futuresCache = { data, ts: Date.now() };
        res.json(futuresCache.data || data);
    } catch { res.json(futuresCache.data || []); }
});

// ── Market Breadth ────────────────────────────────────────────────────────────
app.get('/api/marketbreadth', async (_req, res) => {
    if (breadthCache.data && Date.now() - breadthCache.ts < BREADTH_TTL) return res.json(breadthCache.data);
    try {
        const allSyms = [...new Set(Object.values(SECTOR_MAP).flat())];
        const quotes  = await yahooFinance.quote(allSyms).catch(() => []);
        const qMap    = {};
        (Array.isArray(quotes) ? quotes : []).forEach(q => { if (q?.symbol) qMap[q.symbol] = q; });
        let advances = 0, declines = 0, unchanged = 0;
        const sectorData = {};
        for (const [sector, syms] of Object.entries(SECTOR_MAP)) {
            let sAdv = 0, sDec = 0, sUnc = 0, totalChg = 0, count = 0;
            for (const sym of syms) {
                const q = qMap[sym];
                if (!q?.regularMarketChangePercent) continue;
                const chg = q.regularMarketChangePercent; totalChg += chg; count++;
                if (chg > 0.1) { sAdv++; advances++; } else if (chg < -0.1) { sDec++; declines++; } else { sUnc++; unchanged++; }
            }
            sectorData[sector] = { advances: sAdv, declines: sDec, unchanged: sUnc, changePercent: count ? +(totalChg / count).toFixed(2) : 0, count };
        }
        const total = advances + declines + unchanged || 1;
        const adRatio = declines ? +(advances / declines).toFixed(2) : advances > 0 ? 9.99 : 1.00;
        const breadthPct = +((advances / total) * 100).toFixed(1);
        const data = { advances, declines, unchanged, total, adRatio, breadthPct, breadthSignal: breadthPct >= 65 ? 'BULLISH' : breadthPct <= 35 ? 'BEARISH' : 'NEUTRAL', sectors: sectorData };
        breadthCache = { data, ts: Date.now() };
        res.json(data);
    } catch { res.json(breadthCache.data || { advances:0,declines:0,unchanged:0,total:0,adRatio:1,breadthPct:50,breadthSignal:'NEUTRAL',sectors:{} }); }
});

// ── Rates board ───────────────────────────────────────────────────────────────
app.get('/api/rates', async (_req, res) => {
    if (ratesCache.data && Date.now() - ratesCache.ts < RATES_TTL) return res.json(ratesCache.data);
    try {
        const syms = ['USDINR=X','EURINR=X','GBPINR=X','JPYINR=X','GC=F','SI=F','CL=F','NG=F','^TNX','^INDIAVIX'];
        const quotes = await yahooFinance.quote(syms).catch(() => []);
        const NAMES = { 'USDINR=X':'USD/INR','EURINR=X':'EUR/INR','GBPINR=X':'GBP/INR','JPYINR=X':'JPY/INR','GC=F':'GOLD','SI=F':'SILVER','CL=F':'CRUDE OIL','NG=F':'NAT GAS','^TNX':'US 10Y YIELD','^INDIAVIX':'INDIA VIX' };
        const data = (Array.isArray(quotes) ? quotes : []).map(q => ({
            symbol: q.symbol, name: NAMES[q.symbol] || q.symbol,
            price: q.regularMarketPrice, change: q.regularMarketChange || 0, changePercent: q.regularMarketChangePercent || 0,
            unit: ['USDINR=X','EURINR=X','GBPINR=X','JPYINR=X'].includes(q.symbol) ? '₹' : q.symbol === '^TNX' ? '%' : q.symbol === 'CL=F' ? '$' : '',
        }));
        ratesCache = { data, ts: Date.now() };
        res.json(data);
    } catch { res.json(ratesCache.data || []); }
});

// ── Country indices ───────────────────────────────────────────────────────────
app.get('/api/country/:iso', async (req, res) => {
    const iso = req.params.iso.toUpperCase();
    const tickers = COUNTRY_INDICES[iso];
    if (!tickers) return res.json({ iso, tickers: [] });
    if (countryCache[iso] && Date.now() - countryCache[iso].ts < COUNTRY_TTL) return res.json(countryCache[iso].data);
    try {
        const r = await yahooFinance.quote(tickers).catch(() => []);
        const data = { iso, tickers: (Array.isArray(r) ? r : []).map(q => ({ symbol: q.symbol, name: q.shortName || q.longName || q.symbol, price: q.regularMarketPrice, change: q.regularMarketChange, changePercent: q.regularMarketChangePercent, currency: q.currency })) };
        countryCache[iso] = { data, ts: Date.now() };
        res.json(data);
    } catch { res.json({ iso, tickers: [] }); }
});

// ── HFT Advanced Signals ──────────────────────────────────────────────────────
app.get('/api/hft/:ticker', async (req, res) => {
    try {
        const sym = (req.params.ticker || '').toUpperCase().replace(/[^A-Z0-9\^\.=\-\_]/g, '');
        if (!sym || sym.length > 20) return res.status(400).json({ error: 'Invalid ticker' });
        const [quote, chart5m, chart1d] = await Promise.all([
            yahooFinance.quote(sym).catch(() => ({})),
            yahooFinance.chart(sym, { interval: '5m', period1: toPeriod1('5d') }).catch(() => ({ quotes: [] })),
            yahooFinance.chart(sym, { interval: '1d', period1: toPeriod1('1mo') }).catch(() => ({ quotes: [] })),
        ]);
        const q5  = (chart5m?.quotes || []).filter(x => x && x.close != null);
        if (q5.length < 10) return res.json({ error: 'Insufficient data', sym });
        const cl = q5.map(x => x.close), hi = q5.map(x => x.high), lo = q5.map(x => x.low), vo = q5.map(x => x.volume || 0);
        const price = quote.regularMarketPrice || cl[cl.length - 1];

        const atrRaw = ADX.calculate({ high: hi, low: lo, close: cl, period: 14 });
        const atr    = atrRaw.length ? +atrRaw[atrRaw.length - 1].atr?.toFixed(2) : null;
        const atrPct = atr && price ? +((atr / price) * 100).toFixed(2) : null;

        const rsiArr     = RSI.calculate({ values: cl, period: 14 });
        const stochRsiArr = rsiArr.length >= 14 ? Stochastic.calculate({ high: rsiArr, low: rsiArr, close: rsiArr, period: 14, signalPeriod: 3 }) : [];
        const stochRsi   = stochRsiArr.length ? { k: +stochRsiArr[stochRsiArr.length-1].k?.toFixed(2), d: +stochRsiArr[stochRsiArr.length-1].d?.toFixed(2) } : null;

        let vwap = null, vwapUpper1 = null, vwapLower1 = null, vwapUpper2 = null, vwapLower2 = null;
        if (vo.some(v => v > 0)) {
            const tp = q5.map(x => (x.high + x.low + x.close) / 3);
            const totalPV = tp.reduce((s, p, i) => s + p * vo[i], 0), totalV = vo.reduce((a, b) => a + b, 0);
            vwap = totalV > 0 ? +(totalPV / totalV).toFixed(2) : null;
            if (vwap) {
                const vwapStd = Math.sqrt(tp.map((p, i) => vo[i] * Math.pow(p - vwap, 2)).reduce((a, b) => a + b, 0) / totalV);
                vwapUpper1 = +(vwap + vwapStd).toFixed(2);  vwapLower1 = +(vwap - vwapStd).toFixed(2);
                vwapUpper2 = +(vwap + 2*vwapStd).toFixed(2); vwapLower2 = +(vwap - 2*vwapStd).toFixed(2);
            }
        }

        let cvd = 0;
        const cvdArr = q5.map(x => { const range = (x.high - x.low) || 1; cvd += (x.volume || 0) * ((x.close - x.low) / range) - (x.volume || 0) * ((x.high - x.close) / range); return +cvd.toFixed(0); });
        const cvdTrend = cvdArr.length >= 6 ? (cvdArr[cvdArr.length-1] > cvdArr[cvdArr.length-6] ? 'BUYING' : 'SELLING') : 'NEUTRAL';

        const zPeriod = Math.min(20, cl.length), zSlice = cl.slice(-zPeriod);
        const zMean = zSlice.reduce((a, b) => a + b, 0) / zPeriod;
        const zScore = +(price - zMean) / (Math.sqrt(zSlice.reduce((s, v) => s + Math.pow(v - zMean, 2), 0) / zPeriod) || 1);

        const volByPrice = {};
        q5.forEach(x => { const b = Math.round((x.high + x.low) / 2 / 50) * 50; volByPrice[b] = (volByPrice[b] || 0) + (x.volume || 0); });
        const poc = Object.entries(volByPrice).sort((a, b) => b[1] - a[1])[0];

        const avgVol = vo.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, vo.length - 1);
        const volSpikeRatio = avgVol > 0 ? +(vo[vo.length - 1] / avgVol).toFixed(2) : null;

        let signalStrength = 0;
        if (stochRsi?.k < 20) signalStrength += 2; if (stochRsi?.k > 80) signalStrength -= 2;
        if (vwap && price > vwap) signalStrength += 1; if (vwap && price < vwap) signalStrength -= 1;
        if (cvdTrend === 'BUYING') signalStrength += 1; if (cvdTrend === 'SELLING') signalStrength -= 1;
        if (zScore < -2) signalStrength += 2; if (zScore > 2) signalStrength -= 2;
        const signal = signalStrength >= 3 ? 'STRONG BUY' : signalStrength >= 1 ? 'BUY' : signalStrength <= -3 ? 'STRONG SELL' : signalStrength <= -1 ? 'SELL' : 'NEUTRAL';

        res.json({ sym, price, signal, signalStrength, atr, atrPct, stochRsi, vwap, vwapUpper1, vwapLower1, vwapUpper2, vwapLower2, cvdCurrent: +cvdArr[cvdArr.length-1]?.toFixed(0), cvdTrend, cvdArr: cvdArr.slice(-50), zScore: +zScore.toFixed(2), pointOfControl: poc ? +poc[0] : null, volSpikeRatio, regimes: atrPct ? (atrPct < 0.5 ? 'LOW_VOL' : atrPct < 1.5 ? 'NORMAL' : 'HIGH_VOL') : 'UNKNOWN' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── F&O Intraday Scanner ──────────────────────────────────────────────────────
app.get('/api/fo-scanner', async (_req, res) => {
    if (foCache && Date.now() - foCacheTs < 5 * 60 * 1000) return res.json(foCache);
    try {
        const syms   = FO_STOCKS.map(s => s.sym);
        const quotes = await yahooFinance.quote(syms).catch(() => []);
        const qMap   = {};
        (Array.isArray(quotes) ? quotes : []).forEach(q => { if (q?.symbol) qMap[q.symbol] = q; });
        const p5d    = toPeriod1('5d');
        const charts = await Promise.allSettled(syms.map(sym => yahooFinance.chart(sym, { interval: '15m', period1: p5d }).catch(() => null)));
        const R      = 0.065;
        const now    = new Date();
        const daysToExpiry = ((4 - now.getDay() + 7) % 7) || 7;
        const T = Math.max(daysToExpiry / 365, 1 / 365);

        const results = FO_STOCKS.map(({ sym, name }, i) => {
            const q = qMap[sym] || {};
            const price = q.regularMarketPrice;
            if (!price) return null;
            const candles = ((charts[i].status === 'fulfilled' ? charts[i].value?.quotes : null) || []).filter(x => x && x.close != null);
            if (candles.length < 14) return null;
            const cl = candles.map(x => x.close), hi = candles.map(x => x.high), lo = candles.map(x => x.low), vo = candles.map(x => x.volume || 0);
            const rsi      = RSI.calculate({ values: cl, period: 14 }).pop() || 50;
            const ema9arr  = EMA.calculate({ values: cl, period: 9 });
            const ema21arr = EMA.calculate({ values: cl, period: 21 });
            const emaTrend = ema9arr.length && ema21arr.length ? (ema9arr[ema9arr.length-1] > ema21arr[ema21arr.length-1] ? 'UP' : 'DOWN') : 'FLAT';
            const atrRaw   = ADX.calculate({ high: hi, low: lo, close: cl, period: 14 });
            const atr      = atrRaw.length ? atrRaw[atrRaw.length-1].atr || null : null;
            let vwap       = null;
            if (vo.some(v => v > 0)) { const tp = candles.map(x => (x.high+x.low+x.close)/3); const tv = vo.reduce((a,b)=>a+b,0); vwap = tv > 0 ? tp.reduce((s,p,j)=>s+p*vo[j],0)/tv : null; }
            const returns  = cl.slice(1).map((c, j) => Math.log(c / cl[j]));
            const retMean  = returns.reduce((a,b)=>a+b,0)/returns.length;
            const sigma    = Math.max(0.15, Math.min(Math.sqrt(returns.reduce((s,r)=>s+Math.pow(r-retMean,2),0)/returns.length * 26*252), 2.0));
            let score = 0;
            if (rsi < 30) score += 25; else if (rsi < 40) score += 15; else if (rsi > 70) score -= 25; else if (rsi > 60) score -= 15;
            if (emaTrend === 'UP') score += 15; if (emaTrend === 'DOWN') score -= 15;
            if (vwap && price > vwap * 1.002) score += 10; if (vwap && price < vwap * 0.998) score -= 10;
            const avgVol = vo.slice(0,-1).reduce((a,b)=>a+b,0)/Math.max(1,vo.length-1), lastVol = vo[vo.length-1];
            const volRatio = avgVol > 0 ? lastVol/avgVol : 1;
            if (volRatio > 2) score += 15; else if (volRatio > 1.5) score += 8;
            if (q.fiftyTwoWeekLow && q.fiftyTwoWeekHigh) { const pos = (price-q.fiftyTwoWeekLow)/(q.fiftyTwoWeekHigh-q.fiftyTwoWeekLow+1); if (pos < 0.2) score += 10; if (pos > 0.85) score += 5; }
            let signal;
            if (score >= 30) signal = 'CE'; else if (score <= -30) signal = 'PE'; else if (score >= 15) signal = 'CE'; else if (score <= -15) signal = 'PE'; else return null;
            const si  = price > 2000 ? 100 : price > 500 ? 50 : 20;
            const atm = Math.round(price / si) * si, otm = signal === 'CE' ? atm + si : atm - si;
            const premAtm = signal === 'CE' ? bsCall(price, atm, T, R, sigma) : bsPut(price, atm, T, R, sigma);
            const premOtm = signal === 'CE' ? bsCall(price, otm, T, R, sigma) : bsPut(price, otm, T, R, sigma);
            const atrVal  = atr || price * 0.01;
            return { sym, name, price: +price.toFixed(2), signal, rsi: +rsi.toFixed(1), emaTrend, vwap: vwap ? +vwap.toFixed(2) : null, volRatio: +volRatio.toFixed(2), atr: atr ? +atr.toFixed(2) : null, iv: +(sigma*100).toFixed(1), strike: atm, otmStrike: otm, premium: +premAtm.toFixed(2), premOtm: +premOtm.toFixed(2), stopLoss: signal==='CE' ? +(price-atrVal*1.5).toFixed(2) : +(price+atrVal*1.5).toFixed(2), target: signal==='CE' ? +(price+atrVal*3).toFixed(2) : +(price-atrVal*3).toFixed(2), optTarget: +(premAtm*2.5).toFixed(2), optStop: +(premAtm*0.4).toFixed(2), strength: Math.abs(score), change: q.regularMarketChangePercent ? +q.regularMarketChangePercent.toFixed(2) : 0 };
        }).filter(Boolean).sort((a, b) => b.strength - a.strength).slice(0, 15);

        foCache = results; foCacheTs = Date.now();
        res.json(results);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Symbol Search ─────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    try {
        const result = await yahooFinance.search(q, { newsCount: 0, quotesCount: 15 }).catch(() => ({ quotes: [] }));
        const yf = (result.quotes || [])
            .filter(r => r.isYahooFinance && ['EQUITY','INDEX','ETF','MUTUALFUND'].includes(r.quoteType))
            .map(r => ({ symbol: r.symbol, name: r.shortname || r.longname || r.symbol, exchange: r.exchange === 'NSI' ? 'NSE' : r.exchange === 'BOM' ? 'BSE' : (r.exchange || ''), type: r.quoteType }));
        const ql    = q.toLowerCase();
        const local = SIG_STOCKS.filter(s => s.name.toLowerCase().includes(ql) || s.sym.toLowerCase().includes(ql)).map(s => ({ symbol: s.sym, name: s.name, exchange: 'NSE', type: 'EQUITY' }));
        const seen  = new Set(local.map(s => s.symbol));
        res.json([...local, ...yf.filter(r => !seen.has(r.symbol))].slice(0, 10));
    } catch { res.json([]); }
});

// ── NSE Option Chain (live) ───────────────────────────────────────────────────
app.get('/api/nse-option-chain', async (req, res) => {
    try {
        const symbol = (req.query.symbol || 'NIFTY').toUpperCase().replace(/[^A-Z]/g, '');
        const data = await fetchNSEOptionChain(symbol);
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── NSE PCR (Put-Call Ratio from Bhavcopy) ────────────────────────────────────
app.get('/api/pcr', async (_req, res) => {
    try { res.json(await getLivePCR()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Algo trades (Python algo_trades.json bridge) ──────────────────────────────
const ALGO_TRADES_FILE = path.join(__dirname, '..', 'algo_trades.json');

app.get('/api/algo-trades', (req, res) => {
    try {
        if (fs.existsSync(ALGO_TRADES_FILE)) {
            res.json(JSON.parse(fs.readFileSync(ALGO_TRADES_FILE, 'utf8')));
        } else {
            res.json({ strategy: 'namit-l1', deployment_id: '', trades: [], session_pnl: 0, position: null, updated_at: null });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/algo-trades', express.json(), (req, res) => {
    try {
        fs.writeFileSync(ALGO_TRADES_FILE, JSON.stringify({ ...req.body, updated_at: new Date().toISOString() }, null, 2));
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Namit's Personal 2-Layer F&O Model ───────────────────────────────────────
app.get('/api/personal-model', async (_req, res) => {
    if (personalModelCache && Date.now() - pmCacheTs < 3 * 60 * 1000) return res.json(personalModelCache);
    try {
        const now = new Date();
        const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const month = ist.getMonth(), day = ist.getDay(), mins = ist.getHours() * 60 + ist.getMinutes();
        const isMarketHours = day >= 1 && day <= 5 && mins >= 555 && mins < 930;

        const [niftyQ, vixQ, bankQ, newsRes, niftyChart, bankChart, bhavResult] = await Promise.all([
            yahooFinance.quote('^NSEI').catch(() => null),
            yahooFinance.quote('^INDIAVIX').catch(() => null),
            yahooFinance.quote('^NSEBANK').catch(() => null),
            fetch(`http://localhost:${process.env.PORT || 3000}/api/globalnews`).then(r => r.json()).catch(() => []),
            yahooFinance.chart('^NSEI',    { interval: '5m', period1: toPeriod1('5d') }).catch(() => null),
            yahooFinance.chart('^NSEBANK', { interval: '5m', period1: toPeriod1('5d') }).catch(() => null),
            getLivePCR().catch(() => null),
        ]);

        const niftyPrice = niftyQ?.regularMarketPrice || 0;
        const niftyChange= niftyQ?.regularMarketChangePercent || 0;
        const vix        = vixQ?.regularMarketPrice || 15;
        const bankNifty  = bankQ?.regularMarketPrice || 0;
        const bankChange = bankQ?.regularMarketChangePercent || 0;

        // Layer 1: Sentiment
        const sentTexts = (Array.isArray(newsRes) ? newsRes : []).slice(0, 20).map(n => n.headline || n.title || '');
        let rawSentScore = 0, strongBullCount = 0, strongBearCount = 0;
        sentTexts.forEach(t => {
            const tl = t.toLowerCase(); let ts = 0;
            LM_STRONG_BULL.forEach(w => { if (tl.includes(w)) { ts += 2; strongBullCount++; } });
            LM_BULL.forEach(w => { if (tl.includes(w)) ts += 1; });
            LM_STRONG_BEAR.forEach(w => { if (tl.includes(w)) { ts -= 2; strongBearCount++; } });
            LM_BEAR.forEach(w => { if (tl.includes(w)) ts -= 1; });
            rawSentScore += ts;
        });
        const sentNorm = Math.max(0, Math.min(25, 12.5 + rawSentScore * 0.8));
        const sentLabel = rawSentScore >= 4 ? 'STRONG BULL' : rawSentScore >= 1 ? 'BULL' : rawSentScore <= -4 ? 'STRONG BEAR' : rawSentScore <= -1 ? 'BEAR' : 'NEUTRAL';
        const sentDoubleCheck = strongBearCount > strongBullCount + 2 ? 'CONFIRMED_BEAR' : strongBullCount > strongBearCount + 2 ? 'CONFIRMED_BULL' : 'MIXED';

        // Layer 1: VIX
        const vixScore = vix < 12 ? 25 : vix < 15 ? 22 : vix < 18 ? 18 : vix < 22 ? 12 : vix < 28 ? 6 : 2;
        const vixLabel = vix < 12 ? 'VERY LOW (Buy cheap options)' : vix < 15 ? 'LOW (Favourable)' : vix < 18 ? 'MODERATE' : vix < 22 ? 'ELEVATED' : vix < 28 ? 'HIGH (Size down)' : 'EXTREME (Avoid buying)';

        // Layer 1: Month score
        const mData = TRADER_EDGE.monthly[month] || { m: '', wr: 40, pnl: 0 };
        const monthScore = mData.wr >= 55 ? 25 : mData.wr >= 48 ? 20 : mData.wr >= 43 ? 15 : mData.wr >= 38 ? 8 : 3;
        const monthLabel = mData.wr >= 55 ? `${mData.m} is your BEST month (${mData.wr}% WR)` : mData.wr >= 48 ? `${mData.m} is above-average (${mData.wr}% WR)` : mData.wr >= 43 ? `${mData.m} is average (${mData.wr}% WR)` : `${mData.m} is a weak month (${mData.wr}% WR) — size down`;

        // Layer 1: Trend
        const trendScore = niftyChange > 1 ? 25 : niftyChange > 0.3 ? 20 : niftyChange > 0 ? 14 : niftyChange > -0.5 ? 8 : 2;
        const trendLabel = niftyChange > 1 ? 'STRONG BULL DAY' : niftyChange > 0.3 ? 'MODERATE BULL' : niftyChange > 0 ? 'MILD BULL' : niftyChange > -0.5 ? 'MILD BEAR' : 'STRONG BEAR';

        const layer1Total = sentNorm + vixScore + monthScore + trendScore;
        const layer1Pass  = layer1Total >= 55;

        // Layer 2: Technical indicators
        const niftyQuotes = (niftyChart?.quotes || []).filter(x => x && x.close != null);
        const niftyCl     = niftyQuotes.map(x => x.close);
        const niftyVol    = niftyQuotes.map(x => x.volume || 0);

        let rsiVal = 50, emaSignal = 'NEUTRAL', vwapRelation = 'UNKNOWN', atrVal = 0;
        let macdVal = 0, macdSignal = 0, macdHist = 0, macdCross = 'NEUTRAL';
        let stochRsiK = null;

        if (niftyCl.length >= 26) {
            const rsiArr = btRSI(niftyCl); rsiVal = +(rsiArr[rsiArr.length-1] || 50).toFixed(1);
            const e9 = btEMA(niftyCl, 9), e21 = btEMA(niftyCl, 21);
            emaSignal = (e9[e9.length-1] || 0) > (e21[e21.length-1] || 0) ? 'BULL' : 'BEAR';
            const atrArr = btATR(niftyQuotes); atrVal = +(atrArr[atrArr.length-1] || 0).toFixed(1);
            const macdH = btMACD(niftyCl); const mLast = macdH[macdH.length-1] || 0, mPrev = macdH[macdH.length-2] || 0;
            macdHist = mLast;
            macdCross = mLast > 0 && mPrev <= 0 ? 'BULL' : mLast < 0 && mPrev >= 0 ? 'BEAR' : mLast > 0 ? 'BULL_HOLD' : mLast < 0 ? 'BEAR_HOLD' : 'NEUTRAL';
            if (niftyVol.some(v => v > 0)) {
                const vwapArr = btVWAP(niftyQuotes);
                const lastVwap = vwapArr[vwapArr.length-1];
                vwapRelation = lastVwap ? (niftyCl[niftyCl.length-1] > lastVwap ? 'ABOVE' : 'BELOW') : 'UNKNOWN';
            }
        }

        const avgVol5 = niftyVol.slice(-11, -1).reduce((a, b) => a + b, 0) / 10 || 1;
        const volRatio = +(niftyVol[niftyVol.length-1] / avgVol5).toFixed(2);

        // ATM calculation
        const atmStrike = Math.round(niftyPrice / 50) * 50;
        const atm = atmStrike;
        const pcr = bhavResult?.pcr || null;
        const maxPainStr = bhavResult?.maxPain ? String(bhavResult.maxPain) : null;
        const suggestedStrike = atm;

        // Technical score
        const techScore = (() => {
            let s = 0;
            if (rsiVal > 55 && rsiVal < 70) s += 15; else if (rsiVal < 45 && rsiVal > 30) s += 10; else if (rsiVal >= 70 || rsiVal <= 30) s += 5; else s += 12;
            if (emaSignal === 'BULL') s += 15; else if (emaSignal === 'BEAR') s += 5;
            if (vwapRelation === 'ABOVE') s += 10; else if (vwapRelation === 'BELOW') s += 5; else s += 7;
            if (atrVal > 0) { const atrPct = (atrVal / niftyPrice) * 100; if (atrPct > 0.3 && atrPct < 0.8) s += 10; else s += 5; }
            return Math.min(s, 50);
        })();
        const techLabel = techScore >= 40 ? 'STRONG TECHNICAL SETUP' : techScore >= 30 ? 'GOOD SETUP' : techScore >= 20 ? 'NEUTRAL SETUP' : 'WEAK SETUP';

        // Volume score
        const volScore = volRatio > 2 ? 15 : volRatio > 1.5 ? 12 : volRatio > 1.2 ? 9 : volRatio > 0.8 ? 6 : 3;
        const volLabel = volRatio > 2 ? 'VERY HIGH VOLUME (strong conviction)' : volRatio > 1.5 ? 'HIGH VOLUME' : volRatio > 1.2 ? 'ABOVE AVERAGE' : volRatio > 0.8 ? 'NORMAL' : 'LOW VOLUME';

        // IV / VIX score for Layer 2
        const ivScore = vix < 14 ? 15 : vix < 18 ? 12 : vix < 22 ? 8 : vix < 28 ? 4 : 2;
        const ivLabel = vix < 14 ? 'CHEAP OPTIONS' : vix < 18 ? 'FAIR PREMIUM' : vix < 22 ? 'ELEVATED PREMIUM' : 'EXPENSIVE';

        // PCR score
        const pcrScore = pcr ? (pcr > 1.3 ? 15 : pcr > 1.0 ? 12 : pcr > 0.8 ? 8 : pcr > 0.6 ? 5 : 3) : 8;
        const pcrLabel = pcr ? (pcr > 1.3 ? 'VERY BULLISH (heavy put writing)' : pcr > 1.0 ? 'BULLISH' : pcr > 0.8 ? 'NEUTRAL' : 'BEARISH (heavy call writing)') : 'PCR unavailable';

        // Pattern score (placeholder)
        const patternScore = macdCross.includes('BULL') && emaSignal === 'BULL' ? 15 : macdCross.includes('BEAR') && emaSignal === 'BEAR' ? 15 : 8;
        const patternLabel = macdCross.includes('BULL') && emaSignal === 'BULL' ? 'BULL CONFLUENCE' : macdCross.includes('BEAR') && emaSignal === 'BEAR' ? 'BEAR CONFLUENCE' : 'NO CLEAR PATTERN';

        const layer2Total = techScore + volScore + ivScore + pcrScore + patternScore;
        const layer2Pass  = layer2Total >= 48;

        const combinedScore = layer1Total * 0.4 + layer2Total * 0.6;
        const finalSignal   = combinedScore >= 68 ? 'PRIME TRADE' : combinedScore >= 55 ? 'TRADE' : combinedScore >= 42 ? 'WAIT' : 'NO TRADE';
        const signalColor   = finalSignal === 'PRIME TRADE' ? '#10b981' : finalSignal === 'TRADE' ? '#3b82f6' : finalSignal === 'WAIT' ? '#eab308' : '#ef4444';
        const action        = finalSignal === 'PRIME TRADE' ? 'ENTER NOW' : finalSignal === 'TRADE' ? 'PREPARE ENTRY' : finalSignal === 'WAIT' ? 'OBSERVE' : 'STAY FLAT';

        // Edge alerts
        const edgeAlerts = [];
        if (TRADER_EDGE.avoidStocks.some(s => s === 'RELIANCE' || s === 'SENSEX')) edgeAlerts.push({ type: 'AVOID', msg: 'Historical edge: avoid RELIANCE & SENSEX options' });
        if (mData.wr < 38) edgeAlerts.push({ type: 'CAUTION', msg: `${mData.m}: your weakest month — halve position size` });
        if (vix > 22) edgeAlerts.push({ type: 'CAUTION', msg: 'VIX elevated — buy premium spikes not average in' });
        if (volRatio < 0.7) edgeAlerts.push({ type: 'INFO', msg: 'Low volume day — wait for volume confirmation' });

        // BankNifty indicators
        const bankQuotes = (bankChart?.quotes || []).filter(x => x && x.close != null);
        const bankCl = bankQuotes.map(x => x.close);
        let bankRsi = 50, bankEma = 'NEUTRAL', bankMacdCross = 'NEUTRAL', bankChange2 = bankChange;
        if (bankCl.length >= 26) {
            const bRsi = btRSI(bankCl); bankRsi = +(bRsi[bRsi.length-1] || 50).toFixed(1);
            const be9 = btEMA(bankCl, 9), be21 = btEMA(bankCl, 21);
            bankEma = (be9[be9.length-1] || 0) > (be21[be21.length-1] || 0) ? 'BULL' : 'BEAR';
            const bMacd = btMACD(bankCl); const bl = bMacd[bMacd.length-1] || 0, bp = bMacd[bMacd.length-2] || 0;
            bankMacdCross = bl > 0 && bp <= 0 ? 'BULL' : bl < 0 && bp >= 0 ? 'BEAR' : bl > 0 ? 'BULL_HOLD' : bl < 0 ? 'BEAR_HOLD' : 'NEUTRAL';
        }
        const bAtm = Math.round(bankNifty / 100) * 100;
        const bnfAtr = bankQuotes.length >= 15 ? (btATR(bankQuotes).pop() || bankNifty * 0.005) : bankNifty * 0.005;

        // Swing high/low (5-day)
        const swingHighs = niftyQuotes.slice(-26).map(x => x.high).filter(Boolean);
        const swingLows  = niftyQuotes.slice(-26).map(x => x.low).filter(v => v > 0);
        const swingHigh  = swingHighs.length ? Math.max(...swingHighs) : null;
        const swingLow   = swingLows.length  ? Math.min(...swingLows)  : null;
        const aboveResistance = swingHigh && niftyPrice > swingHigh;
        const nearSupport     = swingLow  && niftyPrice < swingLow * 1.005;

        // Trade suggestions
        const tradeSuggestions = [];
        const fp = (n) => n ? n.toFixed(2) : '—';
        const nBull = (tgt, sl) => ({ entry: `${fp(niftyPrice)} (${atm} CE)`, target: `${fp(niftyPrice + tgt * atrVal)}\n+${(tgt * atrVal).toFixed(0)} pts`, stopLoss: `${fp(niftyPrice - sl * atrVal)}\n-${(sl * atrVal).toFixed(0)} pts` });
        const nBear = (tgt, sl) => ({ entry: `${fp(niftyPrice)} (${atm} PE)`, target: `${fp(niftyPrice - tgt * atrVal)}\n-${(tgt * atrVal).toFixed(0)} pts`, stopLoss: `${fp(niftyPrice + sl * atrVal)}\n+${(sl * atrVal).toFixed(0)} pts` });
        const bBull = (tgt, sl) => ({ entry: `${fp(bankNifty)} (${bAtm} CE)`, target: `${fp(bankNifty + tgt)}\n+${tgt} pts`, stopLoss: `${fp(bankNifty - sl)}\n-${sl} pts` });
        const bBear = (tgt, sl) => ({ entry: `${fp(bankNifty)} (${bAtm} PE)`, target: `${fp(bankNifty - tgt)}\n-${tgt} pts`, stopLoss: `${fp(bankNifty + sl)}\n+${sl} pts` });

        const addTrade = (t) => { if (!tradeSuggestions.find(x => x.id === t.id)) tradeSuggestions.push(t); };

        // Trade signals (condensed — same logic as original server.js)
        if (layer1Pass && layer2Pass && macdCross === 'BULL' && emaSignal === 'BULL') addTrade({ id:'prime-bull', instrument:'NIFTY', type:'CE', strike:atm, setup:'Prime Bullish Confluence', tags:['PRIME','L1+L2','MACD','EMA'], confidence:'HIGH', ...nBull(1.5,1), logic:`Both layers pass (${layer1Total.toFixed(0)}+${layer2Total.toFixed(0)}). MACD crossed bull + EMA bull.`, riskReward:'1:2' });
        if (layer1Pass && layer2Pass && macdCross === 'BEAR' && emaSignal === 'BEAR') addTrade({ id:'prime-bear', instrument:'NIFTY', type:'PE', strike:atm, setup:'Prime Bearish Confluence', tags:['PRIME','L1+L2','MACD','EMA'], confidence:'HIGH', ...nBear(1.5,1), logic:`Both layers pass. MACD + EMA bear aligned.`, riskReward:'1:2' });
        if (macdCross === 'BULL' && emaSignal === 'BULL' && rsiVal > 45 && rsiVal < 70) addTrade({ id:'macd-bull', instrument:'NIFTY', type:'CE', strike:atm, setup:'MACD Bullish Crossover + EMA Bull', tags:['MACD','EMA','MOMENTUM'], confidence:layer1Pass?'HIGH':'MEDIUM', ...nBull(1.2,0.8), logic:`MACD hist turned positive. EMA bull. RSI ${rsiVal} in sweet spot.`, riskReward:'1:2' });
        if (macdCross === 'BEAR' && emaSignal === 'BEAR' && rsiVal < 55 && rsiVal > 30) addTrade({ id:'macd-bear', instrument:'NIFTY', type:'PE', strike:atm, setup:'MACD Bearish Crossover + EMA Bear', tags:['MACD','EMA','BREAKDOWN'], confidence:layer1Pass?'HIGH':'MEDIUM', ...nBear(1.2,0.8), logic:`MACD hist turned negative. EMA bear. RSI ${rsiVal}.`, riskReward:'1:2' });
        if (vwapRelation === 'ABOVE' && emaSignal === 'BULL' && volRatio > 1.2) addTrade({ id:'vwap-bull', instrument:'NIFTY', type:'CE', strike:atm, setup:'VWAP Bull + Volume Confirmation', tags:['VWAP','VOLUME','TREND'], confidence:volRatio>1.8?'HIGH':'MEDIUM', ...nBull(1.0,0.7), logic:`Price above VWAP with ${volRatio}× volume. EMA bull trend intact.`, riskReward:'1:1.5' });
        if (vwapRelation === 'BELOW' && emaSignal === 'BEAR' && volRatio > 1.2) addTrade({ id:'vwap-bear', instrument:'NIFTY', type:'PE', strike:atm, setup:'VWAP Bear + Volume Confirmation', tags:['VWAP','VOLUME','TREND'], confidence:volRatio>1.8?'HIGH':'MEDIUM', ...nBear(1.0,0.7), logic:`Price below VWAP with ${volRatio}× volume. EMA bear.`, riskReward:'1:1.5' });
        if (rsiVal < 42 && volRatio > 1.3 && niftyChange > 0) addTrade({ id:'short-covering', instrument:'NIFTY', type:'CE', strike:atm, setup:'Short Covering Rally Setup', tags:['SHORT COVERING','VOLUME','REVERSAL'], confidence:volRatio>1.8&&emaSignal==='BULL'?'HIGH':'MEDIUM', ...nBull(1.0,0.6), logic:`RSI oversold at ${rsiVal}. NIFTY ticking up with ${volRatio}× volume.`, riskReward:'1:2' });
        if (aboveResistance && swingHigh) addTrade({ id:'resistance-break', instrument:'NIFTY', type:'CE', strike:atm+50, setup:`Resistance Breakout — Above ${swingHigh.toFixed(0)}`, tags:['BREAKOUT','RESISTANCE','MOMENTUM'], confidence:volRatio>1.5?'HIGH':'MEDIUM', entry:`${fp(niftyPrice)}\n${atm+50} CE (OTM)`, target:`${fp(niftyPrice+Math.round(atrVal))}\n+${Math.round(atrVal)} pts`, stopLoss:`${fp(swingHigh)}\nbreakout level`, logic:`Broke above 5-day swing high ${swingHigh.toFixed(0)}.`, riskReward:'1:2' });
        if (nearSupport && swingLow) addTrade({ id:'support-hold', instrument:'NIFTY', type:'CE', strike:atm, setup:`Support Bounce — Near ${swingLow.toFixed(0)}`, tags:['SUPPORT','BOUNCE','REVERSAL'], confidence:'MEDIUM', entry:`${fp(niftyPrice)} (${atm} CE · support)`, target:`${fp(swingLow+atrVal*1.5)}\n38.2% Fib`, stopLoss:`${fp(swingLow*0.997)}\n−0.3% support`, logic:`NIFTY testing 5-day support at ${swingLow.toFixed(0)}. RSI ${rsiVal}.`, riskReward:'1:1.8' });
        if ((bankMacdCross==='BULL'||bankMacdCross==='BULL_HOLD') && bankRsi > 42 && bankEma==='BULL') addTrade({ id:'bank-macd-bull', instrument:'BANKNIFTY', type:'CE', strike:bAtm, setup:'BankNifty MACD Bullish', tags:['BANKNIFTY','MACD','TREND'], confidence:'MEDIUM', ...bBull(Math.round(bnfAtr*1.5),Math.round(bnfAtr*0.8)), logic:`BankNifty MACD bullish. RSI ${bankRsi}.`, riskReward:'1:2' });
        if ((bankMacdCross==='BEAR'||bankMacdCross==='BEAR_HOLD') && bankRsi < 58 && bankEma==='BEAR') addTrade({ id:'bank-macd-bear', instrument:'BANKNIFTY', type:'PE', strike:bAtm, setup:'BankNifty MACD Bearish', tags:['BANKNIFTY','MACD','BREAKDOWN'], confidence:'MEDIUM', ...bBear(Math.round(bnfAtr*1.5),Math.round(bnfAtr*0.8)), logic:`BankNifty MACD bearish. RSI ${bankRsi}.`, riskReward:'1:2' });
        if (Math.abs(niftyChange) > 0.4) addTrade({ id:'trend-momentum', instrument:'NIFTY', type:niftyChange>0?'CE':'PE', strike:atm, setup:`${niftyChange>0?'Bullish':'Bearish'} Trending Day`, tags:['TRENDING','INTRADAY'], confidence:Math.abs(niftyChange)>0.7?'HIGH':'MEDIUM', ...(niftyChange>0?nBull(1.5,1):nBear(1.5,1)), logic:`NIFTY ${niftyChange>0?'up':'down'} ${Math.abs(niftyChange).toFixed(2)}% — trending session.`, riskReward:'1:1.5' });

        // Baseline always-on reads
        const niftyDir = (emaSignal==='BULL'||niftyChange>0||macdCross.includes('BULL')) ? 'CE' : 'PE';
        addTrade({ id:'nifty-baseline', instrument:'NIFTY', type:niftyDir, strike:atm, setup:`NIFTY Live Read — ${niftyDir==='CE'?'Bullish':'Bearish'} Bias`, tags:[`EMA ${emaSignal}`,`RSI ${rsiVal}`,`VWAP ${vwapRelation}`], confidence:'MEDIUM', ...(niftyDir==='CE'?nBull(1.5,1):nBear(1.5,1)), logic:`EMA ${emaSignal} · RSI ${rsiVal} · VWAP ${vwapRelation} · NIFTY ${niftyChange>0?'+':''}${niftyChange.toFixed(2)}% · MACD ${macdCross}.`, riskReward:'1:1.5' });
        if (bAtm > 0) { const bankDir = (bankEma==='BULL'||bankMacdCross.includes('BULL')||bankChange>0)?'CE':'PE'; addTrade({ id:'banknifty-baseline', instrument:'BANKNIFTY', type:bankDir, strike:bAtm, setup:`BankNifty Live Read — ${bankDir==='CE'?'Bullish':'Bearish'} Bias`, tags:[`EMA ${bankEma}`,`RSI ${bankRsi}`], confidence:'MEDIUM', ...(bankDir==='CE'?bBull(Math.round(bnfAtr*1.5),Math.round(bnfAtr*0.8)):bBear(Math.round(bnfAtr*1.5),Math.round(bnfAtr*0.8))), logic:`BankNifty: EMA ${bankEma} · RSI ${bankRsi} · MACD ${bankMacdCross}.`, riskReward:'1:2' }); }

        const confOrder = { HIGH:0, MEDIUM:1, LOW:2 };
        tradeSuggestions.sort((a, b) => (confOrder[a.confidence]??3) - (confOrder[b.confidence]??3));

        const X_EXPERTS = [
            { name:'Nilesh Shah',        handle:'nileshshah_60',   org:'Kotak AMC MD',          url:'https://x.com/nileshshah_60',   type:'macro'     },
            { name:'Chandan Taparia',    handle:'chandhantaparia', org:'Motilal Oswal',          url:'https://x.com/chandhantaparia', type:'f&o'       },
            { name:'Rajesh Palviya',     handle:'rajeshpalviya_',  org:'Axis Securities',        url:'https://x.com/rajeshpalviya_',  type:'technical' },
            { name:'NSE India',          handle:'NSEIndia',        org:'NSE Official',           url:'https://x.com/NSEIndia',        type:'official'  },
            { name:'ET Markets',         handle:'ETMarkets',       org:'Economic Times',         url:'https://x.com/ETMarkets',       type:'news'      },
            { name:'CNBC TV18',          handle:'CNBCTV18News',    org:'CNBC-TV18 Official',     url:'https://x.com/CNBCTV18News',    type:'news'      },
            { name:'Vivek Bajaj',        handle:'marketgurukul',   org:'StockEdge / Market Guru',url:'https://x.com/marketgurukul',  type:'f&o'       },
        ];

        const result = {
            timestamp: new Date().toISOString(),
            isMarketHours, niftyPrice, niftyChange, vix, bankNifty, bankChange,
            macd: { value: macdVal, signal: macdSignal, histogram: macdHist, cross: macdCross },
            bankNiftyIndicators: { rsi: bankRsi, ema: bankEma, macdCross: bankMacdCross },
            levels: { swingHigh, swingLow, maxPain: maxPainStr },
            tradeSuggestions, xExperts: X_EXPERTS,
            layer1: { score:+layer1Total.toFixed(1), pass:layer1Pass, signals:{ sentiment:{score:+sentNorm.toFixed(1),label:sentLabel,doubleCheck:sentDoubleCheck,rawScore:rawSentScore,strongBull:strongBullCount,strongBear:strongBearCount}, vix:{score:vixScore,value:+vix.toFixed(1),label:vixLabel}, month:{score:monthScore,month:mData.m,wr:mData.wr,pnl:mData.pnl,label:monthLabel}, trend:{score:trendScore,change:+niftyChange.toFixed(2),label:trendLabel} } },
            layer2: { score:+layer2Total.toFixed(1), pass:layer2Pass, signals:{ technical:{score:techScore,rsi:rsiVal,ema:emaSignal,vwap:vwapRelation,atr:atrVal,stochRsi:stochRsiK,label:techLabel}, volume:{score:volScore,ratio:volRatio,label:volLabel}, iv:{score:ivScore,vix:+vix.toFixed(1),label:ivLabel}, pcr:{score:pcrScore,value:pcr,label:pcrLabel}, pattern:{score:patternScore,label:patternLabel} }, options:{ atmStrike, maxPain:maxPainStr, suggested:suggestedStrike, pcr } },
            recommendation: { signal:finalSignal, color:signalColor, action, combinedScore:+combinedScore.toFixed(1), holdRule:'INTRADAY ONLY (exit by 15:15 IST)', edgeAlerts },
            traderProfile: TRADER_EDGE,
        };
        personalModelCache = result; pmCacheTs = Date.now();
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Backtest Engine ───────────────────────────────────────────────────────────
app.get('/api/backtest', async (req, res) => {
    try {
        const { strategy = 'vwap-trend', period = '1y', interval = '1h' } = req.query;
        const months = period === '2y' ? 24 : period === '6m' ? 6 : 12;
        const p1 = new Date(); p1.setMonth(p1.getMonth() - months);
        const useHourly = interval !== '1d';
        const [raw, vixRaw] = await Promise.all([
            yahooFinance.chart('^NSEI',     { interval: useHourly ? '1h' : '1d', period1: p1 }).catch(() => null),
            yahooFinance.chart('^INDIAVIX', { interval: '1d', period1: p1 }).catch(() => null),
        ]);
        let quotes = (raw?.quotes || []).filter(q => q && q.close != null && q.high != null && q.low != null);
        if (quotes.length < 60) return res.status(400).json({ error: 'Not enough data. Try shorter period or daily interval.' });

        const istDay = (d) => new Date(new Date(d).getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
        const vixByDate = {};
        (vixRaw?.quotes || []).forEach(q => { if (q && q.close != null) vixByDate[istDay(q.date)] = q.close; });
        const dailyChangeByDate = {};
        if (useHourly) {
            const groups = {}; quotes.forEach(q => { const d = istDay(q.date); (groups[d] = groups[d] || []).push(q); });
            const days = Object.keys(groups).sort();
            for (let i = 1; i < days.length; i++) { const pc = groups[days[i-1]].at(-1).close, cc = groups[days[i]].at(-1).close; dailyChangeByDate[days[i]] = (cc - pc) / pc * 100; }
        } else { for (let i = 1; i < quotes.length; i++) dailyChangeByDate[istDay(quotes[i].date)] = (quotes[i].close - quotes[i-1].close) / quotes[i-1].close * 100; }

        const closes = quotes.map(q => q.close);
        const ema9   = btEMA(closes, 9), ema21 = btEMA(closes, 21);
        const macdH  = btMACD(closes), rsiArr = btRSI(closes, 14);
        const atrArr = btATR(quotes, 14), vwapArr = useHourly ? btVWAP(quotes) : closes.map(() => null);

        const btLayer1 = (bar) => { const d = istDay(bar.date), vix = vixByDate[d] || 15, chg = dailyChangeByDate[d] || 0; const vs = vix<12?25:vix<15?22:vix<18?18:vix<22?12:vix<28?6:2, ts = chg>1?25:chg>0.3?20:chg>0?14:chg>-0.5?8:2; const total=vs+ts; return { total, pass:total>=28 }; };

        const getSignal = (i) => {
            const e9=ema9[i], e21=ema21[i], m=macdH[i], r=rsiArr[i], a=atrArr[i], v=vwapArr[i];
            if (e9==null||e21==null||m==null||r==null||a==null) return null;
            const emaBull=e9>e21, emaBear=e9<e21, aboveVwap=v!=null?closes[i]>v:emaBull, belowVwap=v!=null?closes[i]<v:emaBear;
            if (strategy==='vwap-trend') { if (emaBull&&m>0&&r>45&&r<70&&aboveVwap) return 'LONG'; if (emaBear&&m<0&&r<55&&r>30&&belowVwap) return 'SHORT'; }
            else if (strategy==='vwap-enhanced') { const pm=macdH[i-1]; const mg=pm!=null&&m>pm&&m>0, mf=pm!=null&&m<pm&&m<0; const av=quotes.slice(Math.max(0,i-10),i).reduce((s,q)=>s+(q.volume||0),0)/10; const vo=av>0?(quotes[i].volume||0)>av*1.05:true; if(emaBull&&aboveVwap&&mg&&r>45&&r<72&&vo) return 'LONG'; if(emaBear&&belowVwap&&mf&&r<55&&r>28&&vo) return 'SHORT'; }
            else if (strategy==='namit-l1') { if (!btLayer1(quotes[i]).pass) return null; if (emaBull&&aboveVwap&&m>0&&r>48&&r<70) return 'LONG'; if (emaBear&&belowVwap&&m<0&&r<52&&r>30) return 'SHORT'; }
            else if (strategy==='macd-cross') { const pm=macdH[i-1]; if(pm!=null&&pm<=0&&m>0&&emaBull&&r>40) return 'LONG'; if(pm!=null&&pm>=0&&m<0&&emaBear&&r<60) return 'SHORT'; }
            else if (strategy==='ema-cross') { const pe9=ema9[i-1],pe21=ema21[i-1]; if(pe9!=null&&pe21!=null){if(pe9<=pe21&&e9>e21&&r>45&&r<70) return 'LONG'; if(pe9>=pe21&&e9<e21&&r<55&&r>30) return 'SHORT';} }
            else if (strategy==='rsi-reversal') { const pr=rsiArr[i-1]; if(pr!=null&&pr<32&&r>=32&&emaBull) return 'LONG'; if(pr!=null&&pr>68&&r<=68&&emaBear) return 'SHORT'; }
            return null;
        };

        const LOT=50; const trades=[]; let inTrade=null, equity=0;
        const equityCurve=[{ date:quotes[0].date, equity:0 }], monthlyPnl={};
        for (let i=26; i<quotes.length; i++) {
            const bar=quotes[i];
            if (inTrade) {
                const {direction,entry,target,sl,entryDate,entryIdx}=inTrade;
                let exitPrice=null, exitReason=null;
                if (direction==='LONG') { if(bar.high>=target){exitPrice=target;exitReason='TARGET';}else if(bar.low<=sl){exitPrice=sl;exitReason='SL';} }
                else { if(bar.low<=target){exitPrice=target;exitReason='TARGET';}else if(bar.high>=sl){exitPrice=sl;exitReason='SL';} }
                if (!exitPrice&&useHourly&&istDay(bar.date)!==istDay(entryDate)){exitPrice=bar.open||bar.close;exitReason='EOD';}
                if (!exitPrice&&!useHourly&&i-entryIdx>=3){exitPrice=bar.close;exitReason='TIME';}
                if (exitPrice) {
                    const pnlPts=direction==='LONG'?exitPrice-entry:entry-exitPrice, pnlRs=+(pnlPts*LOT).toFixed(0);
                    equity+=pnlRs;
                    const mk=new Date(bar.date).toISOString().slice(0,7); monthlyPnl[mk]=(monthlyPnl[mk]||0)+pnlRs;
                    trades.push({ date:new Date(entryDate).toISOString().slice(0,10), exitDate:new Date(bar.date).toISOString().slice(0,10), direction, entry:+entry.toFixed(2), exit:+exitPrice.toFixed(2), target:+target.toFixed(2), sl:+sl.toFixed(2), pnlPts:+pnlPts.toFixed(2), pnlRs, reason:exitReason, signal:strategy });
                    equityCurve.push({ date:bar.date, equity:+equity.toFixed(0) });
                    inTrade=null;
                }
            }
            if (!inTrade) {
                const sig=getSignal(i);
                if (sig) { const a=atrArr[i],ep=bar.close; inTrade={ direction:sig, entry:ep, target:sig==='LONG'?ep+a*1.5:ep-a*1.5, sl:sig==='LONG'?ep-a:ep+a, entryDate:bar.date, entryIdx:i }; }
            }
        }

        const wins=trades.filter(t=>t.pnlRs>0), losses=trades.filter(t=>t.pnlRs<=0);
        const winRate=trades.length?+(wins.length/trades.length*100).toFixed(1):0;
        let peak=0,maxDD=0,runEq=0; for(const t of trades){runEq+=t.pnlRs;if(runEq>peak)peak=runEq;const dd=peak-runEq;if(dd>maxDD)maxDD=dd;}
        const mReturns=Object.values(monthlyPnl),mMean=mReturns.length?mReturns.reduce((s,v)=>s+v,0)/mReturns.length:0;
        const mStd=mReturns.length>1?Math.sqrt(mReturns.reduce((s,v)=>s+Math.pow(v-mMean,2),0)/(mReturns.length-1)):0;
        let curW=0,curL=0,maxW=0,maxL=0; for(const t of trades){if(t.pnlRs>0){curW++;curL=0;maxW=Math.max(maxW,curW);}else{curL++;curW=0;maxL=Math.max(maxL,curL);}}

        res.json({
            stats:{ totalTrades:trades.length, winRate, avgWinPts:wins.length?+(wins.reduce((s,t)=>s+t.pnlPts,0)/wins.length).toFixed(1):0, avgLossPts:losses.length?+(losses.reduce((s,t)=>s+t.pnlPts,0)/losses.length).toFixed(1):0, totalPnlPts:+trades.reduce((s,t)=>s+t.pnlPts,0).toFixed(1), totalPnlRs:+equity.toFixed(0), maxDrawdown:+maxDD.toFixed(0), profitFactor:losses.length&&losses.reduce((s,t)=>s+Math.abs(t.pnlRs),0)>0?+(wins.reduce((s,t)=>s+t.pnlRs,0)/Math.abs(losses.reduce((s,t)=>s+t.pnlRs,0))).toFixed(2):null, sharpe:mStd>0?+(mMean/mStd*Math.sqrt(12)).toFixed(2):null, maxConsecWins:maxW, maxConsecLosses:maxL, exitReasons:trades.reduce((acc,t)=>{acc[t.reason]=(acc[t.reason]||0)+1;return acc;},{}), period, strategy, interval:useHourly?'1h':'1d', dataPoints:quotes.length },
            trades:trades.slice(-200), equityCurve,
            monthlyPnl:Object.entries(monthlyPnl).sort(([a],[b])=>a.localeCompare(b)).map(([month,pnl])=>({month,pnl:+pnl.toFixed(0)})),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Test 6 & 27: Stale price detection helper ─────────────────────────────────
const MARKET_OPEN_IST  = 9 * 60 + 15;  // 09:15
const MARKET_CLOSE_IST = 15 * 60 + 30; // 15:30
const isMarketHoursNow = () => {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const day = ist.getDay();
    const mins = ist.getHours() * 60 + ist.getMinutes();
    return day >= 1 && day <= 5 && mins >= MARKET_OPEN_IST && mins < MARKET_CLOSE_IST;
};

const checkStalePrice = (quote) => {
    if (!quote) return { stale: true, reason: 'No quote data' };
    const ts = quote.regularMarketTime
        ? new Date(quote.regularMarketTime).getTime()
        : (quote.regularMarketTime * 1000 || 0);
    if (!ts) return { stale: false };
    const ageMs = Date.now() - ts;
    // During market hours: flag if older than 5 minutes
    if (isMarketHoursNow() && ageMs > 5 * 60 * 1000) {
        return { stale: true, ageMinutes: Math.round(ageMs / 60000), reason: 'Price may be delayed during market hours' };
    }
    return { stale: false };
};

// ── Test 20: New listing / insufficient history guard ─────────────────────────
const getHistoryDays = (chartQuotes) => {
    if (!chartQuotes?.length) return 0;
    const first = chartQuotes[0]?.date;
    const last  = chartQuotes[chartQuotes.length - 1]?.date;
    if (!first || !last) return 0;
    return Math.round((new Date(last) - new Date(first)) / 86400000);
};

// ── Test 16: F&O expiry context ───────────────────────────────────────────────
// Returns days to next monthly expiry (last Thursday of month)
const getDaysToExpiry = () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const year = now.getFullYear(), month = now.getMonth();
    // Find last Thursday of current month
    const lastDay = new Date(year, month + 1, 0);
    while (lastDay.getDay() !== 4) lastDay.setDate(lastDay.getDate() - 1);
    const diffMs = lastDay - now;
    const days = Math.max(0, Math.ceil(diffMs / 86400000));
    return { daysToExpiry: days, expiryDate: lastDay.toISOString().split('T')[0], nearExpiry: days <= 3 };
};

// ── Sector rotation aggregated endpoint ───────────────────────────────────────
let sectorRotationCache = null, sectorRotationCacheTs = 0;
const SECTOR_ROTATION_TTL = 5 * 60 * 1000;

app.get('/api/sector-rotation', async (_req, res) => {
    if (sectorRotationCache && Date.now() - sectorRotationCacheTs < SECTOR_ROTATION_TTL) {
        return res.json(sectorRotationCache);
    }
    try {
        // Fetch sector index prices + news simultaneously
        const sectorIndexSymbols = {
            Banking:       '^NSEBANK',
            IT:            '^CNXIT',
            Pharma:        '^CNXPHARMA',
            Auto:          '^CNXAUTO',
            FMCG:          '^CNXFMCG',
            Metals:        '^CNXMETAL',
            Energy:        '^CNXENERGY',
            Realty:        '^CNXREALTY',
            Infrastructure:'^CNXINFRA',
            Finance:       '^CNXFIN',
        };

        const [quotesRes, newsRes] = await Promise.allSettled([
            yahooFinance.quote(Object.values(sectorIndexSymbols)).catch(() => []),
            fetch(`http://localhost:${process.env.PORT || 3000}/api/globalnews`).then(r => r.json()).catch(() => []),
        ]);

        const quotes = quotesRes.status === 'fulfilled' ? (Array.isArray(quotesRes.value) ? quotesRes.value : []) : [];
        const news   = newsRes.status   === 'fulfilled' ? (Array.isArray(newsRes.value)   ? newsRes.value   : []) : [];

        // Test 9: macro event dampening
        const headlines = news.map(n => n.title || n.headline || '');
        const dampening = getMacroEventDampening(headlines);

        // Build per-sector price momentum from index quotes
        const priceBySymbol = {};
        quotes.forEach(q => { if (q?.symbol) priceBySymbol[q.symbol] = q; });

        // Aggregate news sentiment per sector
        const sectorSentScores = {};
        SECTORS.forEach(s => { sectorSentScores[s] = []; });

        news.forEach(item => {
            const cg = detectConglomerate(item.title || '');
            // Test 10: ring-fence conglomerate-specific news
            const sectors = dSec(item.title || '', cg);
            const ss = sentScore(item.title || '', item.publisher);
            sectors.forEach(s => {
                if (sectorSentScores[s]) {
                    sectorSentScores[s].push(ss.score * ss.sourceWeight);
                    recordSectorSentiment(s, ss.score, ss.sourceWeight);
                }
            });
        });

        // Compute rotation scores per sector
        const rotation = {};
        let negCount = 0;

        for (const [sector, idxSym] of Object.entries(sectorIndexSymbols)) {
            const q = priceBySymbol[idxSym];
            const price30dAgo = q?.regularMarketPrice
                ? q.regularMarketPrice / (1 + (q.regularMarketChangePercent || 0) / 100)
                : null;
            const priceMomentum30d = q?.regularMarketChangePercent || 0;

            const rawScores = sectorSentScores[sector] || [];
            const sentimentAvg = rawScores.length
                ? rawScores.reduce((a, b) => a + b, 0) / rawScores.length
                : 0;

            const { delta: sentimentDelta } = getSectorMomentumDelta(sector);

            const { heat, components } = computeSectorHeat({
                sentimentDelta: sentimentDelta || sentimentAvg,
                priceMomentum30d,
                volumeVsAvg: 1.0,  // FII data TBD Phase 2
                fiiFlow7d: 0,       // FII data TBD Phase 2
                dampening,
            });

            if (heat < 0) negCount++;
            rotation[sector] = { heat, components, priceMomentum30d, sentimentAvg, dampening };
        }

        // Rank sectors by heat
        const ranked = Object.entries(rotation)
            .sort((a, b) => b[1].heat - a[1].heat)
            .map(([sector, data], idx) => ({ sector, rank: idx + 1, ...data }));

        ranked.forEach(({ sector, rank, heat }) => { rotation[sector].rank = rank; rotation[sector].heat = heat; });

        // Test 25: circuit breaker
        const niftyQ = quotes.find(q => q?.symbol === '^NSEI') ||
                       await yahooFinance.quote('^NSEI').catch(() => null);
        const niftyChange = niftyQ?.regularMarketChangePercent || 0;
        const vixQ = await yahooFinance.quote('^INDIAVIX').catch(() => null);
        const vix  = vixQ?.regularMarketPrice || 15;
        const cb   = updateCircuitBreaker(niftyChange, negCount, vix);

        // Test 26: flow concentration warning
        const top3 = ranked.slice(0, 3).map(r => r.sector);
        const concentrationWarning = getFlowConcentrationWarning(top3);

        const result = {
            sectors: rotation,
            ranked,
            dampening,
            circuitBreaker: cb,
            concentrationWarning,
            dataAge: { fetchedAt: new Date().toISOString(), macroEventActive: dampening < 1.0 },
        };

        sectorRotationCache = result;
        sectorRotationCacheTs = Date.now();
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Portfolio analysis endpoint ───────────────────────────────────────────────
app.post('/api/portfolio/analyse', async (req, res) => {
    try {
        const { holdings } = req.body;
        if (!Array.isArray(holdings) || holdings.length === 0) {
            return res.status(400).json({ error: 'holdings array required' });
        }

        // Validate and cap
        const MAX_HOLDINGS = 50;
        const sanitised = holdings.slice(0, MAX_HOLDINGS).map(h => ({
            ticker:  (h.ticker  || '').toString().toUpperCase().trim().slice(0, 20),
            qty:     Math.abs(parseFloat(h.qty)    || 0),
            avgBuy:  Math.abs(parseFloat(h.avgBuy) || 0),
            buyDate: h.buyDate  || null,
            isCore:  !!h.isCore,
        })).filter(h => h.ticker && h.qty > 0 && h.avgBuy > 0);

        if (!sanitised.length) return res.status(400).json({ error: 'No valid holdings' });

        // Flag MF tickers
        const mfFlags = sanitised.filter(h => isMutualFundTicker(h.ticker)).map(h => h.ticker);

        // Normalise tickers
        const normTickers = sanitised.map(h => normaliseTicker(h.ticker));

        // Fetch live quotes
        const quotes = await yahooFinance.quote(normTickers).catch(() => []);
        const qMap = {};
        (Array.isArray(quotes) ? quotes : []).forEach(q => { if (q?.symbol) qMap[q.symbol] = q; });

        // Fetch 30d charts for RSI + closes
        const chartPromises = normTickers.map(sym =>
            yahooFinance.chart(sym, { interval: '1d', period1: toPeriod1('2mo') }).catch(() => null)
        );
        const charts = await Promise.allSettled(chartPromises);

        // Get sector rotation data
        let sectorRotation = {};
        try {
            const rotRes = await fetch(`http://localhost:${process.env.PORT || 3000}/api/sector-rotation`).then(r => r.json());
            sectorRotation = rotRes.sectors || {};
        } catch { /* use empty rotation if unavailable */ }

        const totalValue = sanitised.reduce((sum, h) => {
            const sym = normaliseTicker(h.ticker);
            const q   = qMap[sym];
            const cmp = q?.regularMarketPrice || h.avgBuy;
            return sum + cmp * h.qty;
        }, 0);

        // Analyse each holding
        const analysed = sanitised.map((h, i) => {
            const sym = normTickers[i];
            const q   = qMap[sym] || {};
            const cmp = q.regularMarketPrice || h.avgBuy;

            const chartData = charts[i]?.status === 'fulfilled' ? charts[i].value : null;
            const chartQ    = chartData?.quotes?.filter(x => x?.close) || [];
            const closes    = chartQ.map(x => x.close);
            const volumes   = chartQ.map(x => x.volume || 0);
            const histDays  = getHistoryDays(chartQ);
            const dataSufficiency = checkDataSufficiency(histDays, sym);

            // RSI
            let rsi = 50;
            if (closes.length >= 14) {
                const rsiArr = RSI.calculate({ values: closes, period: 14 });
                if (rsiArr.length) rsi = rsiArr[rsiArr.length - 1];
            }

            // Test 6 & 27: stale price
            const staleInfo = checkStalePrice(q);

            const result = analyseHolding(
                {
                    ticker:           h.ticker,
                    qty:              h.qty,
                    avgBuy:           h.avgBuy,
                    buyDate:          h.buyDate,
                    isCore:           h.isCore,
                    currentPrice:     cmp,
                    rsi,
                    closes,
                    volumes,
                    avgDailyVolumeCr: q.averageDailyVolume10Day
                        ? (q.averageDailyVolume10Day * cmp) / 1e7 : 10,
                    marketCapCr:      q.marketCap ? q.marketCap / 1e7 : 5000,
                    bidAskSpreadPct:  0.1,
                    isF0Eligible:     !!q.averageDailyVolume10Day && q.averageDailyVolume10Day > 500000,
                    highImpactNews:   0,
                },
                sectorRotation,
                totalValue
            );

            return {
                ...result,
                normTicker: sym,
                stale: staleInfo,
                dataInsufficient: !dataSufficiency.sufficient,
                dataInsufficiencyReason: dataSufficiency.reason || null,
                isMutualFund: isMutualFundTicker(h.ticker),
            };
        });

        // Test 25: circuit breaker — suppress EXIT_ZONE verdicts during market stress
        const cb = getCircuitBreaker();
        if (cb.active) {
            analysed.forEach(h => {
                if (h.verdict === 'EXIT_ZONE') {
                    h.verdict = 'HOLD';
                    h.verdictLabel = `Signal suppressed: Market stress mode active (${cb.reason}). Avoid panic exits.`;
                    h.circuitBreakerOverride = true;
                }
            });
        }

        const healthScore = computeHealthScore(analysed, sectorRotation);

        res.json({
            holdings: analysed,
            healthScore,
            totalValue: +totalValue.toFixed(2),
            circuitBreaker: cb,
            mfFlagged: mfFlags,
            disclaimer: 'Screener output only. Not SEBI-registered investment advice. Past patterns do not guarantee future performance. Consult a SEBI-registered advisor before acting.',
            analysedAt: new Date().toISOString(),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Rotation cost estimator (standalone) ─────────────────────────────────────
app.post('/api/portfolio/rotation-cost', (req, res) => {
    try {
        const { exitValue, unrealisedPnL, isLTCG, avgDailyVolumeCr } = req.body;
        if (!exitValue || exitValue <= 0) return res.status(400).json({ error: 'exitValue required' });
        const cost = estimateRotationCost({
            exitValue, entryValue: exitValue, unrealisedPnL: unrealisedPnL || 0,
            isLTCG: !!isLTCG, avgDailyVolume: (avgDailyVolumeCr || 50) * 1e7,
        });
        res.json(cost);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Test 16: F&O expiry info ─────────────────────────────────────────────────
app.get('/api/expiry-info', (_req, res) => res.json(getDaysToExpiry()));

// ── Serve React build (production) ───────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(__dirname, '..', 'dist');
    app.use(express.static(distDir, { maxAge: '7d', immutable: true, setHeaders: (res, fp) => { if (fp.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.use((req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

module.exports = app;

if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Astraeus API · port ${PORT}`);
        setTimeout(() => {
            const base = `http://localhost:${PORT}/api`;
            ['/gti', '/globalnews', '/futures', '/indicesbar', '/livetape'].forEach(ep => fetch(base + ep).catch(() => {}));
            getLivePCR().then(d => console.log(`PCR ready: ${d.pcr} (${d.date})`)).catch(e => console.log(`PCR warm failed: ${e.message}`));
        }, 3000);
    });
}
