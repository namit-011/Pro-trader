const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance(); // Corrected instantiation
const { SMA, EMA, MACD, RSI, BollingerBands, Stochastic, ADX } = require('technicalindicators');

const app = express();
app.use(compression());
app.use(cors());
app.use(express.json());

// ── Helpers ──
const getRelativeTime = (dateInput) => {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    const delta = Math.round((new Date() - d) / 1000);
    if (delta < 60) return `${delta}s ago`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

const toPeriod1 = (rangeStr) => {
    const d = new Date();
    const map = { '1d': [0, 0, -1], '5d': [0, 0, -5], '1mo': [0, -1, 0], '3mo': [0, -3, 0], '6mo': [0, -6, 0], '1y': [-1, 0, 0], '2y': [-2, 0, 0] };
    const [y, m, day] = map[rangeStr] || [0, -6, 0];
    d.setFullYear(d.getFullYear() + y); d.setMonth(d.getMonth() + m); d.setDate(d.getDate() + day);
    return d;
};

const dSec = (t) => {
    const k = { 'Banking': ['bank', 'hdfc', 'icici', 'axis', 'sbi', 'rbi'], 'IT': ['tcs', 'infy', 'wipro', 'tech', 'software'], 'Energy': ['oil', 'reliance', 'fuel', 'gas', 'power'], 'Auto': ['tata motors', 'maruti', 'mahindra', 'automotive'] };
    const f = Object.keys(k).filter(s => k[s].some(x => t.toLowerCase().includes(x)));
    return f.length ? f : ['Market'];
};

const dSent = (t) => {
    const low = t.toLowerCase();
    if (['surge', 'rally', 'high', 'gain', 'beat', 'bullish', 'growth', 'record', 'rise', 'soar'].some(w => low.includes(w))) return 'bullish';
    if (['crash', 'drop', 'low', 'loss', 'cut', 'bearish', 'slump', 'fall', 'weak', 'decline'].some(w => low.includes(w))) return 'bearish';
    return 'neutral';
};

const dIndiaImpact = (t) => {
    const low = t.toLowerCase();
    const india = ['india', 'sensex', 'nifty', 'bse', 'nse', 'rupee', 'sebi', 'rbi', 'mumbai', 'modi'].some(w => low.includes(w));
    const macro = ['fed', 'federal reserve', 'dollar', 'crude', 'oil price', 'china', 'us tariff', 'treasury', 'wall street'].some(w => low.includes(w));
    const pos = ['rate cut', 'stimulus', 'rally', 'surge', 'gain', 'growth', 'record', 'beat', 'boom'].some(w => low.includes(w));
    const neg = ['rate hike', 'recession', 'crash', 'tariff', 'war', 'crisis', 'inflation', 'sanctions', 'drop', 'fall'].some(w => low.includes(w));
    if (india || macro) {
        if (pos && !neg) return 'bullish';
        if (neg && !pos) return 'bearish';
    }
    return 'neutral';
};

// ── Black-Scholes & Indian F&O ──
const isIndianTicker = (t) => /\.(NS|BO)$/i.test(t) || ['^NSEI', '^NSEBANK', '^BSESN'].includes(t);

const erfApprox = (x) => {
    const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - t * (a[0] + t * (a[1] + t * (a[2] + t * (a[3] + t * a[4])))) * Math.exp(-x * x);
    return s * y;
};
const N = (x) => 0.5 * (1 + erfApprox(x / Math.SQRT2));

const bsPrice = (S, K, T, r, σ, type) => {
    if (T <= 0) return Math.max(0, type === 'C' ? S - K : K - S);
    const d1 = (Math.log(S / K) + (r + 0.5 * σ * σ) * T) / (σ * Math.sqrt(T));
    const d2 = d1 - σ * Math.sqrt(T);
    return type === 'C' ? S * N(d1) - K * Math.exp(-r * T) * N(d2) : K * Math.exp(-r * T) * N(-d2) - S * N(-d1);
};

const getLastThursday = (y, m) => {
    const d = new Date(y, m + 1, 0);
    while (d.getDay() !== 4) d.setDate(d.getDate() - 1);
    return d;
};
const getNSEExpiries = (n = 3) => {
    const now = new Date(); const out = []; let y = now.getFullYear(), m = now.getMonth();
    while (out.length < n) {
        const exp = getLastThursday(y, m);
        if (exp > now) out.push(exp.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
        if (++m > 11) { m = 0; y++; }
    }
    return out;
};

const buildTheoreticalChain = (price, hv, expiryStr) => {
    const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const [dd, mon, yyyy] = expiryStr.split(' ');
    const expDate = new Date(+yyyy, MONTHS[mon], +dd);
    const T = Math.max(1, (expDate - new Date()) / (1000 * 60 * 60 * 24)) / 365;
    const r = 0.065; const iv = Math.max(10, Math.min(80, hv));

    const step = price < 100 ? 1 : price < 500 ? 5 : price < 2000 ? 50 : price < 5000 ? 100 : 200;
    const atm = Math.round(price / step) * step;
    const calls = [], puts = [];

    for (let i = -10; i <= 10; i++) {
        const K = atm + i * step;
        if (K <= 0) continue;
        const m = (K - price) / price;
        const callIV = Math.max(5, iv + m * 15 + (Math.random() - 0.5) * 2);
        const putIV = Math.max(5, iv - m * 12 + 2 + (Math.random() - 0.5) * 2); // put skew
        const cPrice = Math.max(0.05, +bsPrice(price, K, T, r, callIV / 100, 'C').toFixed(2));
        const pPrice = Math.max(0.05, +bsPrice(price, K, T, r, putIV / 100, 'P').toFixed(2));
        const cOI = Math.round(Math.exp(-2.5 * Math.pow(m + 0.005, 2)) * (400000 + Math.random() * 200000));
        const pOI = Math.round(Math.exp(-2.5 * Math.pow(m - 0.005, 2)) * (500000 + Math.random() * 200000));
        calls.push({ strike: K, lastPrice: cPrice, bid: +(cPrice * 0.98).toFixed(2), ask: +(cPrice * 1.02).toFixed(2), iv: +callIV.toFixed(1), oi: cOI, vol: Math.round(cOI * 0.25 * Math.random()), inTheMoney: K < price });
        puts.push({ strike: K, lastPrice: pPrice, bid: +(pPrice * 0.98).toFixed(2), ask: +(pPrice * 1.02).toFixed(2), iv: +putIV.toFixed(1), oi: pOI, vol: Math.round(pOI * 0.25 * Math.random()), inTheMoney: K > price });
    }

    const totalCallOI = calls.reduce((s, o) => s + o.oi, 0);
    const totalPutOI = puts.reduce((s, o) => s + o.oi, 0);
    const pcr = totalCallOI > 0 ? +(totalPutOI / totalCallOI).toFixed(2) : null;
    const allStrikes = calls.map(c => c.strike);
    let minLoss = Infinity, maxPain = allStrikes[Math.floor(allStrikes.length / 2)];
    for (const p of allStrikes) {
        const loss = calls.reduce((s, o) => s + Math.max(0, p - o.strike) * o.oi, 0) + puts.reduce((s, o) => s + Math.max(0, o.strike - p) * o.oi, 0);
        if (loss < minLoss) { minLoss = loss; maxPain = p; }
    }
    const maxOI = Math.max(...calls.map(o => o.oi), ...puts.map(o => o.oi), 1);
    return { calls, puts, pcr, maxPain, atm, maxOI, totalCallOI, totalPutOI };
};

// ── Top Movers (NSE F&O liquid) ──
const NSE_FNO_LIQUID = [
    'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS',
    'BAJFINANCE.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'AXISBANK.NS', 'KOTAKBANK.NS',
    'LT.NS', 'TATAMOTORS.NS', 'ADANIENT.NS', 'WIPRO.NS', 'HCLTECH.NS',
    'TATASTEEL.NS', 'JSWSTEEL.NS', 'HINDALCO.NS', 'ONGC.NS', 'MARUTI.NS'];

const moversCache = {};
const MOVERS_TTL = 2 * 60 * 1000;

const cleanName = (n, sym) => (n || sym).replace(/ NSE$/i, '').replace(/ Limited$/i, ' Ltd').replace(/ Ltd\.$/, ' Ltd');

// ── NSE India Live Data (real-time, no auth needed) ──
const NSE_HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.nseindia.com/',
    'Connection': 'keep-alive',
};
let nseAllIdxCache = { data: null, ts: 0 };
const NSE_TTL = 3000; // 3s — real-time

// ── Nifty 100 stocks for live tape ──
const NIFTY100_LIST = [
    'RELIANCE.NS','TCS.NS','HDFCBANK.NS','INFY.NS','ICICIBANK.NS','HINDUNILVR.NS','ITC.NS',
    'SBIN.NS','BHARTIARTL.NS','KOTAKBANK.NS','LT.NS','AXISBANK.NS','ASIANPAINT.NS','MARUTI.NS',
    'TITAN.NS','WIPRO.NS','BAJFINANCE.NS','ONGC.NS','NTPC.NS','POWERGRID.NS','SUNPHARMA.NS',
    'HCLTECH.NS','TECHM.NS','BAJAJFINSV.NS','CIPLA.NS','DRREDDY.NS','EICHERMOT.NS',
    'TATAMOTORS.NS','TATASTEEL.NS','JSWSTEEL.NS','COALINDIA.NS','GRASIM.NS','DIVISLAB.NS',
    'BPCL.NS','HEROMOTOCO.NS','SBILIFE.NS','HDFCLIFE.NS','NESTLEIND.NS','ADANIPORTS.NS',
    'ULTRACEMCO.NS','INDUSINDBK.NS','APOLLOHOSP.NS','TRENT.NS','BAJAJ-AUTO.NS','SHREECEM.NS',
];

// Key NSE indices for the bottom bar
const NSE_KEY_IDX = [
    'NIFTY 50','NIFTY BANK','INDIA VIX','S&P BSE SENSEX','NIFTY MIDCAP 100',
    'NIFTY SMALLCAP 100','NIFTY IT','NIFTY AUTO','NIFTY PHARMA','NIFTY FMCG',
    'NIFTY METAL','NIFTY ENERGY','NIFTY REALTY','NIFTY INFRA','NIFTY MEDIA',
    'NIFTY NEXT 50','NIFTY 100','NIFTY FINANCIAL SERVICES','NIFTY PSU BANK',
    'NIFTY PRIVATE BANK','NIFTY HEALTHCARE INDEX','NIFTY CONSUMER DURABLES',
];

let liveTapeCache = { data: null, ts: 0 };
const LIVETAPE_TTL = 8000;
let indicesBarCache = { data: null, ts: 0 };
const INDICESBAR_TTL = 3000;

async function getNSEIndices() {
    if (nseAllIdxCache.data && Date.now() - nseAllIdxCache.ts < NSE_TTL) return nseAllIdxCache.data;
    const r = await fetch('https://www.nseindia.com/api/allIndices', {
        headers: NSE_HDR, signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error(`NSE ${r.status}`);
    const j = await r.json();
    nseAllIdxCache = { data: j.data || [], ts: Date.now() };
    return nseAllIdxCache.data;
}

// ── MoneyControl GIFT NIFTY (live futures price) ──
// API discovered from: https://www.moneycontrol.com/live-index/gift-nifty?symbol=in;gsx
const MC_GIFT_URL = 'https://appfeeds.moneycontrol.com/jsonapi/market/indices?format=json&ind_id=in%3Bgsx';
const MC_HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.moneycontrol.com/',
    'Accept': 'application/json, text/plain, */*',
};
const parseNum = s => parseFloat((String(s || '0')).replace(/,/g, '')) || 0;

let giftNiftyCache = { data: null, ts: 0 };
const GIFT_TTL = 15000; // 15s

async function fetchGiftNifty() {
    if (giftNiftyCache.data && Date.now() - giftNiftyCache.ts < GIFT_TTL) return giftNiftyCache.data;
    const r = await fetch(MC_GIFT_URL, { headers: MC_HDR, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`MC GIFT ${r.status}`);
    const j = await r.json();
    const idx = j.indices;
    if (!idx || !idx.lastprice) throw new Error('MC GIFT: no price');
    const data = {
        symbol: 'GIFT-NIFTY',
        name: 'GIFT NIFTY',
        price: parseNum(idx.lastprice),
        change: parseNum(idx.change),
        changePercent: parseNum(idx.percentchange),
        open: parseNum(idx.open),
        high: parseNum(idx.high),
        low: parseNum(idx.low),
        prevClose: parseNum(idx.prevclose),
        marketState: idx.market_state || 'UNKNOWN',
        lastUpdated: idx.lastupdated || '',
        isLive: true,
        src: 'MoneyControl',
    };
    giftNiftyCache = { data, ts: Date.now() };
    return data;
}

// ── RSS Parser (no external packages) ──
async function fetchRSS(url, max = 20) {
    const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/xml,text/xml,*/*' },
        signal: AbortSignal.timeout(7000),
    });
    const txt = await r.text();
    const items = [];
    const RE_ITEM = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    const getTag = (xml, tag) => {
        const m = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i').exec(xml);
        return m ? m[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, '') : '';
    };
    let m;
    while ((m = RE_ITEM.exec(txt)) !== null && items.length < max) {
        const title = getTag(m[1], 'title');
        if (!title || title.length < 10) continue;
        const link    = getTag(m[1], 'link') || getTag(m[1], 'guid');
        const pubDate = getTag(m[1], 'pubDate');
        const ts      = pubDate ? new Date(pubDate).getTime() : Date.now();
        if (!isNaN(ts)) items.push({ title, link, ts });
    }
    return items.sort((a, b) => b.ts - a.ts);
}

let rssCache = { data: null, ts: 0 };
const RSS_TTL = 90000; // 90s

// NSE index name → Yahoo-style symbol mapping
const NSE_IDX_MAP = {
    'NIFTY 50': { sym: '^NSEI', name: 'NIFTY 50' },
    'NIFTY BANK': { sym: '^NSEBANK', name: 'Nifty Bank' },
    'INDIA VIX': { sym: '^INDIAVIX', name: 'India VIX' },
    'S&P BSE SENSEX': { sym: '^BSESN', name: 'BSE SENSEX' },
};

// ── Endpoints ──
app.get('/api/global', async (req, res) => {
    try {
        const [nseRes, yfRes] = await Promise.allSettled([
            getNSEIndices(),
            yahooFinance.quote(['^DJI', '^IXIC', 'GC=F', 'CL=F', 'USDINR=X']),
        ]);

        const out = [];

        // Indian indices — NSE real-time
        if (nseRes.status === 'fulfilled') {
            nseRes.value.forEach(idx => {
                const key = idx.index || idx.indexSymbol || '';
                const mapped = NSE_IDX_MAP[key];
                if (mapped) out.push({
                    symbol: mapped.sym, name: mapped.name,
                    price: idx.last ?? idx.current ?? null,
                    change: idx.variation ?? 0,
                    changePercent: idx.percentChange ?? 0,
                    isLive: true,
                });
            });
        } else {
            // Fallback: Yahoo Finance for Indian indices
            const fb = await yahooFinance.quote(['^NSEI', '^NSEBANK', '^BSESN', '^INDIAVIX']).catch(() => []);
            (Array.isArray(fb) ? fb : []).forEach(q => out.push({
                symbol: q.symbol, name: q.shortName || q.symbol,
                price: q.regularMarketPrice, change: q.regularMarketChange,
                changePercent: q.regularMarketChangePercent, isLive: false,
            }));
        }

        // Global — Yahoo Finance
        if (yfRes.status === 'fulfilled') {
            (Array.isArray(yfRes.value) ? yfRes.value : []).forEach(q => out.push({
                symbol: q.symbol, name: q.shortName || q.symbol,
                price: q.regularMarketPrice, change: q.regularMarketChange,
                changePercent: q.regularMarketChangePercent, isLive: false,
            }));
        }

        res.json(out);
    } catch { res.json([]); }
});

const HIGH_IMPACT_WORDS = ['rbi', 'crash', 'surge', 'fed', 'interest rate', 'nifty', 'sensex', 'sebi', 'budget', 'gdp'];

const mapNewsItem = (title, link, publisher, timestamp) => ({
    title, link, publisher,
    timestamp,
    time: getRelativeTime(new Date(timestamp)),
    rawTime: new Date(timestamp).toLocaleString('en-IN'),
    sectors: dSec(title), sentiment: dSent(title),
    indiaImpact: dIndiaImpact(title),
    highImpact: HIGH_IMPACT_WORDS.some(w => title.toLowerCase().includes(w)),
});

app.get('/api/globalnews', async (req, res) => {
    const now = Date.now();
    try {
        // RSS primary source (Economic Times Markets — updated every ~5 min)
        const getRSS = async () => {
            if (rssCache.data && now - rssCache.ts < RSS_TTL) return rssCache.data;
            const items = await fetchRSS('https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', 25);
            const mapped = items.map(i => mapNewsItem(i.title, i.link, 'Economic Times', i.ts));
            rssCache = { data: mapped, ts: now };
            return mapped;
        };

        // Yahoo Finance secondary source
        const getYF = async () => {
            const searches = await Promise.all(
                ['RELIANCE.NS', 'TCS.NS', '^NSEI', 'HDFCBANK.NS'].map(sym =>
                    yahooFinance.search(sym, { newsCount: 6 }).catch(() => ({ news: [] }))
                )
            );
            const seen = new Set();
            return searches.flatMap(r => r.news || [])
                .filter(n => { if (seen.has(n.uuid)) return false; seen.add(n.uuid); return true; })
                .map(n => {
                    const ts = n.providerPublishTime instanceof Date
                        ? n.providerPublishTime.getTime()
                        : (n.providerPublishTime || 0) * 1000;
                    return mapNewsItem(n.title, n.link, n.publisher || 'Yahoo Finance', ts);
                });
        };

        const [rssRes, yfRes] = await Promise.allSettled([getRSS(), getYF()]);
        const rssItems = rssRes.status === 'fulfilled' ? rssRes.value : [];
        const yfItems  = yfRes.status  === 'fulfilled' ? yfRes.value  : [];

        const seen = new Set();
        const merged = [...rssItems, ...yfItems]
            .filter(n => {
                const key = (n.title || '').slice(0, 45).toLowerCase().replace(/\s+/g, '');
                if (seen.has(key)) return false;
                seen.add(key); return true;
            })
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, 28);

        res.json(merged);
    } catch { res.json([]); }
});

app.get('/api/options/:ticker', async (req, res) => {
    try {
        const { ticker } = req.params;
        const { expiry: requestedExpiry } = req.query;

        if (isIndianTicker(ticker)) {
            // Compute historical volatility from 30-day chart
            const p1 = toPeriod1('1mo');
            const chart = await yahooFinance.chart(ticker, { interval: '1d', period1: p1 }).catch(() => ({ quotes: [] }));
            const closes = (chart.quotes || []).filter(x => x && x.close).map(x => x.close);
            let hv = 28;
            if (closes.length > 5) {
                const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
                const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
                const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
                hv = Math.round(Math.sqrt(variance * 252) * 100 * 1.25);
            }
            hv = Math.max(10, Math.min(80, hv));
            const expiryDates = getNSEExpiries(4);
            const targetExpiry = requestedExpiry || expiryDates[0];
            const quote = await yahooFinance.quote(ticker).catch(() => ({}));
            const price = quote.regularMarketPrice || (closes.length ? closes[closes.length - 1] : 100);
            const chain = buildTheoreticalChain(price, hv, targetExpiry);
            return res.json({ ...chain, expiry: targetExpiry, expiryDates, source: 'THEORETICAL', hv });
        }

        // US stocks: Yahoo Finance real data
        const r = await yahooFinance.options(ticker);
        if (!r?.options?.[0]) return res.json({ calls: [], puts: [], expiry: null });
        const c = r.options[0];
        const allC = c.calls || [], allP = c.puts || [];
        const totalCallOI = allC.reduce((s, o) => s + (o.openInterest || 0), 0);
        const totalPutOI = allP.reduce((s, o) => s + (o.openInterest || 0), 0);
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

app.get('/api/analyze/:ticker', async (req, res) => {
    try {
        const { ticker } = req.params;
        let { period = '6mo', interval = '1d' } = req.query;

        const rangeKey = interval.includes('m') || interval === '1h' ? '1d' : (period || '6mo');
        let params = { interval, period1: toPeriod1(rangeKey) };

        const sym = ticker.toUpperCase();
        const [quote, summary, chart] = await Promise.all([
            yahooFinance.quote(sym).catch(() => ({})),
            yahooFinance.quoteSummary(sym, { modules: ['summaryDetail', 'financialData', 'defaultKeyStatistics'] }).catch(() => ({})),
            yahooFinance.chart(sym, params).catch(() => ({ quotes: [] }))
        ]);

        const q = (chart?.quotes || []).filter(x => x && x.close != null);
        const price = quote.regularMarketPrice || (q.length ? q[q.length - 1].close : 0);

        let tech = null;
        if (q.length > 5) {
            const cl = q.map(x => x.close), hi = q.map(x => x.high), lo = q.map(x => x.low);
            const cp = cl[cl.length - 1], hp = hi[hi.length - 1], lp = lo[lo.length - 1];
            const P = (hp + lp + cp) / 3;
            const rsi = q.length >= 14 ? RSI.calculate({ values: cl, period: 14 }).pop() : null;
            const macd = q.length >= 26 ? MACD.calculate({ values: cl, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }).pop() : null;
            const bb = q.length >= 20 ? BollingerBands.calculate({ values: cl, period: 20, stdDev: 2 }).pop() : null;
            const adx = q.length >= 14 ? ADX.calculate({ high: hi, low: lo, close: cl, period: 14 }).pop() : null;
            tech = {
                rsi,
                macd,
                ema9: q.length >= 9 ? EMA.calculate({ values: cl, period: 9 }).pop() : null,
                ema21: q.length >= 21 ? EMA.calculate({ values: cl, period: 21 }).pop() : null,
                sma50: q.length >= 50 ? EMA.calculate({ values: cl, period: 50 }).pop() : null,
                sma200: q.length >= 200 ? SMA.calculate({ values: cl, period: 200 }).pop() : null,
                stochastic: q.length >= 14 ? Stochastic.calculate({ high: hi, low: lo, close: cl, period: 14, signalPeriod: 3 }).pop() : null,
                bb,
                adx,
                pivots: { pivot: P, r1: 2 * P - lp, s1: 2 * P - hp, r2: P + (hp - lp), s2: P - (hp - lp) }
            };
        }

        const det = summary.summaryDetail || {}, f = summary.financialData || {}, ks = summary.defaultKeyStatistics || {};
        const fmtCap = v => v >= 1e12 ? (v/1e12).toFixed(2)+'T' : v >= 1e9 ? (v/1e9).toFixed(2)+'B' : v >= 1e6 ? (v/1e6).toFixed(2)+'M' : String(v);
        res.json({
            ticker: sym, companyName: quote.shortName || sym, price,
            change: quote.regularMarketChange || 0, changePercent: quote.regularMarketChangePercent || 0,
            volume: quote.regularMarketVolume || 0, openPrice: quote.regularMarketOpen || 0,
            dayHigh: quote.regularMarketDayHigh || 0, dayLow: quote.regularMarketDayLow || 0,
            prevClose: quote.regularMarketPreviousClose || 0,
            fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh || 0, fiftyTwoWeekLow: quote.fiftyTwoWeekLow || 0,
            avgVolume: quote.averageDailyVolume3Month || 0,
            currency: quote.currency || 'INR',
            financials: {
                'Market Cap': det.marketCap ? fmtCap(det.marketCap) : 'N/A',
                'P/E Ratio': det.trailingPE ? Number(det.trailingPE).toFixed(2) : 'N/A',
                'EPS (TTM)': ks.trailingEps ? Number(ks.trailingEps).toFixed(2) : 'N/A',
                'Revenue': f.totalRevenue ? fmtCap(f.totalRevenue) : 'N/A',
                'Profit Margin': f.profitMargins ? (f.profitMargins*100).toFixed(2)+'%' : 'N/A',
                'ROE': f.returnOnEquity ? (f.returnOnEquity*100).toFixed(2)+'%' : 'N/A',
                'Debt/Equity': f.debtToEquity ? Number(f.debtToEquity).toFixed(2) : 'N/A',
                'Div Yield': det.dividendYield ? (det.dividendYield*100).toFixed(2)+'%' : 'N/A',
                'Beta': det.beta ? Number(det.beta).toFixed(2) : 'N/A',
                '52W High': quote.fiftyTwoWeekHigh ? Number(quote.fiftyTwoWeekHigh).toFixed(2) : 'N/A',
                '52W Low': quote.fiftyTwoWeekLow ? Number(quote.fiftyTwoWeekLow).toFixed(2) : 'N/A',
                'Avg Volume': quote.averageDailyVolume3Month ? fmtCap(quote.averageDailyVolume3Month) : 'N/A',
            },
            technicals: tech,
            recommendation: (() => {
                let score = 0, signals = 0;
                const rsi = tech?.rsi;
                if (rsi != null) { signals += 2; score += rsi < 35 ? 2 : rsi > 70 ? -2 : rsi < 50 ? 1 : -1; }
                if (tech?.macd) { signals++; score += tech.macd.MACD > tech.macd.signal ? 1 : -1; }
                if (tech?.ema9 && tech?.ema21) { signals++; score += tech.ema9 > tech.ema21 ? 1 : -1; }
                if (tech?.bb && price) { signals++; score += price < tech.bb.lower ? 2 : price > tech.bb.upper ? -2 : 0; }
                const norm = signals > 0 ? score / signals : 0;
                const action = norm >= 1 ? 'STRONG BUY' : norm >= 0.4 ? 'BUY' : norm <= -1 ? 'STRONG SELL' : norm <= -0.4 ? 'SELL' : 'HOLD';
                const confidence = Math.min(95, Math.round(55 + Math.abs(norm) * 22));
                return { action, confidence, targetArea: price * (norm >= 0 ? 1.055 : 1.02), stopLoss: price * (norm >= 0 ? 0.965 : 0.95) };
            })(),
            chartData: q.map(x => ({
                time: interval.includes('m') ? Math.floor(new Date(x.date).getTime() / 1000) : x.date.toISOString().split('T')[0],
                open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume
            })),
            news: (await yahooFinance.search(sym, { newsCount: 5 }).catch(() => ({ news: [] }))).news.map(n => {
                const pubDate = n.providerPublishTime instanceof Date ? n.providerPublishTime : new Date(n.providerPublishTime * 1000);
                return { title: n.title, link: n.link, publisher: n.publisher, time: getRelativeTime(pubDate), sentiment: dSent(n.title), sectors: dSec(n.title) };
            })
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/top15', async (req, res) => {
    try {
        const l = ['RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS', 'SBIN.NS', 'ITC.NS', 'NVDA', 'AAPL', 'GC=F'];
        const q = await yahooFinance.quote(l);
        res.json(q.map(x => ({ ticker: x.symbol, changePercent: x.regularMarketChangePercent?.toFixed(2), action: x.regularMarketChangePercent > 0 ? 'BUY' : 'SELL' })));
    } catch { res.json([]); }
});

// ── GTI & Geo-Intelligence ──
const GTI_POS = { war: 20, attack: 16, nuclear: 22, military: 12, crisis: 11, conflict: 10, missile: 18, sanction: 9, embargo: 9, terror: 18, bomb: 17, tension: 7, invasion: 20, protest: 5, coup: 16, assassination: 17, blockade: 13, threat: 8, escalat: 12, airstrike: 17 };
const GTI_NEG = { peace: -9, ceasefire: -13, deal: -6, agreement: -8, rally: -5, growth: -4, recovery: -6, surplus: -4, truce: -11, diplomacy: -8 };

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
    if (/india|sensex|nifty|mumbai|rbi|sebi|rupee|dalal/.test(low)) return 'India';
    if (/middle east|iran|saudi|gulf|israel|syria|iraq|yemen|oman/.test(low)) return 'Middle East';
    if (/russia|ukraine|nato|moscow|kyiv|kremlin/.test(low)) return 'E. Europe';
    if (/china|taiwan|beijing|shanghai|hong kong|south china/.test(low)) return 'Asia-Pacific';
    if (/fed|dollar|wall street|us |america|nasdaq|s&p|treasury|pentagon/.test(low)) return 'N. America';
    if (/europe|ecb|euro|germany|france|uk|britain|london/.test(low)) return 'Europe';
    if (/africa|nigeria|kenya|egypt|ethiopia|sudan/.test(low)) return 'Africa';
    return 'Global';
};

const getEventLevel = (t) => {
    const low = t.toLowerCase();
    if (/war|attack|nuclear|missile|bomb|terror|coup|invasion|assassination|airstrike/.test(low)) return 'CRITICAL';
    if (/crisis|conflict|sanction|embargo|tension|blockade|escalat|threat/.test(low)) return 'HIGH';
    if (/concern|uncertainty|risk|protest|dispute/.test(low)) return 'MEDIUM';
    return 'LOW';
};

let gtiCache = null, gtiCacheTs = 0;

app.get('/api/gti', async (_req, res) => {
    if (gtiCache && Date.now() - gtiCacheTs < 90000) return res.json(gtiCache);
    try {
        const searches = await Promise.all(
            ['RELIANCE.NS', 'TCS.NS', '^NSEI', 'GC=F', 'CL=F'].map(sym =>
                yahooFinance.search(sym, { newsCount: 8 }).catch(() => ({ news: [] }))
            )
        );
        const seen = new Set();
        const allNews = searches.flatMap(r => r.news || [])
            .filter(n => { if (seen.has(n.uuid)) return false; seen.add(n.uuid); return true; });

        const score = computeGTI(allNews);
        const prevScore = gtiCache?.score || score;
        const delta = +(score - prevScore).toFixed(1);
        const level = score >= 80 ? 'CRITICAL' : score >= 60 ? 'ELEVATED' : score >= 35 ? 'MEDIUM' : 'LOW';

        const events = allNews.slice(0, 10).map(n => {
            const pubDate = n.providerPublishTime instanceof Date ? n.providerPublishTime : new Date(n.providerPublishTime * 1000);
            return {
                title: n.title?.length > 55 ? n.title.slice(0, 55) + '…' : n.title,
                region: getRegion(n.title || ''),
                level: getEventLevel(n.title || ''),
                time: pubDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                link: n.link
            };
        });

        gtiCache = { score, delta, level, events, ts: Date.now() };
        gtiCacheTs = Date.now();
        res.json(gtiCache);
    } catch { res.json({ score: 58, delta: 0, level: 'MEDIUM', events: [], ts: Date.now() }); }
});

// ── AI Signals ──
const SIG_STOCKS = [
    { sym: 'RELIANCE.NS', name: 'Reliance Industries', cls: 'Energy' },
    { sym: 'TCS.NS', name: 'Tata Consultancy', cls: 'IT' },
    { sym: 'HDFCBANK.NS', name: 'HDFC Bank', cls: 'Banking' },
    { sym: 'BAJFINANCE.NS', name: 'Bajaj Finance', cls: 'NBFC' },
    { sym: 'ICICIBANK.NS', name: 'ICICI Bank', cls: 'Banking' },
    { sym: 'SBIN.NS', name: 'State Bank of India', cls: 'PSU Banking' },
    { sym: 'TATAMOTORS.NS', name: 'Tata Motors', cls: 'Auto' },
    { sym: 'INFY.NS', name: 'Infosys', cls: 'IT' },
    { sym: 'ADANIENT.NS', name: 'Adani Enterprises', cls: 'Conglomerate' },
    { sym: 'ONGC.NS', name: 'Oil & Natural Gas', cls: 'Energy' },
    { sym: 'TATASTEEL.NS', name: 'Tata Steel', cls: 'Metals' },
    { sym: 'BHARTIARTL.NS', name: 'Bharti Airtel', cls: 'Telecom' },
];

const CLS_DRIVERS = {
    'Energy': 'Crude oil geopolitical premium · OPEC+ stance',
    'IT': 'USD/INR forex impact · US tech earnings cycle',
    'Banking': 'RBI policy outlook · credit growth momentum',
    'NBFC': 'RBI liquidity stance · credit spreads widening',
    'Auto': 'EV transition pressure · input cost inflation',
    'Conglomerate': 'Multi-sector geo-political exposure',
    'PSU Banking': 'Govt capex cycle · NPA resolution progress',
    'Metals': 'China demand proxy · steel tariff risk',
    'Telecom': 'ARPU expansion · 5G spectrum debt load',
};

let sigCache = null, sigCacheTs = 0;

app.get('/api/signals', async (_req, res) => {
    if (sigCache && Date.now() - sigCacheTs < 60000) return res.json(sigCache);
    try {
        const syms = SIG_STOCKS.map(s => s.sym);
        const quotes = await yahooFinance.quote(syms).catch(() => []);
        const qMap = {};
        quotes.forEach(q => { if (q?.symbol) qMap[q.symbol] = q; });

        const p1 = toPeriod1('1mo');
        const charts = await Promise.allSettled(
            syms.map(sym => yahooFinance.chart(sym, { interval: '1d', period1: p1 }).catch(() => null))
        );

        const gtiData = gtiCache || { events: [] };

        const signals = SIG_STOCKS.map(({ sym, name, cls }, i) => {
            const q = qMap[sym] || {};
            const cr = charts[i];
            let rsi = 50, closes = [];

            if (cr.status === 'fulfilled' && cr.value?.quotes) {
                const qs = cr.value.quotes.filter(x => x?.close);
                closes = qs.map(x => x.close);
                if (closes.length >= 14) {
                    const rsiArr = RSI.calculate({ values: closes, period: 14 });
                    if (rsiArr.length) rsi = rsiArr[rsiArr.length - 1];
                }
            }

            const price = q.regularMarketPrice || (closes.length ? closes[closes.length - 1] : 0);
            const change = q.regularMarketChangePercent || 0;
            const direction = rsi < 38 ? 'BUY' : rsi > 62 ? 'SELL' : 'HOLD';
            const extreme = Math.abs(rsi - 50);
            const confidence = Math.min(92, Math.round(52 + extreme * 1.3));
            const bull = Math.round(Math.max(10, 100 - rsi));
            const bear = Math.round(Math.min(90, rsi));

            // Volatility from recent daily returns
            let volLabel = 'MEDIUM';
            if (closes.length > 6) {
                const rets = closes.slice(-8).slice(1).map((c, j) => Math.abs((c - closes[closes.length - 8 + j]) / closes[closes.length - 8 + j]) * 100);
                const avg = rets.reduce((s, r) => s + r, 0) / rets.length;
                volLabel = avg > 2.5 ? 'HIGH' : avg > 1.2 ? 'MEDIUM' : 'LOW';
            }

            // Volume surge
            const avgVol = q.averageDailyVolume10Day || 1;
            const relVol = +((q.regularMarketVolume || 0) / avgVol).toFixed(2);
            const volSurge = relVol >= 1.5;

            const rr = direction === 'BUY' ? '2.1' : direction === 'SELL' ? '1.8' : '1.5';
            const timeframe = extreme > 20 ? 'Short-term' : 'Intraday';
            const geoDriver = (gtiData.events?.[i % Math.max(1, gtiData.events.length)]?.title) || CLS_DRIVERS[cls] || 'Global macro uncertainty';

            return { ticker: sym.replace('.NS', ''), name, cls, price: +price.toFixed(2), change: +change.toFixed(2), direction, confidence, bull, bear, vol: volLabel, relVol, volSurge, rr, timeframe, geoDriver };
        });

        sigCache = signals; sigCacheTs = Date.now();
        res.json(signals);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Live Tape (top Indian stock movers) ──
app.get('/api/livetape', async (_req, res) => {
    if (liveTapeCache.data && Date.now() - liveTapeCache.ts < LIVETAPE_TTL) return res.json(liveTapeCache.data);
    try {
        const quotes = await yahooFinance.quote(NIFTY100_LIST);
        const data = (Array.isArray(quotes) ? quotes : [])
            .filter(q => q?.regularMarketPrice)
            .map(q => ({
                symbol: q.symbol,
                name: (q.shortName || q.symbol.replace('.NS', ''))
                    .replace(' Ltd.', '').replace(' Limited', '').replace(' Ltd', '').trim().slice(0, 18),
                price: q.regularMarketPrice,
                change: q.regularMarketChange || 0,
                changePercent: q.regularMarketChangePercent || 0,
            }))
            .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
            .slice(0, 15);
        if (data.length) liveTapeCache = { data, ts: Date.now() };
        res.json(liveTapeCache.data || data);
    } catch { res.json(liveTapeCache.data || []); }
});

// ── NSE Indices Bar (all key Indian indices) ──
app.get('/api/indicesbar', async (_req, res) => {
    if (indicesBarCache.data && Date.now() - indicesBarCache.ts < INDICESBAR_TTL) return res.json(indicesBarCache.data);
    try {
        const indices = await getNSEIndices();
        const data = NSE_KEY_IDX
            .map(name => indices.find(i => (i.index || i.indexSymbol) === name))
            .filter(Boolean)
            .map(i => ({
                name: i.index || i.indexSymbol,
                price: i.last ?? i.current ?? 0,
                change: i.variation ?? i.change ?? 0,
                changePercent: i.percentChange ?? 0,
            }));
        if (data.length) indicesBarCache = { data, ts: Date.now() };
        res.json(indicesBarCache.data || data);
    } catch { res.json(indicesBarCache.data || []); }
});

// ── Top Movers ──
app.get('/api/movers', async (req, res) => {
    const tf = req.query.tf || '1d';
    if (moversCache[tf] && Date.now() - moversCache[tf].ts < MOVERS_TTL) return res.json(moversCache[tf].data);
    try {
        const [quotes, indices] = await Promise.all([
            yahooFinance.quote(NSE_FNO_LIQUID).catch(() => []),
            yahooFinance.quote(['^NSEI', '^NSEBANK', '^BSESN']).catch(() => []),
        ]);
        const qList = (Array.isArray(quotes) ? quotes : []).filter(q => q?.regularMarketPrice).map(q => ({
            symbol: q.symbol,
            name: cleanName(q.shortName || q.symbol, q.symbol),
            price: +((q.regularMarketPrice || 0).toFixed(2)),
            change: +((q.regularMarketChangePercent || 0).toFixed(2)),
            relVol: +((q.regularMarketVolume || 0) / Math.max(1, q.averageDailyVolume10Day || 1)).toFixed(2),
        }));
        const sorted = [...qList].sort((a, b) => b.change - a.change);
        const gainers = sorted.slice(0, 5);
        const losers = sorted.slice(-5).reverse();
        const indexData = (Array.isArray(indices) ? indices : []).map(q => ({
            symbol: q.symbol, name: q.shortName || q.symbol,
            price: q.regularMarketPrice, change: +((q.regularMarketChangePercent || 0).toFixed(2)),
        }));
        const result = { gainers, losers, indices: indexData, tf };
        moversCache[tf] = { data: result, ts: Date.now() };
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Futures ──
let futuresCache = { data: null, ts: 0 };
const FUTURES_TTL = 10000; // 10s live refresh

app.get('/api/futures', async (_req, res) => {
    if (futuresCache.data && Date.now() - futuresCache.ts < FUTURES_TTL) return res.json(futuresCache.data);
    try {
        // Run MoneyControl GIFT NIFTY, Yahoo Finance (spot + futures), and NSE in parallel
        const [giftRes, yfRes, nseRes] = await Promise.allSettled([
            fetchGiftNifty(),
            yahooFinance.quote(['^DJI', '^GSPC', '^IXIC', 'YM=F', 'NQ=F', 'ES=F', 'CL=F', 'GC=F', 'USDINR=X']),
            getNSEIndices(),
        ]);

        const data = [];

        // GIFT NIFTY from MoneyControl; fallback to NSE NIFTY 50 spot
        if (giftRes.status === 'fulfilled') {
            data.push(giftRes.value);
        } else {
            const nseIdxArr = nseRes.status === 'fulfilled' ? nseRes.value : [];
            const niftySpot = nseIdxArr.find(x => (x.index || x.indexSymbol) === 'NIFTY 50');
            if (niftySpot) {
                data.push({
                    symbol: 'GIFT-NIFTY', name: 'NIFTY 50 (Live)',
                    price: niftySpot.last ?? niftySpot.current,
                    change: niftySpot.variation ?? 0,
                    changePercent: niftySpot.percentChange ?? 0,
                    isLive: true, src: 'NSE Live',
                });
            }
        }

        // US spot + futures + commodities from Yahoo Finance
        const YF_NAMES = {
            '^DJI': 'DOW JONES', '^GSPC': 'S&P 500', '^IXIC': 'NASDAQ',
            'YM=F': 'DOW FUT', 'NQ=F': 'NASDAQ FUT', 'ES=F': 'S&P FUT',
            'CL=F': 'CRUDE OIL', 'GC=F': 'GOLD', 'USDINR=X': 'USD/INR',
        };
        if (yfRes.status === 'fulfilled') {
            (Array.isArray(yfRes.value) ? yfRes.value : []).forEach(q => {
                data.push({
                    symbol: q.symbol, name: YF_NAMES[q.symbol] || q.shortName || q.symbol,
                    price: q.regularMarketPrice, change: q.regularMarketChange,
                    changePercent: q.regularMarketChangePercent,
                    isLive: false, src: 'Yahoo',
                });
            });
        }

        if (data.length) futuresCache = { data, ts: Date.now() };
        res.json(futuresCache.data || data);
    } catch { res.json(futuresCache.data || []); }
});

// ── Country Indices ──
const COUNTRY_INDICES = {
    IND: ['^NSEI', '^NSEBANK', '^BSESN', '^INDIAVIX'],
    USA: ['^DJI', '^GSPC', '^IXIC', '^VIX'],
    JPN: ['^N225'],
    GBR: ['^FTSE'],
    DEU: ['^GDAXI'],
    FRA: ['^FCHI'],
    CHN: ['000001.SS', '^HSI'],
    HKG: ['^HSI', '^HSCE'],
    AUS: ['^AXJO'],
    CAN: ['^GSPTSE'],
    BRA: ['^BVSP'],
    KOR: ['^KS11'],
    TWN: ['^TWII'],
    SGP: ['^STI'],
    ITA: ['FTSEMIB.MI'],
    ESP: ['^IBEX'],
    NLD: ['^AEX'],
    CHE: ['^SSMI'],
    SAU: ['^TASI.SR'],
    MEX: ['^MXX'],
    ARG: ['^MERV'],
    IDN: ['^JKSE'],
    THA: ['^SET.BK'],
    ZAF: ['^J203.JO'],
    POL: ['^WIG20'],
    SWE: ['^OMX'],
    TUR: ['^XU100'],
    RUS: ['IMOEX.ME'],
    ISR: ['^TA125.TA'],
    NOR: ['OBX.OL'],
    MYS: ['^KLSE'],
    PAK: ['^KSE100'],
    PHL: ['PSEi.PS'],
};

const countryCache = {};
const COUNTRY_TTL = 60000;

app.get('/api/country/:iso', async (req, res) => {
    const iso = req.params.iso.toUpperCase();
    const tickers = COUNTRY_INDICES[iso];
    if (!tickers) return res.json({ iso, tickers: [] });
    if (countryCache[iso] && Date.now() - countryCache[iso].ts < COUNTRY_TTL) return res.json(countryCache[iso].data);
    try {
        const r = await yahooFinance.quote(tickers).catch(() => []);
        const data = {
            iso,
            tickers: (Array.isArray(r) ? r : []).map(q => ({
                symbol: q.symbol,
                name: q.shortName || q.longName || q.symbol,
                price: q.regularMarketPrice,
                change: q.regularMarketChange,
                changePercent: q.regularMarketChangePercent,
                currency: q.currency,
            })),
        };
        countryCache[iso] = { data, ts: Date.now() };
        res.json(data);
    } catch { res.json({ iso, tickers: [] }); }
});

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
    // Cache static assets for 7 days (hashed filenames change on rebuild)
    app.use(express.static(path.join(__dirname, 'dist'), {
        maxAge: '7d',
        immutable: true,
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        }
    }));
    app.use((req, res) => {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`ProTrader API Live on ${PORT}`);
    // Pre-warm caches in background so first user gets fast response
    setTimeout(() => {
        fetch(`http://localhost:${PORT}/api/gti`).catch(() => {});
        fetch(`http://localhost:${PORT}/api/news`).catch(() => {});
        fetch(`http://localhost:${PORT}/api/futures`).catch(() => {});
        fetch(`http://localhost:${PORT}/api/indicesbar`).catch(() => {});
        fetch(`http://localhost:${PORT}/api/livetape`).catch(() => {});
    }, 3000);
});
