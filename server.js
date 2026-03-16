const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance(); // Corrected instantiation
const { SMA, EMA, MACD, RSI, BollingerBands, Stochastic, ADX } = require('technicalindicators');

const app = express();

// Security Middlewares
app.use(helmet({
    contentSecurityPolicy: false, // Turn off CSP if it interferes with React dev server or external APIs in this simple app
    crossOriginEmbedderPolicy: false
}));

// Rate Limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Increased to 1000 to accommodate multi-request 15s refresh dashboard
    message: { error: 'Too many requests, please try again later.' }
});

app.use(compression());
app.use(cors());
app.use(express.json());
app.use('/api/', apiLimiter);

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
    const low = t.toLowerCase();
    const k = {
        'Banking':  ['bank', 'hdfc', 'icici', 'axis', 'sbi', 'rbi', 'kotak', 'npa', 'credit', 'nbfc', 'lending'],
        'IT':       ['tcs', 'infy', 'infosys', 'wipro', 'hcl', 'tech mahindra', 'software', 'ai ', 'digital'],
        'Energy':   ['oil', 'reliance', 'crude', 'fuel', 'gas', 'power', 'ongc', 'bpcl', 'petroleum', 'renewable'],
        'Pharma':   ['pharma', 'drug', 'medicine', 'fda', 'cipla', 'sun pharma', 'health', 'vaccine', 'biotech'],
        'Auto':     ['maruti', 'mahindra', 'bajaj auto', 'hero motor', 'ev ', 'electric vehicle', 'automotive'],
        'Metal':    ['steel', 'jswsteel', 'tatasteel', 'hindalco', 'vedanta', 'aluminium', 'copper', 'mining'],
        'Telecom':  ['airtel', 'jio', 'vodafone', 'telecom', '5g', 'spectrum'],
        'Finance':  ['sebi', 'sensex', 'nifty', 'fii', 'ipo', 'bajaj finance', 'stock market', 'equity'],
        'FMCG':     ['hindustan unilever', 'hul', 'nestle', 'dabur', 'fmcg', 'itc'],
        'Realty':   ['real estate', 'dlf', 'housing', 'property', 'realty'],
    };
    const f = Object.keys(k).filter(s => k[s].some(x => low.includes(x)));
    return f.length ? f : ['Broad Market'];
};

// ── Loughran-McDonald Financial Sentiment Lexicon ──
const LM_STRONG_BEAR = ['bankruptcy','bankrupt','fraud','lawsuit','investigation','restatement','sec probe','ponzi','insolvency','criminal','subpoena','recall','breach','default','downgrade','cut','miss','slump','crash','collapse','tumble','plunge','selloff','warning','cut guidance','loss','charges','writedown','impairment','layoffs','job cuts','fired','resign','suspended','halted','delisted'];
const LM_BEAR = ['below expectations','decline','fall','drop','weak','concern','headwinds','slowdown','miss','disappoints','reduces','lowers','cautious','uncertainty','volatile','pressure','challenging','loss','negative','downside','risk','warns','cuts','hurt','drag','weigh','miss estimates','below forecast'];
const LM_STRONG_BULL = ['record revenue','blowout','beat expectations','raised guidance','fda approval','acquisition','buyback','dividend hike','strategic partnership','breakthrough','upgrade','strong buy','outperform','new high','all-time high','profit surge','revenue beat','eps beat','accelerating growth','new contract','major deal'];
const LM_BULL = ['beat','growth','strong','rise','gain','profit','outperform','upgrade','expand','positive','beat estimates','above forecast','increased','higher','improve','optimistic','opportunity','recovery','momentum','bullish','upside','rally','surge','soar','climb'];

const dSent = (text) => {
    const t = (text || '').toLowerCase();
    let score = 0;
    LM_STRONG_BEAR.forEach(w => { if (t.includes(w)) score -= 2; });
    LM_BEAR.forEach(w => { if (t.includes(w)) score -= 1; });
    LM_STRONG_BULL.forEach(w => { if (t.includes(w)) score += 2; });
    LM_BULL.forEach(w => { if (t.includes(w)) score += 1; });
    if (score >= 2) return 'bullish';
    if (score <= -2) return 'bearish';
    if (score === 1) return 'mildly_bullish';
    if (score === -1) return 'mildly_bearish';
    return 'neutral';
};

const sentScore = (text) => {
    const t = (text || '').toLowerCase();
    let score = 0, total = 0;
    LM_STRONG_BEAR.forEach(w => { if (t.includes(w)) { score -= 2; total += 2; } });
    LM_BEAR.forEach(w => { if (t.includes(w)) { score -= 1; total += 1; } });
    LM_STRONG_BULL.forEach(w => { if (t.includes(w)) { score += 2; total += 2; } });
    LM_BULL.forEach(w => { if (t.includes(w)) { score += 1; total += 1; } });
    const confidence = total > 0 ? Math.min(99, Math.round((Math.abs(score) / total) * 100)) : 0;
    return { sentiment: dSent(text), score, confidence };
};

// Legacy score helper (0-100 scale, kept for backwards compat)
const dSentScore = (t) => {
    const s = sentScore(t);
    return Math.max(0, Math.min(100, 50 + s.score * 10));
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
const N  = (x) => 0.5 * (1 + erfApprox(x / Math.SQRT2));
const Np = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); // standard normal PDF

const bsPrice = (S, K, T, r, σ, type) => {
    if (T <= 0) return Math.max(0, type === 'C' ? S - K : K - S);
    const d1 = (Math.log(S / K) + (r + 0.5 * σ * σ) * T) / (σ * Math.sqrt(T));
    const d2 = d1 - σ * Math.sqrt(T);
    return type === 'C' ? S * N(d1) - K * Math.exp(-r * T) * N(d2) : K * Math.exp(-r * T) * N(-d2) - S * N(-d1);
};

// Greeks: returns { delta, gamma, theta, vega }
const bsGreeks = (S, K, T, r, σ, type) => {
    if (T <= 0 || σ <= 0) return { delta: type === 'C' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0 };
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + 0.5 * σ * σ) * T) / (σ * sqrtT);
    const d2 = d1 - σ * sqrtT;
    const nd1 = Np(d1);
    const delta = type === 'C' ? N(d1) : N(d1) - 1;
    const gamma = +(nd1 / (S * σ * sqrtT)).toFixed(6);
    const theta = type === 'C'
        ? +(((-S * nd1 * σ) / (2 * sqrtT) - r * K * Math.exp(-r * T) * N(d2)) / 365).toFixed(2)
        : +(((-S * nd1 * σ) / (2 * sqrtT) + r * K * Math.exp(-r * T) * N(-d2)) / 365).toFixed(2);
    const vega = +(S * nd1 * sqrtT / 100).toFixed(2); // per 1% IV change
    return { delta: +delta.toFixed(3), gamma, theta, vega };
};

// OI change cache: { key → prevOI }  refreshed every snapshot cycle
const prevOICache = new Map();

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
        const putIV  = Math.max(5, iv - m * 12 + 2 + (Math.random() - 0.5) * 2);
        const cPrice = Math.max(0.05, +bsPrice(price, K, T, r, callIV / 100, 'C').toFixed(2));
        const pPrice = Math.max(0.05, +bsPrice(price, K, T, r, putIV  / 100, 'P').toFixed(2));
        const cOI = Math.round(Math.exp(-2.5 * Math.pow(m + 0.005, 2)) * (400000 + Math.random() * 200000));
        const pOI = Math.round(Math.exp(-2.5 * Math.pow(m - 0.005, 2)) * (500000 + Math.random() * 200000));

        // Greeks
        const cG = bsGreeks(price, K, T, r, callIV / 100, 'C');
        const pG = bsGreeks(price, K, T, r, putIV  / 100, 'P');

        // OI change vs previous snapshot
        const cKey = `C_${K}`, pKey = `P_${K}`;
        const cOIChange = prevOICache.has(cKey) ? cOI - prevOICache.get(cKey) : 0;
        const pOIChange = prevOICache.has(pKey) ? pOI - prevOICache.get(pKey) : 0;
        prevOICache.set(cKey, cOI);
        prevOICache.set(pKey, pOI);

        calls.push({ strike: K, lastPrice: cPrice, bid: +(cPrice*0.98).toFixed(2), ask: +(cPrice*1.02).toFixed(2),
            iv: +callIV.toFixed(1), oi: cOI, oiChange: cOIChange,
            vol: Math.round(cOI * 0.25 * Math.random()), inTheMoney: K < price,
            delta: cG.delta, gamma: cG.gamma, theta: cG.theta, vega: cG.vega });
        puts.push({ strike: K, lastPrice: pPrice, bid: +(pPrice*0.98).toFixed(2), ask: +(pPrice*1.02).toFixed(2),
            iv: +putIV.toFixed(1), oi: pOI, oiChange: pOIChange,
            vol: Math.round(pOI * 0.25 * Math.random()), inTheMoney: K > price,
            delta: pG.delta, gamma: pG.gamma, theta: pG.theta, vega: pG.vega });
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

// ── NSE India Live Data ──
const NSE_HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.nseindia.com/',
    'Origin': 'https://www.nseindia.com',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'Connection': 'keep-alive',
};
let nseAllIdxCache = { data: null, ts: 0 };
const NSE_TTL = 3000; // 3s — real-time

// ── NSE Cookie Management (required for option-chain API) ──
// NSE option-chain requires a valid browser session (nsit + nseappid cookies).
// We establish a session by hitting the homepage first, then the OC page.
let nseCookieCache = { cookies: '', ts: 0 };
const NSE_COOKIE_TTL = 4 * 60 * 1000; // 4 min — NSE cookies expire ~5 min
let lastKnownPCR = { value: null, ts: 0 }; // persist PCR across market-closed periods

function parseSetCookies(headers) {
    // headers.get('set-cookie') may return comma-joined or single string
    const raw = headers.get('set-cookie') || '';
    const cookies = {};
    // Split on "," that precede a cookie name (not inside expires date)
    const parts = raw.split(/,\s*(?=[a-zA-Z0-9_-]+=)/);
    parts.forEach(part => {
        const seg = part.split(';')[0].trim();
        const eq = seg.indexOf('=');
        if (eq > 0) {
            const k = seg.slice(0, eq).trim();
            const v = seg.slice(eq + 1).trim();
            if (k) cookies[k] = v;
        }
    });
    return cookies;
}

function cookiesToStr(obj) {
    return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function getNSESession() {
    if (nseCookieCache.cookies && Date.now() - nseCookieCache.ts < NSE_COOKIE_TTL) {
        return nseCookieCache.cookies;
    }
    try {
        // Step 1: hit homepage to get initial nsit / nseappid cookies
        const r1 = await fetch('https://www.nseindia.com', {
            headers: { ...NSE_HDR, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
            signal: AbortSignal.timeout(10000),
        });
        const c1 = parseSetCookies(r1.headers);

        await new Promise(res => setTimeout(res, 600)); // small delay mimics human

        // Step 2: hit the option-chain page to get additional session tokens
        const r2 = await fetch('https://www.nseindia.com/option-chain', {
            headers: { ...NSE_HDR,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                Cookie: cookiesToStr(c1),
            },
            signal: AbortSignal.timeout(10000),
        });
        const c2 = parseSetCookies(r2.headers);

        const merged = cookiesToStr({ ...c1, ...c2 });
        nseCookieCache = { cookies: merged, ts: Date.now() };
        return merged;
    } catch { return ''; }
}

async function fetchNSEOptionChain(symbol = 'NIFTY') {
    const cookies = await getNSESession();
    const url = `https://www.nseindia.com/api/option-chain-indices?symbol=${symbol}`;
    const r = await fetch(url, {
        headers: { ...NSE_HDR, Cookie: cookies, Referer: 'https://www.nseindia.com/option-chain' },
        signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
        // Invalidate cookies on 401/403 so next call refreshes
        if (r.status === 401 || r.status === 403) nseCookieCache = { cookies: '', ts: 0 };
        throw new Error(`NSE OC HTTP ${r.status}`);
    }
    return r.json();
}

// ── NIFTY 500 representative universe for live tape & breadth ──
const NIFTY100_LIST = [
    // NIFTY 50
    'RELIANCE.NS','TCS.NS','HDFCBANK.NS','INFY.NS','ICICIBANK.NS','HINDUNILVR.NS','ITC.NS',
    'SBIN.NS','BHARTIARTL.NS','KOTAKBANK.NS','LT.NS','AXISBANK.NS','ASIANPAINT.NS','MARUTI.NS',
    'TITAN.NS','WIPRO.NS','BAJFINANCE.NS','ONGC.NS','NTPC.NS','POWERGRID.NS','SUNPHARMA.NS',
    'HCLTECH.NS','TECHM.NS','BAJAJFINSV.NS','CIPLA.NS','DRREDDY.NS','EICHERMOT.NS',
    'TATAMOTORS.NS','TATASTEEL.NS','JSWSTEEL.NS','COALINDIA.NS','GRASIM.NS','DIVISLAB.NS',
    'BPCL.NS','HEROMOTOCO.NS','SBILIFE.NS','HDFCLIFE.NS','NESTLEIND.NS','ADANIPORTS.NS',
    'ULTRACEMCO.NS','INDUSINDBK.NS','APOLLOHOSP.NS','TRENT.NS','BAJAJ-AUTO.NS','SHREECEM.NS',
    'M&M.NS','UPL.NS','BRITANNIA.NS','TATACONSUM.NS','ADANIENT.NS','HINDALCO.NS',
    // NIFTY Next 50
    'DMART.NS','ZOMATO.NS','IRCTC.NS','DLF.NS','HAVELLS.NS','GODREJCP.NS','COLPAL.NS',
    'MARICO.NS','SIEMENS.NS','TATAPOWER.NS','PIDILITE.NS','MUTHOOTFIN.NS','NAUKRI.NS',
    'GAIL.NS','IOC.NS','PNB.NS','CANBK.NS','FEDERALBNK.NS','CHOLAFIN.NS','INDUSTOWER.NS',
    'BEL.NS','NMDC.NS','SAIL.NS','HINDZINC.NS','LUPIN.NS','TORNTPHARM.NS','AUROPHARMA.NS',
    'GODREJPROP.NS','AMBUJACEM.NS','BIOCON.NS','CONCOR.NS','BANDHANBNK.NS','MPHASIS.NS',
    'OFSS.NS','PAGEIND.NS','POLYCAB.NS','VEDL.NS','BALKRISIND.NS','SBICARD.NS','ICICIPRULI.NS',
    // Large/Mid Cap additions
    'JUBLFOOD.NS','BERGEPAINT.NS','CUMMINSIND.NS','ATGL.NS','MOTHERSON.NS','JKCEMENT.NS',
    'PGHH.NS','MFSL.NS','ABBOTINDIA.NS','ATUL.NS',
    // NIFTY Midcap 150 additions
    'LTIM.NS','PERSISTENT.NS','COFORGE.NS','MPHASIS.NS','OFSS.NS','ANGELONE.NS',
    'PAYTM.NS','ZYDUSLIFE.NS','ALKEM.NS','IPCALAB.NS','GLAXO.NS','PFIZER.NS',
    'VOLTAS.NS','WHIRLPOOL.NS','BLUESTARCO.NS','SYMPHONY.NS','KAJARIA.NS',
    'SUPREMEIND.NS','ASTRAL.NS','FINPIPE.NS','APOLLOTYRE.NS','MRF.NS','CEATLTD.NS',
    'ESCORTS.NS','TIINDIA.NS','SCHAEFFLER.NS','SKFINDIA.NS','TIMKEN.NS',
    'NHPC.NS','SJVN.NS','RVNL.NS','IRFC.NS','RAILVIKAS.NS','HUDCO.NS',
    'GPPL.NS','ADANIGREEN.NS','ADANITRANS.NS','TORNTPOWER.NS','CESC.NS',
    'NATIONALUM.NS','HINDCOPPER.NS','MOIL.NS','RATNAMANI.NS','WELCORP.NS',
    'KPITTECH.NS','TATAELXSI.NS','LTTS.NS','CYIENT.NS','MASTEK.NS',
    'IDFCFIRSTB.NS','AUBANK.NS','RBLBANK.NS','KARURVYSYA.NS','DCBBANK.NS',
    'SBICARD.NS','ICICIPRULI.NS','ICICIGI.NS','HDFCAMC.NS','LICI.NS',
    'RECLTD.NS','PFC.NS','IRCTC.NS','CONCOR.NS','CONTAINER.NS',
    'DELHIVERY.NS','BLUE DART.NS','GLAND.NS','GRANULES.NS','SUVEN.NS',
    'MAXHEALTH.NS','RAINBOW.NS','KIMS.NS','FORTIS.NS','NH.NS',
    'NYKAA.NS','CARTRADE.NS','POLICYBZR.NS','MAPMYINDIA.NS',
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

const RSS_SOURCES = [
    { url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', pub: 'Economic Times' },
    { url: 'https://www.moneycontrol.com/rss/latestnews.xml', pub: 'MoneyControl' },
    { url: 'https://www.livemint.com/rss/markets', pub: 'Livemint' },
    { url: 'https://www.business-standard.com/rss/markets-106.rss', pub: 'Business Standard' },
    { url: 'https://feeds.feedburner.com/ndtvprofit-latest', pub: 'NDTV Profit' },
    { url: 'https://zeenews.india.com/business/rss.xml', pub: 'Zee Business' },
];

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

const HIGH_IMPACT_WORDS = [
    'rbi', 'crash', 'surge', 'fed', 'interest rate', 'nifty', 'sensex', 'sebi', 'budget', 'gdp',
    'rate hike', 'rate cut', 'inflation', 'recession', 'war', 'sanctions', 'ban', 'crisis',
    'default', 'collapse', 'record high', 'all-time high', 'circuit', 'fii', 'tariff', 'oil price',
];

const mapNewsItem = (title, link, publisher, timestamp) => {
    const ss = sentScore(title);
    return {
        title, link, publisher,
        timestamp,
        time: getRelativeTime(new Date(timestamp)),
        rawTime: new Date(timestamp).toLocaleString('en-IN'),
        sectors: dSec(title),
        sentiment: ss.sentiment,
        sentimentScore: ss.score,
        confidence: ss.confidence,
        indiaImpact: dIndiaImpact(title),
        highImpact: HIGH_IMPACT_WORDS.some(w => title.toLowerCase().includes(w)),
        confirmed: false,
    };
};

app.get('/api/globalnews', async (req, res) => {
    const now = Date.now();
    try {
        // Multi-source RSS (all sources in parallel)
        const getRSS = async () => {
            if (rssCache.data && now - rssCache.ts < RSS_TTL) return rssCache.data;
            const results = await Promise.allSettled(
                RSS_SOURCES.map(s => fetchRSS(s.url, 15).then(items =>
                    items.map(i => mapNewsItem(i.title, i.link, s.pub, i.ts))
                ))
            );
            const mapped = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
            rssCache = { data: mapped, ts: now };
            return mapped;
        };

        // Yahoo Finance secondary source
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
        const deduped = [...rssItems, ...yfItems]
            .filter(n => {
                const key = (n.title || '').slice(0, 45).toLowerCase().replace(/\s+/g, '');
                if (seen.has(key)) return false;
                seen.add(key); return true;
            })
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, 50);

        // Cross-source confirmation: mark items covered by 2+ publishers
        const merged = deduped.map(item => {
            const words = (item.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 4);
            const confirmedBy = deduped.filter(other =>
                other !== item &&
                other.publisher !== item.publisher &&
                words.filter(w => (other.title || '').toLowerCase().includes(w)).length >= 3
            );
            return confirmedBy.length > 0 ? { ...item, confirmed: true } : item;
        });

        res.json(merged);
    } catch { res.json([]); }
});

app.get('/api/options/:ticker', async (req, res) => {
    try {
        const rawTicker = req.params.ticker;
        // Sanitize ticker input
        const ticker = rawTicker.toUpperCase().replace(/[^A-Z0-9^.=\-_]/g, '');
        if (!ticker || ticker.length < 1 || ticker.length > 20) {
            return res.status(400).json({ error: 'Invalid ticker symbol' });
        }
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

        // Sanitize ticker: allow alphanumeric, ^, ., =, -, _ only
        const sym = ticker.toUpperCase().replace(/[^A-Z0-9^.=\-_]/g, '');
        if (!sym || sym.length < 1 || sym.length > 20) {
            return res.status(400).json({ error: 'Invalid ticker symbol' });
        }
        const isIntraday = interval.includes('m') || interval === '1h';
        // For intraday: fetch 5d so MACD (26+) always has enough candles
        const intradayRange = interval === '1m' ? '2d' : '5d';
        const mainRangeKey  = isIntraday ? intradayRange : (period || '6mo');
        const params = { interval, period1: toPeriod1(mainRangeKey) };

        // Fetch: main chart + daily chart + quote + summary + news + 1y weekly chart (for 52w h/l)
        const [quote, summary, chart, dailyChart, searchRes, weekly1yChart] = await Promise.all([
            yahooFinance.quote(sym).catch(() => ({})),
            yahooFinance.quoteSummary(sym, { modules: ['summaryDetail', 'financialData', 'defaultKeyStatistics'] }).catch(() => ({})),
            yahooFinance.chart(sym, params).catch(() => ({ quotes: [] })),
            // Always fetch last 5 daily candles for pivot/prev-day context
            yahooFinance.chart(sym, { interval: '1d', period1: toPeriod1('5d') }).catch(() => ({ quotes: [] })),
            yahooFinance.search(sym, { newsCount: 15 }).catch(() => ({ news: [] })),
            yahooFinance.chart(sym, { interval: '1wk', range: '1y' }).catch(() => ({ quotes: [] }))
        ]);

        const q = (chart?.quotes || []).filter(x => x && x.close != null);
        const dq = (dailyChart?.quotes || []).filter(x => x && x.close != null); // daily candles

        const price = quote.regularMarketPrice || (q.length ? q[q.length - 1].close : 0);

        // ── Supplement missing quote fields from chart data ──
        // For NSE indices Yahoo often returns 0 for dayHigh/dayLow — use chart data instead
        const todayCandles = q;
        const chartDayHigh = todayCandles.length ? Math.max(...todayCandles.map(x => x.high).filter(Boolean)) : 0;
        const chartDayLow  = todayCandles.length ? Math.min(...todayCandles.map(x => x.low).filter(v => v > 0)) : 0;
        // Previous day OHLC from daily chart (second-to-last candle)
        const prevDayCandle = dq.length >= 2 ? dq[dq.length - 2] : dq.length === 1 ? dq[0] : null;

        const dayHigh    = quote.regularMarketDayHigh  || chartDayHigh  || null;
        const dayLow     = quote.regularMarketDayLow   || chartDayLow   || null;
        const prevClose  = quote.regularMarketPreviousClose || prevDayCandle?.close || null;
        const openPrice  = quote.regularMarketOpen     || (todayCandles[0]?.open) || null;
        
        let wkHigh52   = quote.fiftyTwoWeekHigh      || null;
        let wkLow52    = quote.fiftyTwoWeekLow       || null;
        if ((!wkHigh52 || !wkLow52) && weekly1yChart?.quotes?.length) {
            const wQuotes = weekly1yChart.quotes.filter(x => x && x.high != null && x.low != null);
            if (wQuotes.length) {
                wkHigh52 = Math.max(...wQuotes.map(q => q.high));
                wkLow52 = Math.min(...wQuotes.map(q => q.low));
            }
        }

        // ── Volume spike detection ──
        const volumes = q.map(x => x.volume || 0).filter(v => v > 0);
        const avgVol10 = volumes.length > 2
            ? volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1)
            : 0;
        const lastVol = volumes[volumes.length - 1] || 0;
        const volSpikeRatio = avgVol10 > 0 ? +(lastVol / avgVol10).toFixed(2) : null;
        const volSpike = volSpikeRatio != null && volSpikeRatio >= 1.5;

        // ── Technicals ──
        let tech = null;
        if (q.length > 5) {
            const cl = q.map(x => x.close), hi = q.map(x => x.high), lo = q.map(x => x.low);

            // Proper pivot: use PREVIOUS DAY's H/L/C (not current candle)
            const pivH = prevDayCandle?.high  || hi[hi.length - 1];
            const pivL = prevDayCandle?.low   || lo[lo.length - 1];
            const pivC = prevDayCandle?.close || cl[cl.length - 1];
            const P = (pivH + pivL + pivC) / 3;

            const rsi  = q.length >= 14 ? RSI.calculate({ values: cl, period: 14 }).pop() : null;
            const macd = q.length >= 26 ? MACD.calculate({ values: cl, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }).pop() : null;
            const bb   = q.length >= 20 ? BollingerBands.calculate({ values: cl, period: 20, stdDev: 2 }).pop() : null;
            const adx  = q.length >= 14 ? ADX.calculate({ high: hi, low: lo, close: cl, period: 14 }).pop() : null;

            // VWAP (intraday only — sum(price*vol) / sum(vol))
            let vwap = null;
            if (isIntraday && volumes.length > 0) {
                const totalPV = q.reduce((s, x) => s + ((x.high + x.low + x.close) / 3) * (x.volume || 0), 0);
                const totalV  = q.reduce((s, x) => s + (x.volume || 0), 0);
                vwap = totalV > 0 ? +(totalPV / totalV).toFixed(2) : null;
            }

            // IV Rank: current HV vs 52-week HV range (proxy using daily close returns)
            let ivRank = null, ivPercentile = null, hvCurrent = null;
            if (dq.length >= 30) {
                const dcl = dq.map(x => x.close).filter(Boolean);
                const dailyReturns = dcl.slice(1).map((c, j) => Math.log(c / dcl[j]));
                // rolling 30-day HV
                const hvWindows = [];
                for (let w = 0; w + 30 <= dailyReturns.length; w++) {
                    const window = dailyReturns.slice(w, w + 30);
                    const mean = window.reduce((a, b) => a + b, 0) / 30;
                    const variance = window.reduce((s, r) => s + (r - mean) ** 2, 0) / 30;
                    hvWindows.push(Math.sqrt(variance * 252) * 100);
                }
                if (hvWindows.length >= 2) {
                    hvCurrent = +hvWindows[hvWindows.length - 1].toFixed(1);
                    const hvMin = Math.min(...hvWindows), hvMax = Math.max(...hvWindows);
                    ivRank = hvMax > hvMin ? +((hvCurrent - hvMin) / (hvMax - hvMin) * 100).toFixed(0) : 50;
                    const below = hvWindows.filter(h => h <= hvCurrent).length;
                    ivPercentile = +((below / hvWindows.length) * 100).toFixed(0);
                }
            }

            tech = {
                rsi: rsi != null ? +rsi.toFixed(2) : null,
                macd,
                ema9:  q.length >= 9   ? +EMA.calculate({ values: cl, period: 9 }).pop().toFixed(2)   : null,
                ema21: q.length >= 21  ? +EMA.calculate({ values: cl, period: 21 }).pop().toFixed(2)  : null,
                sma50: q.length >= 50  ? +SMA.calculate({ values: cl, period: 50 }).pop().toFixed(2)  : null,
                sma200:q.length >= 200 ? +SMA.calculate({ values: cl, period: 200 }).pop().toFixed(2) : null,
                stochastic: q.length >= 14 ? Stochastic.calculate({ high: hi, low: lo, close: cl, period: 14, signalPeriod: 3 }).pop() : null,
                bb, adx, vwap,
                ivRank, ivPercentile, hvCurrent,
                pivots: { pivot: +P.toFixed(2), r1: +(2*P - pivL).toFixed(2), s1: +(2*P - pivH).toFixed(2), r2: +(P + (pivH-pivL)).toFixed(2), s2: +(P - (pivH-pivL)).toFixed(2) },
                prevDayH: prevDayCandle?.high  || null,
                prevDayL: prevDayCandle?.low   || null,
                prevDayC: prevDayCandle?.close || null,
                volSpike, volSpikeRatio,
                candleCount: q.length,
            };
        }

        const det = summary.summaryDetail || {}, f = summary.financialData || {}, ks = summary.defaultKeyStatistics || {};
        const fmtCap = v => v >= 1e12 ? (v/1e12).toFixed(2)+'T' : v >= 1e9 ? (v/1e9).toFixed(2)+'B' : v >= 1e6 ? (v/1e6).toFixed(2)+'M' : String(v);

        res.json({
            ticker: sym, companyName: quote.shortName || sym, price,
            change: quote.regularMarketChange || 0,
            changePercent: quote.regularMarketChangePercent || 0,
            volume: quote.regularMarketVolume || lastVol || null,
            openPrice, dayHigh, dayLow, prevClose,
            fiftyTwoWeekHigh: wkHigh52, fiftyTwoWeekLow: wkLow52,
            avgVolume: quote.averageDailyVolume3Month || null,
            volSpike, volSpikeRatio,
            currency: quote.currency || 'INR',
            isIndex: sym.startsWith('^'),
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
                return { action, confidence: Math.min(95, Math.round(55 + Math.abs(norm) * 22)),
                    targetArea: price * (norm >= 0 ? 1.055 : 1.02), stopLoss: price * (norm >= 0 ? 0.965 : 0.95) };
            })(),
            chartData: q.map(x => ({
                time: isIntraday ? Math.floor(new Date(x.date).getTime() / 1000) : x.date.toISOString().split('T')[0],
                open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume || 0
            })),
            news: searchRes.news.map(n => {
                const pubDate = n.providerPublishTime instanceof Date ? n.providerPublishTime : new Date(n.providerPublishTime * 1000);
                const ss = sentScore(n.title);
                return { title: n.title, link: n.link, publisher: n.publisher, time: getRelativeTime(pubDate), sentiment: ss.sentiment, sentimentScore: ss.score, confidence: ss.confidence, sectors: dSec(n.title) };
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

// ── AI Signals — Full NIFTY 50 universe ──
const SIG_STOCKS = [
    { sym: 'RELIANCE.NS',   name: 'Reliance Industries',     cls: 'Energy'       },
    { sym: 'TCS.NS',        name: 'Tata Consultancy',        cls: 'IT'           },
    { sym: 'HDFCBANK.NS',   name: 'HDFC Bank',               cls: 'Banking'      },
    { sym: 'INFY.NS',       name: 'Infosys',                 cls: 'IT'           },
    { sym: 'ICICIBANK.NS',  name: 'ICICI Bank',              cls: 'Banking'      },
    { sym: 'HINDUNILVR.NS', name: 'Hindustan Unilever',      cls: 'FMCG'        },
    { sym: 'ITC.NS',        name: 'ITC Limited',             cls: 'FMCG'        },
    { sym: 'SBIN.NS',       name: 'State Bank of India',     cls: 'PSU Banking'  },
    { sym: 'BHARTIARTL.NS', name: 'Bharti Airtel',           cls: 'Telecom'      },
    { sym: 'KOTAKBANK.NS',  name: 'Kotak Mahindra Bank',     cls: 'Banking'      },
    { sym: 'LT.NS',         name: 'Larsen & Toubro',         cls: 'Infrastructure'},
    { sym: 'AXISBANK.NS',   name: 'Axis Bank',               cls: 'Banking'      },
    { sym: 'ASIANPAINT.NS', name: 'Asian Paints',            cls: 'Consumer'     },
    { sym: 'MARUTI.NS',     name: 'Maruti Suzuki',           cls: 'Auto'         },
    { sym: 'TITAN.NS',      name: 'Titan Company',           cls: 'Consumer'     },
    { sym: 'BAJFINANCE.NS', name: 'Bajaj Finance',           cls: 'NBFC'         },
    { sym: 'SUNPHARMA.NS',  name: 'Sun Pharma',              cls: 'Pharma'       },
    { sym: 'WIPRO.NS',      name: 'Wipro',                   cls: 'IT'           },
    { sym: 'HCLTECH.NS',    name: 'HCL Technologies',        cls: 'IT'           },
    { sym: 'BAJAJFINSV.NS', name: 'Bajaj Finserv',           cls: 'NBFC'         },
    { sym: 'NTPC.NS',       name: 'NTPC Limited',            cls: 'Power'        },
    { sym: 'POWERGRID.NS',  name: 'Power Grid Corp',         cls: 'Power'        },
    { sym: 'TECHM.NS',      name: 'Tech Mahindra',           cls: 'IT'           },
    { sym: 'TATAMOTORS.NS', name: 'Tata Motors',             cls: 'Auto'         },
    { sym: 'ADANIENT.NS',   name: 'Adani Enterprises',       cls: 'Conglomerate' },
    { sym: 'TATASTEEL.NS',  name: 'Tata Steel',              cls: 'Metals'       },
    { sym: 'JSWSTEEL.NS',   name: 'JSW Steel',               cls: 'Metals'       },
    { sym: 'ONGC.NS',       name: 'Oil & Natural Gas',       cls: 'Energy'       },
    { sym: 'HINDALCO.NS',   name: 'Hindalco Industries',     cls: 'Metals'       },
    { sym: 'COALINDIA.NS',  name: 'Coal India',              cls: 'Mining'       },
    { sym: 'EICHERMOT.NS',  name: 'Eicher Motors',           cls: 'Auto'         },
    { sym: 'HEROMOTOCO.NS', name: 'Hero MotoCorp',           cls: 'Auto'         },
    { sym: 'BAJAJ-AUTO.NS', name: 'Bajaj Auto',              cls: 'Auto'         },
    { sym: 'GRASIM.NS',     name: 'Grasim Industries',       cls: 'Cement'       },
    { sym: 'CIPLA.NS',      name: 'Cipla',                   cls: 'Pharma'       },
    { sym: 'DRREDDY.NS',    name: "Dr. Reddy's Labs",        cls: 'Pharma'       },
    { sym: 'DIVISLAB.NS',   name: "Divi's Laboratories",     cls: 'Pharma'       },
    { sym: 'NESTLEIND.NS',  name: 'Nestle India',            cls: 'FMCG'        },
    { sym: 'APOLLOHOSP.NS', name: 'Apollo Hospitals',        cls: 'Healthcare'   },
    { sym: 'TATACONSUM.NS', name: 'Tata Consumer Products',  cls: 'FMCG'        },
    { sym: 'ULTRACEMCO.NS', name: 'UltraTech Cement',        cls: 'Cement'       },
    { sym: 'BPCL.NS',       name: 'Bharat Petroleum',        cls: 'Energy'       },
    { sym: 'ADANIPORTS.NS', name: 'Adani Ports',             cls: 'Logistics'    },
    { sym: 'INDUSINDBK.NS', name: 'IndusInd Bank',           cls: 'Banking'      },
    { sym: 'TRENT.NS',      name: 'Trent',                   cls: 'Retail'       },
    { sym: 'SBILIFE.NS',    name: 'SBI Life Insurance',      cls: 'Insurance'    },
    { sym: 'HDFCLIFE.NS',   name: 'HDFC Life Insurance',     cls: 'Insurance'    },
    { sym: 'SHREECEM.NS',   name: 'Shree Cement',            cls: 'Cement'       },
    { sym: 'M&M.NS',        name: 'Mahindra & Mahindra',     cls: 'Auto'         },
    { sym: 'UPL.NS',        name: 'UPL Limited',             cls: 'Agro'         },
    { sym: 'BRITANNIA.NS',  name: 'Britannia Industries',    cls: 'FMCG'        },
    // NIFTY Next 50 + F&O active additions
    { sym: 'BANKBARODA.NS', name: 'Bank of Baroda',          cls: 'PSU Banking'  },
    { sym: 'PNB.NS',        name: 'Punjab National Bank',    cls: 'PSU Banking'  },
    { sym: 'CANBK.NS',      name: 'Canara Bank',             cls: 'PSU Banking'  },
    { sym: 'UNIONBANK.NS',  name: 'Union Bank of India',     cls: 'PSU Banking'  },
    { sym: 'FEDERALBNK.NS', name: 'Federal Bank',            cls: 'Banking'      },
    { sym: 'IDFCFIRSTB.NS', name: 'IDFC First Bank',         cls: 'Banking'      },
    { sym: 'BANDHANBNK.NS', name: 'Bandhan Bank',            cls: 'Banking'      },
    { sym: 'AUBANK.NS',     name: 'AU Small Finance Bank',   cls: 'Banking'      },
    { sym: 'CHOLAFIN.NS',   name: 'Cholamandalam Finance',   cls: 'NBFC'         },
    { sym: 'LICHSGFIN.NS',  name: 'LIC Housing Finance',     cls: 'NBFC'         },
    { sym: 'MUTHOOTFIN.NS', name: 'Muthoot Finance',         cls: 'NBFC'         },
    { sym: 'PIDILITIND.NS', name: 'Pidilite Industries',     cls: 'Consumer'     },
    { sym: 'BERGEPAINT.NS', name: 'Berger Paints',           cls: 'Consumer'     },
    { sym: 'HAVELLS.NS',    name: 'Havells India',           cls: 'Consumer'     },
    { sym: 'SIEMENS.NS',    name: 'Siemens India',           cls: 'Capital Goods'},
    { sym: 'ABB.NS',        name: 'ABB India',               cls: 'Capital Goods'},
    { sym: 'BOSCHLTD.NS',   name: 'Bosch India',             cls: 'Auto'         },
    { sym: 'CGPOWER.NS',    name: 'CG Power',                cls: 'Capital Goods'},
    { sym: 'POLYCAB.NS',    name: 'Polycab India',           cls: 'Capital Goods'},
    { sym: 'TATAPOWER.NS',  name: 'Tata Power',              cls: 'Power'        },
    { sym: 'TORNTPHARM.NS', name: 'Torrent Pharma',          cls: 'Pharma'       },
    { sym: 'LUPIN.NS',      name: 'Lupin Limited',           cls: 'Pharma'       },
    { sym: 'BIOCON.NS',     name: 'Biocon Limited',          cls: 'Pharma'       },
    { sym: 'ALKEM.NS',      name: 'Alkem Laboratories',      cls: 'Pharma'       },
    { sym: 'AUROPHARMA.NS', name: 'Aurobindo Pharma',        cls: 'Pharma'       },
    { sym: 'CONCOR.NS',     name: 'Container Corp of India', cls: 'Logistics'    },
    { sym: 'IRCTC.NS',      name: 'Indian Railway Catering', cls: 'PSU Services' },
    { sym: 'RECLTD.NS',     name: 'REC Limited',             cls: 'PSU Finance'  },
    { sym: 'PFC.NS',        name: 'Power Finance Corp',      cls: 'PSU Finance'  },
    { sym: 'BHEL.NS',       name: 'Bharat Heavy Electricals',cls: 'PSU Capital'  },
    { sym: 'SAIL.NS',       name: 'Steel Authority of India',cls: 'Metals'       },
    { sym: 'VEDL.NS',       name: 'Vedanta Limited',         cls: 'Metals'       },
    { sym: 'HINDZINC.NS',   name: 'Hindustan Zinc',          cls: 'Metals'       },
    { sym: 'BALKRISIND.NS', name: 'Balkrishna Industries',   cls: 'Auto'         },
    { sym: 'DEEPAKNTR.NS',  name: 'Deepak Nitrite',          cls: 'Chemicals'    },
    { sym: 'PIIND.NS',      name: 'PI Industries',           cls: 'Agro'         },
    { sym: 'LTIM.NS',       name: 'LTIMindtree',             cls: 'IT'           },
    { sym: 'PERSISTENT.NS', name: 'Persistent Systems',      cls: 'IT'           },
    { sym: 'COFORGE.NS',    name: 'Coforge Limited',         cls: 'IT'           },
    { sym: 'MPHASIS.NS',    name: 'Mphasis Limited',         cls: 'IT'           },
    { sym: 'OFSS.NS',       name: 'Oracle Financial Services',cls: 'IT'          },
    { sym: 'NAUKRI.NS',     name: 'Info Edge (Naukri)',      cls: 'Internet'     },
    { sym: 'ZOMATO.NS',     name: 'Zomato',                  cls: 'Internet'     },
    { sym: 'PAYTM.NS',      name: 'One 97 Comm (Paytm)',     cls: 'Fintech'      },
    { sym: 'ANGELONE.NS',   name: 'Angel One',               cls: 'Fintech'      },
    { sym: 'DMART.NS',      name: 'Avenue Supermarts (DMart)',cls: 'Retail'       },
    { sym: 'PAGEIND.NS',    name: 'Page Industries (Jockey)',cls: 'Consumer'     },
    { sym: 'ASTRAL.NS',     name: 'Astral Limited',          cls: 'Consumer'     },
    { sym: 'LICI.NS',       name: 'LIC of India',            cls: 'Insurance'    },
    { sym: 'ICICIGI.NS',    name: 'ICICI Lombard Insurance', cls: 'Insurance'    },
    { sym: 'HDFCAMC.NS',    name: 'HDFC AMC',                cls: 'Asset Mgmt'   },
    // Midcap F&O eligible additions
    { sym: 'TATAELXSI.NS',  name: 'Tata Elxsi',              cls: 'IT'           },
    { sym: 'LTTS.NS',       name: 'L&T Technology Services', cls: 'IT'           },
    { sym: 'KPITTECH.NS',   name: 'KPIT Technologies',       cls: 'IT'           },
    { sym: 'CYIENT.NS',     name: 'Cyient Limited',          cls: 'IT'           },
    { sym: 'MRF.NS',        name: 'MRF Limited',             cls: 'Auto'         },
    { sym: 'APOLLOTYRE.NS', name: 'Apollo Tyres',            cls: 'Auto'         },
    { sym: 'ESCORTS.NS',    name: 'Escorts Kubota',          cls: 'Auto'         },
    { sym: 'MOTHERSON.NS',  name: 'Samvardhana Motherson',   cls: 'Auto'         },
    { sym: 'ZYDUSLIFE.NS',  name: 'Zydus Lifesciences',      cls: 'Pharma'       },
    { sym: 'ALKEM.NS',      name: 'Alkem Laboratories',      cls: 'Pharma'       },
    { sym: 'IPCALAB.NS',    name: 'IPCA Laboratories',       cls: 'Pharma'       },
    { sym: 'GRANULES.NS',   name: 'Granules India',          cls: 'Pharma'       },
    { sym: 'VOLTAS.NS',     name: 'Voltas Limited',          cls: 'Consumer'     },
    { sym: 'WHIRLPOOL.NS',  name: 'Whirlpool of India',      cls: 'Consumer'     },
    { sym: 'KAJARIA.NS',    name: 'Kajaria Ceramics',        cls: 'Consumer'     },
    { sym: 'SUPREMEIND.NS', name: 'Supreme Industries',      cls: 'Consumer'     },
    { sym: 'NHPC.NS',       name: 'NHPC Limited',            cls: 'Power'        },
    { sym: 'SJVN.NS',       name: 'SJVN Limited',            cls: 'Power'        },
    { sym: 'RVNL.NS',       name: 'Rail Vikas Nigam',        cls: 'Infrastructure'},
    { sym: 'IRFC.NS',       name: 'Indian Railway Finance',  cls: 'PSU Finance'  },
    { sym: 'HUDCO.NS',      name: 'HUDCO',                   cls: 'PSU Finance'  },
    { sym: 'ADANIGREEN.NS', name: 'Adani Green Energy',      cls: 'Power'        },
    { sym: 'NATIONALUM.NS', name: 'National Aluminium',      cls: 'Metals'       },
    { sym: 'HINDCOPPER.NS', name: 'Hindustan Copper',        cls: 'Metals'       },
    { sym: 'MOIL.NS',       name: 'MOIL Limited',            cls: 'Metals'       },
    { sym: 'IDFCFIRSTB.NS', name: 'IDFC First Bank',         cls: 'Banking'      },
    { sym: 'RBLBANK.NS',    name: 'RBL Bank',                cls: 'Banking'      },
    { sym: 'SBICARD.NS',    name: 'SBI Cards',               cls: 'Fintech'      },
    { sym: 'ICICIPRULI.NS', name: 'ICICI Prudential Life',   cls: 'Insurance'    },
    { sym: 'MAXHEALTH.NS',  name: 'Max Healthcare',          cls: 'Healthcare'   },
    { sym: 'FORTIS.NS',     name: 'Fortis Healthcare',       cls: 'Healthcare'   },
    { sym: 'RECLTD.NS',     name: 'REC Limited',             cls: 'PSU Finance'  },
    { sym: 'PFC.NS',        name: 'Power Finance Corp',      cls: 'PSU Finance'  },
    { sym: 'NYKAA.NS',      name: 'FSN E-Commerce (Nykaa)', cls: 'Retail'       },
    { sym: 'POLICYBZR.NS',  name: 'PB Fintech (PolicyBazaar)',cls: 'Fintech'     },
    { sym: 'DELHIVERY.NS',  name: 'Delhivery Limited',       cls: 'Logistics'    },
];

const CLS_DRIVERS = {
    'Energy':         'Crude oil geopolitical premium · OPEC+ stance',
    'IT':             'USD/INR forex impact · US tech earnings cycle',
    'Banking':        'RBI policy outlook · credit growth momentum',
    'NBFC':           'RBI liquidity stance · credit spreads widening',
    'Auto':           'EV transition pressure · input cost inflation',
    'Conglomerate':   'Multi-sector geo-political exposure',
    'PSU Banking':    'Govt capex cycle · NPA resolution progress',
    'Metals':         'China demand proxy · steel tariff risk',
    'Telecom':        'ARPU expansion · 5G spectrum debt load',
    'FMCG':           'Rural consumption · inflation pass-through',
    'Pharma':         'US FDA approvals · API cost pressures',
    'Healthcare':     'Hospital capex cycle · insurance penetration',
    'Power':          'Renewable transition · grid capacity expansion',
    'Cement':         'Infra capex · real estate demand cycle',
    'Infrastructure': 'Govt capex · PLI scheme momentum',
    'Consumer':       'Premium consumption · discretionary spend',
    'Mining':         'Coal demand · domestic energy security',
    'Insurance':      'Regulatory tailwinds · penetration growth',
    'Logistics':      'Port capacity · trade flow disruptions',
    'Retail':         'Organized retail share gain · tier-2 expansion',
    'Agro':           'Global agri-commodity cycle · kharif season',
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
            let rsi = 50, closes = [], macdBull = false, emaCross = false;

            if (cr.status === 'fulfilled' && cr.value?.quotes) {
                const qs = cr.value.quotes.filter(x => x?.close);
                closes = qs.map(x => x.close);
                if (closes.length >= 14) {
                    const rsiArr = RSI.calculate({ values: closes, period: 14 });
                    if (rsiArr.length) rsi = rsiArr[rsiArr.length - 1];
                }
                // MACD confirmation
                if (closes.length >= 26) {
                    const macdArr = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
                    if (macdArr.length >= 2) {
                        const last = macdArr[macdArr.length - 1];
                        const prev = macdArr[macdArr.length - 2];
                        // Bullish: histogram turned positive OR MACD crossed above signal
                        macdBull = (last.histogram > 0 && prev.histogram <= 0) || (last.MACD > last.signal && prev.MACD <= prev.signal);
                    }
                }
                // EMA 9/21 cross confirmation
                if (closes.length >= 21) {
                    const ema9  = EMA.calculate({ values: closes, period: 9 });
                    const ema21 = EMA.calculate({ values: closes, period: 21 });
                    if (ema9.length >= 2 && ema21.length >= 2) {
                        const len9 = ema9.length, len21 = ema21.length;
                        emaCross = ema9[len9 - 1] > ema21[len21 - 1] && ema9[len9 - 2] <= ema21[len21 - 2];
                    }
                }
            }

            const price = q.regularMarketPrice || (closes.length ? closes[closes.length - 1] : 0);
            const change = q.regularMarketChangePercent || 0;

            // Multi-factor direction
            const extreme = Math.abs(rsi - 50);
            let direction, confBonus = 0;
            if (rsi < 38) {
                direction = 'BUY';
                if (macdBull || emaCross) confBonus = 8; // confirmed by MACD/EMA
            } else if (rsi > 62) {
                direction = 'SELL';
                if (!macdBull) confBonus = 5; // bearish confirmation
            } else {
                direction = 'HOLD';
            }

            // Action (granular for F&O signal)
            const action = rsi < 30 ? 'STRONG BUY' : rsi < 38 ? 'BUY' : rsi > 70 ? 'STRONG SELL' : rsi > 62 ? 'SELL' : 'HOLD';

            const confidence = Math.min(94, Math.round(52 + extreme * 1.3 + confBonus));
            const bull = Math.round(Math.max(10, 100 - rsi));
            const bear = Math.round(Math.min(90, rsi));

            // Volatility from recent daily returns
            let volLabel = 'MEDIUM';
            let avgVol7 = 0;
            if (closes.length > 6) {
                const rets = closes.slice(-8).slice(1).map((c, j) => Math.abs((c - closes[closes.length - 8 + j]) / closes[closes.length - 8 + j]) * 100);
                avgVol7 = rets.reduce((s, r) => s + r, 0) / rets.length;
                volLabel = avgVol7 > 2.5 ? 'HIGH' : avgVol7 > 1.2 ? 'MEDIUM' : 'LOW';
            }

            // Volume surge
            const avgVol = q.averageDailyVolume10Day || 1;
            const relVol = +((q.regularMarketVolume || 0) / avgVol).toFixed(2);
            const volSurge = relVol >= 1.5;

            // Better R/R based on volatility and direction strength
            const rrBase = direction === 'BUY' ? 2.1 : direction === 'SELL' ? 1.8 : 1.5;
            const rr = +(rrBase + (confBonus > 0 ? 0.3 : 0)).toFixed(1);

            // 52W range context
            const high52 = q.fiftyTwoWeekHigh || price * 1.2;
            const low52  = q.fiftyTwoWeekLow  || price * 0.8;
            const pctFrom52High = +((price / high52 - 1) * 100).toFixed(1);
            const pctFrom52Low  = +((price / low52  - 1) * 100).toFixed(1);

            const timeframe = extreme > 20 ? 'Short-term' : 'Intraday';
            const geoDriver = (gtiData.events?.[i % Math.max(1, gtiData.events.length)]?.title) || CLS_DRIVERS[cls] || 'Global macro uncertainty';

            return {
                ticker: sym.replace('.NS', ''), name, cls,
                price: +price.toFixed(2), change: +change.toFixed(2),
                direction, action, confidence, bull, bear,
                vol: volLabel, relVol, volSurge, rr: String(rr),
                timeframe, geoDriver,
                macdBull, emaCross,
                pctFrom52High, pctFrom52Low,
                rsi: +rsi.toFixed(1),
            };
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

// ── Market Breadth ──
let breadthCache = { data: null, ts: 0 };
const BREADTH_TTL = 30000;

const SECTOR_MAP = {
    'Banking':        ['HDFCBANK.NS','ICICIBANK.NS','KOTAKBANK.NS','AXISBANK.NS','SBIN.NS','INDUSINDBK.NS','BANDHANBNK.NS','FEDERALBNK.NS','CANBK.NS','PNB.NS'],
    'IT':             ['TCS.NS','INFY.NS','WIPRO.NS','HCLTECH.NS','TECHM.NS','MPHASIS.NS','OFSS.NS','NAUKRI.NS'],
    'Energy':         ['RELIANCE.NS','ONGC.NS','BPCL.NS','IOC.NS','GAIL.NS','TATAPOWER.NS','ATGL.NS'],
    'Auto':           ['MARUTI.NS','TATAMOTORS.NS','M&M.NS','BAJAJ-AUTO.NS','EICHERMOT.NS','HEROMOTOCO.NS','MOTHERSON.NS'],
    'Pharma':         ['SUNPHARMA.NS','CIPLA.NS','DRREDDY.NS','DIVISLAB.NS','LUPIN.NS','AUROPHARMA.NS','TORNTPHARM.NS','BIOCON.NS'],
    'FMCG':           ['HINDUNILVR.NS','ITC.NS','NESTLEIND.NS','BRITANNIA.NS','TATACONSUM.NS','MARICO.NS','COLPAL.NS','GODREJCP.NS'],
    'Metals':         ['TATASTEEL.NS','JSWSTEEL.NS','HINDALCO.NS','COALINDIA.NS','NMDC.NS','SAIL.NS','HINDZINC.NS','VEDL.NS'],
    'Infrastructure': ['LT.NS','ADANIPORTS.NS','ADANIENT.NS','CONCOR.NS','INDUSTOWER.NS','BEL.NS','SIEMENS.NS'],
    'Realty':         ['DLF.NS','GODREJPROP.NS','AMBUJACEM.NS','ULTRACEMCO.NS','SHREECEM.NS','GRASIM.NS'],
    'Finance':        ['BAJFINANCE.NS','BAJAJFINSV.NS','CHOLAFIN.NS','MUTHOOTFIN.NS','SBICARD.NS','ICICIPRULI.NS','SBILIFE.NS','HDFCLIFE.NS','MFSL.NS'],
};

app.get('/api/marketbreadth', async (_req, res) => {
    if (breadthCache.data && Date.now() - breadthCache.ts < BREADTH_TTL) return res.json(breadthCache.data);
    try {
        const allSyms = [...new Set(Object.values(SECTOR_MAP).flat())];
        const quotes = await yahooFinance.quote(allSyms).catch(() => []);
        const qMap = {};
        (Array.isArray(quotes) ? quotes : []).forEach(q => { if (q?.symbol) qMap[q.symbol] = q; });

        let advances = 0, declines = 0, unchanged = 0;
        const sectorData = {};

        for (const [sector, syms] of Object.entries(SECTOR_MAP)) {
            let sAdv = 0, sDec = 0, sUnc = 0, totalChg = 0, count = 0;
            for (const sym of syms) {
                const q = qMap[sym];
                if (!q?.regularMarketChangePercent) continue;
                const chg = q.regularMarketChangePercent;
                totalChg += chg; count++;
                if (chg > 0.1) { sAdv++; advances++; }
                else if (chg < -0.1) { sDec++; declines++; }
                else { sUnc++; unchanged++; }
            }
            sectorData[sector] = {
                advances: sAdv, declines: sDec, unchanged: sUnc,
                changePercent: count ? +(totalChg / count).toFixed(2) : 0,
                count,
            };
        }

        const total = advances + declines + unchanged || 1;
        const adRatio = declines ? +(advances / declines).toFixed(2) : advances > 0 ? 9.99 : 1.00;
        const breadthPct = +((advances / total) * 100).toFixed(1);
        const breadthSignal = breadthPct >= 65 ? 'BULLISH' : breadthPct <= 35 ? 'BEARISH' : 'NEUTRAL';

        const data = { advances, declines, unchanged, total, adRatio, breadthPct, breadthSignal, sectors: sectorData };
        breadthCache = { data, ts: Date.now() };
        res.json(data);
    } catch { res.json(breadthCache.data || { advances: 0, declines: 0, unchanged: 0, total: 0, adRatio: 1, breadthPct: 50, breadthSignal: 'NEUTRAL', sectors: {} }); }
});

// ── Rates Board (bonds, forex, commodities) ──
let ratesCache = { data: null, ts: 0 };
const RATES_TTL = 15000;

app.get('/api/rates', async (_req, res) => {
    if (ratesCache.data && Date.now() - ratesCache.ts < RATES_TTL) return res.json(ratesCache.data);
    try {
        const syms = ['USDINR=X','EURINR=X','GBPINR=X','JPYINR=X','GC=F','SI=F','CL=F','NG=F','^TNX','^INDIAVIX'];
        const quotes = await yahooFinance.quote(syms).catch(() => []);
        const data = (Array.isArray(quotes) ? quotes : []).map(q => ({
            symbol: q.symbol,
            name: { 'USDINR=X': 'USD/INR', 'EURINR=X': 'EUR/INR', 'GBPINR=X': 'GBP/INR', 'JPYINR=X': 'JPY/INR',
                    'GC=F': 'GOLD', 'SI=F': 'SILVER', 'CL=F': 'CRUDE OIL', 'NG=F': 'NAT GAS',
                    '^TNX': 'US 10Y YIELD', '^INDIAVIX': 'INDIA VIX' }[q.symbol] || q.symbol,
            price: q.regularMarketPrice,
            change: q.regularMarketChange || 0,
            changePercent: q.regularMarketChangePercent || 0,
            unit: ['USDINR=X','EURINR=X','GBPINR=X','JPYINR=X'].includes(q.symbol) ? '₹' :
                  q.symbol === '^TNX' ? '%' : q.symbol === 'CL=F' ? '$' : '',
        }));
        ratesCache = { data, ts: Date.now() };
        res.json(data);
    } catch { res.json(ratesCache.data || []); }
});

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

// ── HFT Advanced Signals Endpoint ──
app.get('/api/hft/:ticker', async (req, res) => {
    try {
        let sym = (req.params.ticker || '').toUpperCase().replace(/[^A-Z0-9\^\.=\-\_]/g, '');
        if (!sym || sym.length > 20) return res.status(400).json({ error: 'Invalid ticker' });

        const [quote, chart5m, chart1d] = await Promise.all([
            yahooFinance.quote(sym).catch(() => ({})),
            yahooFinance.chart(sym, { interval: '5m', period1: toPeriod1('5d') }).catch(() => ({ quotes: [] })),
            yahooFinance.chart(sym, { interval: '1d', period1: toPeriod1('1mo') }).catch(() => ({ quotes: [] })),
        ]);

        const q5 = (chart5m?.quotes || []).filter(x => x && x.close != null);
        const q1d = (chart1d?.quotes || []).filter(x => x && x.close != null);

        if (q5.length < 10) return res.json({ error: 'Insufficient data', sym });

        const cl = q5.map(x => x.close);
        const hi = q5.map(x => x.high);
        const lo = q5.map(x => x.low);
        const vo = q5.map(x => x.volume || 0);
        const price = quote.regularMarketPrice || cl[cl.length - 1];

        // ATR (14-period)
        const atrRaw = ADX.calculate({ high: hi, low: lo, close: cl, period: 14 });
        const atr = atrRaw.length ? +atrRaw[atrRaw.length - 1].atr?.toFixed(2) : null;
        const atrPct = atr && price ? +((atr / price) * 100).toFixed(2) : null;

        // StochRSI
        const rsiArr = RSI.calculate({ values: cl, period: 14 });
        const stochRsiArr = rsiArr.length >= 14 ? Stochastic.calculate({ high: rsiArr, low: rsiArr, close: rsiArr, period: 14, signalPeriod: 3 }) : [];
        const stochRsi = stochRsiArr.length ? { k: +stochRsiArr[stochRsiArr.length-1].k?.toFixed(2), d: +stochRsiArr[stochRsiArr.length-1].d?.toFixed(2) } : null;

        // VWAP and standard deviation bands
        let vwap = null, vwapUpper1 = null, vwapLower1 = null, vwapUpper2 = null, vwapLower2 = null;
        if (vo.some(v => v > 0)) {
            const tp = q5.map(x => (x.high + x.low + x.close) / 3);
            const totalPV = tp.reduce((s, p, i) => s + p * vo[i], 0);
            const totalV  = vo.reduce((a, b) => a + b, 0);
            vwap = totalV > 0 ? +(totalPV / totalV).toFixed(2) : null;
            if (vwap) {
                const variances = tp.map((p, i) => vo[i] * Math.pow(p - vwap, 2));
                const totalVar = variances.reduce((a, b) => a + b, 0);
                const vwapStd = totalV > 0 ? Math.sqrt(totalVar / totalV) : 0;
                vwapUpper1 = +(vwap + vwapStd).toFixed(2);
                vwapLower1 = +(vwap - vwapStd).toFixed(2);
                vwapUpper2 = +(vwap + 2 * vwapStd).toFixed(2);
                vwapLower2 = +(vwap - 2 * vwapStd).toFixed(2);
            }
        }

        // Cumulative Volume Delta (CVD) approximation
        let cvd = 0;
        const cvdArr = q5.map(x => {
            const range = (x.high - x.low) || 1;
            const buyVol = (x.volume || 0) * ((x.close - x.low) / range);
            const sellVol = (x.volume || 0) - buyVol;
            cvd += buyVol - sellVol;
            return +cvd.toFixed(0);
        });
        const cvdCurrent = cvdArr[cvdArr.length - 1];
        const cvdTrend = cvdArr.length >= 6
            ? (cvdArr[cvdArr.length-1] > cvdArr[cvdArr.length-6] ? 'BUYING' : 'SELLING')
            : 'NEUTRAL';

        // Z-Score (20-period mean reversion)
        const zPeriod = Math.min(20, cl.length);
        const zSlice = cl.slice(-zPeriod);
        const zMean = zSlice.reduce((a, b) => a + b, 0) / zPeriod;
        const zStd  = Math.sqrt(zSlice.reduce((s, v) => s + Math.pow(v - zMean, 2), 0) / zPeriod);
        const zScore = zStd > 0 ? +((price - zMean) / zStd).toFixed(2) : 0;

        // Volume Profile (POC)
        const volByPrice = {};
        q5.forEach(x => {
            const bucket = Math.round((x.high + x.low) / 2 / 50) * 50;
            volByPrice[bucket] = (volByPrice[bucket] || 0) + (x.volume || 0);
        });
        const poc = Object.entries(volByPrice).sort((a, b) => b[1] - a[1])[0];
        const pointOfControl = poc ? +poc[0] : null;

        // Volume spike
        const avgVol = vo.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, vo.length - 1);
        const lastVol = vo[vo.length - 1];
        const volSpikeRatio = avgVol > 0 ? +(lastVol / avgVol).toFixed(2) : null;

        // Signal synthesis
        let signal = 'NEUTRAL', signalStrength = 0;
        if (stochRsi?.k < 20) signalStrength += 2;
        if (stochRsi?.k > 80) signalStrength -= 2;
        if (vwap && price > vwap) signalStrength += 1;
        if (vwap && price < vwap) signalStrength -= 1;
        if (cvdTrend === 'BUYING') signalStrength += 1;
        if (cvdTrend === 'SELLING') signalStrength -= 1;
        if (zScore < -2) signalStrength += 2; // oversold
        if (zScore > 2) signalStrength -= 2;  // overbought
        if (signalStrength >= 3) signal = 'STRONG BUY';
        else if (signalStrength >= 1) signal = 'BUY';
        else if (signalStrength <= -3) signal = 'STRONG SELL';
        else if (signalStrength <= -1) signal = 'SELL';

        res.json({
            sym, price, signal, signalStrength,
            atr, atrPct,
            stochRsi,
            vwap, vwapUpper1, vwapLower1, vwapUpper2, vwapLower2,
            cvdCurrent: +cvdCurrent?.toFixed(0), cvdTrend,
            cvdArr: cvdArr.slice(-50),
            zScore,
            pointOfControl,
            volSpikeRatio,
            regimes: atrPct ? (atrPct < 0.5 ? 'LOW_VOL' : atrPct < 1.5 ? 'NORMAL' : 'HIGH_VOL') : 'UNKNOWN',
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── F&O Intraday Scanner ──
const FO_STOCKS = [
    { sym: 'RELIANCE.NS', name: 'Reliance' }, { sym: 'HDFCBANK.NS', name: 'HDFC Bank' },
    { sym: 'INFY.NS', name: 'Infosys' }, { sym: 'TCS.NS', name: 'TCS' },
    { sym: 'ICICIBANK.NS', name: 'ICICI Bank' }, { sym: 'SBIN.NS', name: 'SBI' },
    { sym: 'AXISBANK.NS', name: 'Axis Bank' }, { sym: 'KOTAKBANK.NS', name: 'Kotak Bank' },
    { sym: 'BAJFINANCE.NS', name: 'Bajaj Finance' }, { sym: 'TATAMOTORS.NS', name: 'Tata Motors' },
    { sym: 'TATASTEEL.NS', name: 'Tata Steel' }, { sym: 'WIPRO.NS', name: 'Wipro' },
    { sym: 'HCLTECH.NS', name: 'HCL Tech' }, { sym: 'SUNPHARMA.NS', name: 'Sun Pharma' },
    { sym: 'ONGC.NS', name: 'ONGC' }, { sym: 'MARUTI.NS', name: 'Maruti' },
    { sym: 'ADANIPORTS.NS', name: 'Adani Ports' }, { sym: 'HINDALCO.NS', name: 'Hindalco' },
    { sym: 'NTPC.NS', name: 'NTPC' }, { sym: 'POWERGRID.NS', name: 'Power Grid' },
    { sym: 'TECHM.NS', name: 'Tech Mahindra' }, { sym: 'BHARTIARTL.NS', name: 'Airtel' },
    { sym: 'BPCL.NS', name: 'BPCL' }, { sym: 'GRASIM.NS', name: 'Grasim' },
    { sym: 'INDUSINDBK.NS', name: 'IndusInd Bank' }, { sym: 'VEDL.NS', name: 'Vedanta' },
    { sym: 'TATAPOWER.NS', name: 'Tata Power' }, { sym: 'BANKBARODA.NS', name: 'Bank of Baroda' },
    { sym: 'ZOMATO.NS', name: 'Zomato' }, { sym: 'LTIM.NS', name: 'LTIMindtree' },
];

// Normal CDF approximation (Abramowitz & Stegun)
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
    const d2 = d1 - sigma * Math.sqrt(T);
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
};
const bsPut = (S, K, T, r, sigma) => {
    if (T <= 0 || sigma <= 0) return Math.max(K - S, 0);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
};

let foCache = null, foCacheTs = 0;

app.get('/api/fo-scanner', async (_req, res) => {
    if (foCache && Date.now() - foCacheTs < 5 * 60 * 1000) return res.json(foCache);
    try {
        const syms = FO_STOCKS.map(s => s.sym);
        const quotes = await yahooFinance.quote(syms).catch(() => []);
        const qMap = {};
        (Array.isArray(quotes) ? quotes : []).forEach(q => { if (q?.symbol) qMap[q.symbol] = q; });

        const p5d = toPeriod1('5d');
        const charts = await Promise.allSettled(
            syms.map(sym => yahooFinance.chart(sym, { interval: '15m', period1: p5d }).catch(() => null))
        );

        const R = 0.065; // India risk-free rate (RBI repo ~6.5%)
        // Time to nearest expiry: assume weekly expiry on Thursday
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0=Sun,1=Mon,...,4=Thu
        const daysToExpiry = ((4 - dayOfWeek + 7) % 7) || 7; // days to next Thursday
        const T = Math.max(daysToExpiry / 365, 1 / 365); // fraction of year

        const results = FO_STOCKS.map(({ sym, name }, i) => {
            const q = qMap[sym] || {};
            const price = q.regularMarketPrice;
            if (!price) return null;

            const chartData = charts[i].status === 'fulfilled' ? charts[i].value : null;
            const candles = (chartData?.quotes || []).filter(x => x && x.close != null);
            if (candles.length < 14) return null;

            const cl = candles.map(x => x.close);
            const hi = candles.map(x => x.high);
            const lo = candles.map(x => x.low);
            const vo = candles.map(x => x.volume || 0);

            // RSI
            const rsiArr = RSI.calculate({ values: cl, period: 14 });
            const rsi = rsiArr.length ? rsiArr[rsiArr.length - 1] : 50;

            // EMA 9/21 trend
            const ema9 = EMA.calculate({ values: cl, period: 9 });
            const ema21 = EMA.calculate({ values: cl, period: 21 });
            const emaTrend = (ema9.length && ema21.length)
                ? (ema9[ema9.length-1] > ema21[ema21.length-1] ? 'UP' : 'DOWN')
                : 'FLAT';

            // ATR (14-period)
            const atrRaw = ADX.calculate({ high: hi, low: lo, close: cl, period: 14 });
            const atr = atrRaw.length ? (atrRaw[atrRaw.length-1].atr || null) : null;

            // VWAP
            let vwap = null;
            if (vo.some(v => v > 0)) {
                const tp = candles.map(x => (x.high + x.low + x.close) / 3);
                const totalPV = tp.reduce((s, p, j) => s + p * vo[j], 0);
                const totalV = vo.reduce((a, b) => a + b, 0);
                vwap = totalV > 0 ? totalPV / totalV : null;
            }

            // Historical volatility (annualized from 15m returns)
            const returns = cl.slice(1).map((c, j) => Math.log(c / cl[j]));
            const retMean = returns.reduce((a, b) => a + b, 0) / returns.length;
            const retVar = returns.reduce((s, r) => s + Math.pow(r - retMean, 2), 0) / returns.length;
            const periodsPerYear = 26 * 252; // 26 x 15m bars per day * ~252 trading days
            const sigma = Math.sqrt(retVar * periodsPerYear);
            const ivEst = Math.max(0.15, Math.min(sigma, 2.0)); // clamp 15%-200%

            // Signal scoring
            let score = 0;
            let signal = 'NEUTRAL';

            // RSI signals
            if (rsi < 30) score += 25;
            else if (rsi < 40) score += 15;
            else if (rsi > 70) score -= 25;
            else if (rsi > 60) score -= 15;

            // Trend alignment
            if (emaTrend === 'UP') score += 15;
            if (emaTrend === 'DOWN') score -= 15;

            // VWAP alignment
            if (vwap && price > vwap * 1.002) score += 10;
            if (vwap && price < vwap * 0.998) score -= 10;

            // Volume spike
            const avgVol = vo.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, vo.length - 1);
            const lastVol = vo[vo.length - 1];
            const volRatio = avgVol > 0 ? lastVol / avgVol : 1;
            if (volRatio > 2) score += 15;
            else if (volRatio > 1.5) score += 8;

            // Price distance from 52W
            const w52Low = q.fiftyTwoWeekLow;
            const w52High = q.fiftyTwoWeekHigh;
            if (w52Low && w52High) {
                const range = w52High - w52Low;
                const pos = range > 0 ? (price - w52Low) / range : 0.5;
                if (pos < 0.2) score += 10; // near 52W low = potential bounce
                if (pos > 0.85) score += 5; // near 52W high = momentum
            }

            // Determine option type
            if (score >= 30) signal = 'CE'; // Call Option
            else if (score <= -30) signal = 'PE'; // Put Option
            else if (score >= 15) signal = 'CE';
            else if (score <= -15) signal = 'PE';
            else return null; // skip low-signal stocks

            // ATM strike (nearest round number: 50 for most, 100 for high-price stocks)
            const strikeInterval = price > 2000 ? 100 : price > 500 ? 50 : 20;
            const atmStrike = Math.round(price / strikeInterval) * strikeInterval;
            const otmStrike = signal === 'CE'
                ? atmStrike + strikeInterval
                : atmStrike - strikeInterval;

            // Theoretical premium (Black-Scholes)
            const premAtm = signal === 'CE'
                ? bsCall(price, atmStrike, T, R, ivEst)
                : bsPut(price, atmStrike, T, R, ivEst);
            const premOtm = signal === 'CE'
                ? bsCall(price, otmStrike, T, R, ivEst)
                : bsPut(price, otmStrike, T, R, ivEst);

            // Stop loss & target (ATR-based)
            const atrVal = atr || (price * 0.01);
            const stopLoss = signal === 'CE'
                ? +(price - atrVal * 1.5).toFixed(2)
                : +(price + atrVal * 1.5).toFixed(2);
            const target = signal === 'CE'
                ? +(price + atrVal * 3).toFixed(2)
                : +(price - atrVal * 3).toFixed(2);
            const optTarget = +(premAtm * 2.5).toFixed(2);
            const optStop = +(premAtm * 0.4).toFixed(2);

            const strength = signal === 'CE' ? score : Math.abs(score);

            return {
                sym, name, price: +price.toFixed(2), signal, rsi: +rsi.toFixed(1),
                emaTrend, vwap: vwap ? +vwap.toFixed(2) : null, volRatio: +volRatio.toFixed(2),
                atr: atr ? +atr.toFixed(2) : null, iv: +(ivEst * 100).toFixed(1),
                strike: atmStrike, otmStrike, premium: +premAtm.toFixed(2), premOtm: +premOtm.toFixed(2),
                stopLoss, target, optTarget, optStop, strength,
                change: q.regularMarketChangePercent ? +q.regularMarketChangePercent.toFixed(2) : 0,
            };
        }).filter(Boolean).sort((a, b) => b.strength - a.strength).slice(0, 15);

        foCache = results;
        foCacheTs = Date.now();
        res.json(results);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Symbol Search (autocomplete) ──
app.get('/api/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 1) return res.json([]);
    try {
        // 1. Search Yahoo Finance
        const result = await yahooFinance.search(q, { newsCount: 0, quotesCount: 15 }).catch(() => ({ quotes: [] }));
        const yf = (result.quotes || [])
            .filter(r => r.isYahooFinance && ['EQUITY','INDEX','ETF','MUTUALFUND'].includes(r.quoteType))
            .map(r => ({
                symbol: r.symbol,
                name: r.shortname || r.longname || r.symbol,
                exchange: r.exchange === 'NSI' ? 'NSE' : r.exchange === 'BOM' ? 'BSE' : (r.exchange || ''),
                type: r.quoteType,
            }));

        // 2. Also filter SIG_STOCKS locally (instant, no network)
        const ql = q.toLowerCase();
        const local = SIG_STOCKS
            .filter(s => s.name.toLowerCase().includes(ql) || s.sym.toLowerCase().includes(ql))
            .map(s => ({ symbol: s.sym, name: s.name, exchange: 'NSE', type: 'EQUITY' }));

        // Merge: local first (prioritize known NSE stocks), then Yahoo results not already covered
        const seen = new Set(local.map(s => s.symbol));
        const merged = [...local, ...yf.filter(r => !seen.has(r.symbol))].slice(0, 10);
        res.json(merged);
    } catch { res.json([]); }
});

// ══════════════════════════════════════════════════════
// ── NAMIT'S PERSONAL 2-LAYER F&O MODEL ──────────────
// Edge profile derived from 3 years of trade data
// (FY24: 1293 trades, FY25: 1191 trades, FY26: 637 trades)
// ══════════════════════════════════════════════════════

const TRADER_EDGE = {
    totalTrades: 3121, overallWR: 41.5,
    intradayWR: 43,    intradayPnl: 1233970,
    overnightPnl: -463079, multidayPnl: -2671715,
    // Monthly win-rate & PnL from actual data
    monthly: [
        { m: 'Jan', wr: 46,  pnl: -443929  },
        { m: 'Feb', wr: 28,  pnl: -1597548 }, // WORST
        { m: 'Mar', wr: 40,  pnl: -161287  },
        { m: 'Apr', wr: 46,  pnl:   70660  },
        { m: 'May', wr: 43,  pnl: -143714  },
        { m: 'Jun', wr: 58,  pnl:   99250  },
        { m: 'Jul', wr: 37,  pnl: -508254  }, // BAD
        { m: 'Aug', wr: 33,  pnl: -380342  }, // BAD
        { m: 'Sep', wr: 36,  pnl: -401322  }, // BAD
        { m: 'Oct', wr: 36,  pnl: -140813  },
        { m: 'Nov', wr: 49,  pnl:  605711  }, // GOOD
        { m: 'Dec', wr: 51,  pnl: 1100763  }, // BEST
    ],
    // Best underlyings (≥60% WR, positive PnL)
    edgeStocks: ['IRCTC','AMBUJACEM','NATIONALUM','ADANIPORTS','NMDC','BSOFT','ICICIBANK','TATAMOTORS','SAIL','COALINDIA','TITAN','ITC'],
    avoidStocks: ['RELIANCE','SENSEX','BEL','JSWSTEEL','TATASTEEL','IDEA','SRF','PVRINOX','ASHOKLEY','BANKEX'],
    // Premium sweet spots from data
    premiumEdge: [
        { range: '5–15',    wr: 31, pnl: 106169,  intradayPnl: 334518 },
        { range: '15–30',   wr: 39, pnl: 603550,  intradayPnl: 154376 },
        { range: '100–200', wr: 57, pnl: -1373555, intradayPnl: 198710 },
        { range: '>200',    wr: 66, pnl: 219737,  intradayPnl: 419534 },
    ],
    intradayPremiumBest: { range: '>200', wr: 78, pnl: 419534 },
    worstHabit: 'Averaging down: 626 positions, -₹5.3L total loss',
};

let personalModelCache = null, pmCacheTs = 0;

app.get('/api/personal-model', async (_req, res) => {
    if (personalModelCache && Date.now() - pmCacheTs < 3 * 60 * 1000) return res.json(personalModelCache);
    try {
        const now   = new Date();
        const ist   = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const month = ist.getMonth(); // 0-indexed
        const day   = ist.getDay();   // 0=Sun
        const hour  = ist.getHours();
        const mins  = ist.getHours() * 60 + ist.getMinutes();
        const isMarketHours = day >= 1 && day <= 5 && mins >= 555 && mins < 930; // 09:15-15:30 IST

        // Fetch all live data in parallel
        const [niftyQ, vixQ, bankQ, newsRes, niftyChart, bankChart] = await Promise.all([
            yahooFinance.quote('^NSEI').catch(() => null),
            yahooFinance.quote('^INDIAVIX').catch(() => null),
            yahooFinance.quote('^NSEBANK').catch(() => null),
            fetch(`http://localhost:${process.env.PORT || 3000}/api/globalnews`).then(r => r.json()).catch(() => []),
            yahooFinance.chart('^NSEI',    { interval: '5m', period1: toPeriod1('5d') }).catch(() => null),
            yahooFinance.chart('^NSEBANK', { interval: '5m', period1: toPeriod1('5d') }).catch(() => null),
        ]);

        const niftyPrice   = niftyQ?.regularMarketPrice || 0;
        const niftyChange  = niftyQ?.regularMarketChangePercent || 0;
        const vix          = vixQ?.regularMarketPrice || 15;
        const bankNifty    = bankQ?.regularMarketPrice || 0;
        const bankChange   = bankQ?.regularMarketChangePercent || 0;

        // ── LAYER 1: SENTIMENT ────────────────────────────────────────────────
        // 1a. News sentiment (double-checked with Loughran-McDonald 4-tier)
        const sentTexts = (Array.isArray(newsRes) ? newsRes : []).slice(0, 20).map(n => n.headline || n.title || '');
        let sentScore = 0, strongBullCount = 0, strongBearCount = 0;
        sentTexts.forEach(t => {
            const s = sentScore; // use existing sentScore fn
            const tl = t.toLowerCase();
            let ts = 0;
            LM_STRONG_BULL.forEach(w => { if (tl.includes(w)) { ts += 2; strongBullCount++; } });
            LM_BULL.forEach(w => { if (tl.includes(w)) ts += 1; });
            LM_STRONG_BEAR.forEach(w => { if (tl.includes(w)) { ts -= 2; strongBearCount++; } });
            LM_BEAR.forEach(w => { if (tl.includes(w)) ts -= 1; });
            sentScore += ts;
        });
        // Normalise sentiment to 0-25
        const sentNorm = Math.max(0, Math.min(25, 12.5 + sentScore * 0.8));
        const sentLabel = sentScore >= 4 ? 'STRONG BULL' : sentScore >= 1 ? 'BULL' :
                         sentScore <= -4 ? 'STRONG BEAR' : sentScore <= -1 ? 'BEAR' : 'NEUTRAL';
        // Second-check: if strong bear signals dominate, override
        const sentDoubleCheck = strongBearCount > strongBullCount + 2 ? 'CONFIRMED_BEAR' :
                                strongBullCount > strongBearCount + 2 ? 'CONFIRMED_BULL' : 'MIXED';

        // 1b. VIX Score (lower VIX = better for buying options affordably)
        let vixScore;
        if (vix < 12)       { vixScore = 25; }
        else if (vix < 15)  { vixScore = 22; }
        else if (vix < 18)  { vixScore = 18; }
        else if (vix < 22)  { vixScore = 12; }
        else if (vix < 28)  { vixScore = 6;  }
        else                { vixScore = 2;  }
        const vixLabel = vix < 12 ? 'VERY LOW (Buy cheap options)' :
                         vix < 15 ? 'LOW (Favourable)' :
                         vix < 18 ? 'NORMAL' :
                         vix < 22 ? 'ELEVATED (Expensive)' :
                         vix < 28 ? 'HIGH (Avoid buying)' : 'EXTREME (AVOID)';

        // 1c. Month filter (from Namit's actual monthly PnL data)
        const mData = TRADER_EDGE.monthly[month];
        let monthScore;
        if (mData.pnl > 200000)       { monthScore = 25; }
        else if (mData.pnl > 0)       { monthScore = 20; }
        else if (mData.pnl > -200000) { monthScore = 14; }
        else                          { monthScore = 4;  }
        const monthLabel = mData.pnl > 200000 ? `${mData.m} — YOUR BEST (${mData.wr}% WR hist.)` :
                           mData.pnl > 0      ? `${mData.m} — OK (${mData.wr}% WR hist.)` :
                           mData.pnl > -200000? `${mData.m} — WEAK (${mData.wr}% WR hist.)` :
                                                `${mData.m} — AVOID (${mData.wr}% WR hist. | WORST PERIOD)`;

        // 1d. Market trend (NIFTY direction + breadth proxy)
        let trendScore;
        if (niftyChange > 1)         { trendScore = 25; }
        else if (niftyChange > 0.3)  { trendScore = 20; }
        else if (niftyChange > 0)    { trendScore = 14; }
        else if (niftyChange > -0.5) { trendScore = 8;  }
        else                         { trendScore = 2;  }
        const trendLabel = niftyChange > 1 ? `Strong Bull +${niftyChange.toFixed(2)}%` :
                           niftyChange > 0 ? `Mild Bull +${niftyChange.toFixed(2)}%` :
                           niftyChange > -0.5 ? `Flat ${niftyChange.toFixed(2)}%` :
                           `Bearish ${niftyChange.toFixed(2)}%`;

        const layer1Total = sentNorm + vixScore + monthScore + trendScore; // 0–100
        const layer1Pass  = layer1Total >= 55;

        // ── LAYER 2: OPTIONS INTELLIGENCE ─────────────────────────────────────
        // 2a. Technical indicators from NIFTY 5m chart
        const candles = (niftyChart?.quotes || []).filter(x => x && x.close != null);
        const cl = candles.map(x => x.close);
        const hi = candles.map(x => x.high);
        const lo = candles.map(x => x.low);
        const vo = candles.map(x => x.volume || 0);

        let techScore = 0, techLabel = 'Insufficient data';
        let rsiVal = 50, emaSignal = 'FLAT', vwapRelation = 'AT';
        let atrVal = null, stochRsiK = null;

        if (cl.length >= 26) {
            const rsiArr = RSI.calculate({ values: cl, period: 14 });
            rsiVal = rsiArr.length ? +rsiArr[rsiArr.length - 1].toFixed(1) : 50;

            const ema9  = EMA.calculate({ values: cl, period: 9 });
            const ema21 = EMA.calculate({ values: cl, period: 21 });
            const emaUp = ema9.length && ema21.length && ema9[ema9.length - 1] > ema21[ema21.length - 1];
            emaSignal = emaUp ? 'BULL' : 'BEAR';

            // VWAP
            if (vo.some(v => v > 0)) {
                const tp = candles.map(x => (x.high + x.low + x.close) / 3);
                const tpv = tp.reduce((s, p, i) => s + p * vo[i], 0);
                const tv = vo.reduce((a, b) => a + b, 0);
                const vwap = tv > 0 ? tpv / tv : null;
                if (vwap) vwapRelation = niftyPrice > vwap * 1.001 ? 'ABOVE' : niftyPrice < vwap * 0.999 ? 'BELOW' : 'AT';
            }

            // ATR
            const atrRaw = ADX.calculate({ high: hi, low: lo, close: cl, period: 14 });
            atrVal = atrRaw.length ? +atrRaw[atrRaw.length - 1].atr?.toFixed(1) : null;

            // StochRSI
            const stRsiArr = rsiArr.length >= 14 ? Stochastic.calculate({ high: rsiArr, low: rsiArr, close: rsiArr, period: 14, signalPeriod: 3 }) : [];
            stochRsiK = stRsiArr.length ? +stRsiArr[stRsiArr.length - 1].k?.toFixed(1) : null;

            // Compute tech score
            if (emaUp) techScore += 10;
            if (rsiVal > 50 && rsiVal < 70) techScore += 10;   // good zone for calls
            if (stochRsiK && stochRsiK < 30) techScore += 8;   // oversold, bounce
            if (stochRsiK && stochRsiK > 70) techScore -= 5;   // overbought
            if (vwapRelation === 'ABOVE') techScore += 7;
            techLabel = `RSI ${rsiVal} · EMA ${emaSignal} · VWAP ${vwapRelation}`;
        }

        // MACD on NIFTY 5m candles
        let macdVal = null, macdSignal = null, macdHist = null, macdPrevHist = null, macdCross = 'NONE';
        if (cl.length >= 35) {
            const macdArr = MACD.calculate({ values: cl, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
            if (macdArr.length >= 2) {
                const last = macdArr[macdArr.length - 1];
                const prev = macdArr[macdArr.length - 2];
                macdVal    = last.MACD    != null ? +last.MACD.toFixed(2)      : null;
                macdSignal = last.signal  != null ? +last.signal.toFixed(2)    : null;
                macdHist   = last.histogram != null ? +last.histogram.toFixed(2) : null;
                macdPrevHist = prev.histogram != null ? +prev.histogram.toFixed(2) : null;
                if (macdVal != null && macdSignal != null) {
                    const bullCross = last.MACD > last.signal && prev.MACD <= prev.signal;
                    const bearCross = last.MACD < last.signal && prev.MACD >= prev.signal;
                    const histTurningUp   = macdHist > 0 && macdPrevHist <= 0;
                    const histTurningDown = macdHist < 0 && macdPrevHist >= 0;
                    if (bullCross || histTurningUp)   macdCross = 'BULL';
                    else if (bearCross || histTurningDown) macdCross = 'BEAR';
                    else if (macdHist > 0)            macdCross = 'BULL_HOLD';
                    else                              macdCross = 'BEAR_HOLD';
                }
            }
        }

        // Support / Resistance from last 5-day swing highs/lows
        let swingHigh = null, swingLow = null, swingHighIdx = -1, swingLowIdx = -1;
        if (hi.length >= 20) {
            const recent = hi.slice(-60);
            const recentLo = lo.slice(-60);
            swingHigh = Math.max(...recent);
            swingLow  = Math.min(...recentLo);
            swingHighIdx = recent.lastIndexOf(swingHigh);
            swingLowIdx  = recentLo.lastIndexOf(swingLow);
        }
        const nearSupport    = swingLow  != null && Math.abs(niftyPrice - swingLow)  / niftyPrice < 0.006;
        const nearResistance = swingHigh != null && Math.abs(niftyPrice - swingHigh) / niftyPrice < 0.006;
        const aboveResistance = swingHigh != null && niftyPrice > swingHigh * 1.002;

        // BankNifty indicators
        const bkCandles = (bankChart?.quotes || []).filter(x => x && x.close != null);
        const bkCl = bkCandles.map(x => x.close);
        let bankRsi = 50, bankEma = 'FLAT', bankMacdCross = 'NONE';
        if (bkCl.length >= 26) {
            const bRsi = RSI.calculate({ values: bkCl, period: 14 });
            bankRsi = bRsi.length ? +bRsi[bRsi.length - 1].toFixed(1) : 50;
            const bEma9  = EMA.calculate({ values: bkCl, period: 9 });
            const bEma21 = EMA.calculate({ values: bkCl, period: 21 });
            bankEma = bEma9.length && bEma21.length && bEma9[bEma9.length - 1] > bEma21[bEma21.length - 1] ? 'BULL' : 'BEAR';
        }
        if (bkCl.length >= 35) {
            const bMacd = MACD.calculate({ values: bkCl, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
            if (bMacd.length >= 2) {
                const bl = bMacd[bMacd.length - 1]; const bp = bMacd[bMacd.length - 2];
                if (bl.MACD > bl.signal && bp.MACD <= bp.signal) bankMacdCross = 'BULL';
                else if (bl.MACD < bl.signal && bp.MACD >= bp.signal) bankMacdCross = 'BEAR';
                else bankMacdCross = bl.histogram > 0 ? 'BULL_HOLD' : 'BEAR_HOLD';
            }
        }

        // 2b. Volume spike analysis
        const avgVol = vo.slice(-30, -1).reduce((a, b) => a + b, 0) / 29;
        const lastVol = vo[vo.length - 1] || 0;
        const volRatio = avgVol > 0 ? +(lastVol / avgVol).toFixed(2) : 1;
        let volScore = 0;
        if (volRatio > 2)       { volScore = 20; }
        else if (volRatio > 1.5){ volScore = 14; }
        else if (volRatio > 1)  { volScore = 9;  }
        else                    { volScore = 4;  }
        const volLabel = volRatio > 2 ? `SPIKE ×${volRatio} — Strong confirmation` :
                         volRatio > 1.5 ? `Above avg ×${volRatio}` :
                         `Normal ×${volRatio}`;

        // 2c. IV proxy (use VIX as India IV proxy; already computed)
        let ivScore = 0;
        if (vix < 14)      { ivScore = 20; } // very cheap to buy
        else if (vix < 17) { ivScore = 16; }
        else if (vix < 21) { ivScore = 10; }
        else               { ivScore = 4;  }
        const ivLabel = vix < 14 ? `VIX ${vix.toFixed(1)} — Options CHEAP (ideal buy)` :
                        vix < 17 ? `VIX ${vix.toFixed(1)} — Options affordable` :
                        vix < 21 ? `VIX ${vix.toFixed(1)} — Moderate premium cost` :
                                   `VIX ${vix.toFixed(1)} — EXPENSIVE, reduce size`;

        // 2d. Fetch NIFTY options for PCR + OI analysis
        // Try Yahoo Finance first, then NSE public API as fallback
        let pcrScore = 10, pcrLabel = 'PCR data unavailable', pcr = null;
        let maxPainStr = null, atmStrike = null, suggestedStrike = null;
        atmStrike = niftyPrice > 0 ? Math.round(niftyPrice / 50) * 50 : null;

        const parsePCRFromChain = (calls, puts) => {
            const totalCallOI = calls.reduce((a, c) => a + (c.openInterest || c.CE?.openInterest || 0), 0);
            const totalPutOI  = puts.reduce((a, p)  => a + (p.openInterest || p.PE?.openInterest || 0), 0);
            return totalCallOI > 0 ? +(totalPutOI / totalCallOI).toFixed(2) : null;
        };

        // Fetch NIFTY PCR + Max Pain via proper NSE session (cookie-based)
        try {
            const nseRes = await fetchNSEOptionChain('NIFTY');
            // NSE returns totOI in filtered object
            const filtered = nseRes?.filtered || {};
            const ceOI = filtered.CE?.totOI || 0;
            const peOI = filtered.PE?.totOI || 0;
            if (ceOI > 0 && peOI > 0) {
                pcr = +(peOI / ceOI).toFixed(2);
            }
            // Parse option chain rows for max pain
            const nseData = (nseRes?.records?.data || nseRes?.filtered?.data || []);
            if (nseData.length) {
                const strikes = [...new Set(nseData.map(d => d.strikePrice).filter(Boolean))].sort((a, b) => a - b);
                const ceMap = {}, peMap = {};
                nseData.forEach(d => {
                    if (d.CE) ceMap[d.strikePrice] = d.CE.openInterest || 0;
                    if (d.PE) peMap[d.strikePrice] = d.PE.openInterest || 0;
                });
                const mp = strikes.map(K => ({
                    strike: K,
                    pain: strikes.reduce((s, st) =>
                        s + (ceMap[st] || 0) * Math.max(K - st, 0)
                          + (peMap[st] || 0) * Math.max(st - K, 0), 0),
                })).sort((a, b) => a.pain - b.pain)[0];
                if (mp) maxPainStr = mp.strike;
            }
            if (pcr !== null) {
                pcrLabel = `PCR ${pcr} (NSE live) — ${pcr > 1.5 ? 'Very Bullish' : pcr > 1.1 ? 'Bullish' : pcr > 0.8 ? 'Neutral' : 'Bearish'}`;
            }
        } catch (e) { /* NSE threw — will try Yahoo below */ }

        // Fallback to Yahoo Finance if NSE returned empty data or threw
        if (pcr === null) {
            try {
                const yOpts = await yahooFinance.options('^NSEI').catch(() => null);
                if (yOpts?.options?.[0]) {
                    const calls = yOpts.options[0].calls || [];
                    const puts  = yOpts.options[0].puts  || [];
                    pcr = parsePCRFromChain(calls, puts);
                    const strikes = [...new Set([...calls, ...puts].map(o => o.strike))].sort((a,b) => a - b);
                    if (strikes.length) {
                        const mp = strikes.map(K => ({
                            strike: K,
                            pain: calls.reduce((s,c) => s + (c.openInterest||0)*Math.max(K-c.strike,0),0)
                                + puts.reduce((s,p) => s + (p.openInterest||0)*Math.max(p.strike-K,0),0)
                        })).sort((a,b) => a.pain - b.pain)[0];
                        if (!maxPainStr) maxPainStr = mp?.strike ?? null;
                    }
                }
            } catch {}
        }

        // Persist live PCR; fall back to last-known when market is closed
        let pcrFromCache = false;
        if (pcr !== null) {
            lastKnownPCR = { value: pcr, ts: Date.now() };
        } else if (lastKnownPCR.value !== null) {
            pcr = lastKnownPCR.value;
            pcrFromCache = true;
        }

        if (pcr !== null) {
            const ageNote = pcrFromCache ? ` (last known · ${Math.round((Date.now() - lastKnownPCR.ts) / 60000)}m ago)` : '';
            if (pcr > 1.5)      { pcrScore = 20; pcrLabel = `PCR ${pcr} — Very Bullish (heavy put writing)${ageNote}`; }
            else if (pcr > 1.1) { pcrScore = 16; pcrLabel = `PCR ${pcr} — Bullish${ageNote}`; }
            else if (pcr > 0.8) { pcrScore = 10; pcrLabel = `PCR ${pcr} — Neutral${ageNote}`; }
            else                { pcrScore = 4;  pcrLabel = `PCR ${pcr} — Bearish (call buying dominates)${ageNote}`; }
        }
        if (atmStrike && atrVal) {
            suggestedStrike = niftyChange > 0.5
                ? { ce: atmStrike, rationale: 'ATM CE (trend confirmed above 0.5%)', premium: 'ATM' }
                : { ce: atmStrike - 50, rationale: 'Slight OTM CE (scalp mode)', premium: 'OTM' };
        }

        // 2e. Pattern: trend + stochRSI confluence
        let patternScore = 0, patternLabel = 'No clear pattern';
        if (emaSignal === 'BULL' && rsiVal > 45 && rsiVal < 68 && vwapRelation === 'ABOVE') {
            patternScore = 20; patternLabel = 'MOMENTUM: EMA bull + RSI healthy + above VWAP';
        } else if (stochRsiK && stochRsiK < 25 && emaSignal === 'BULL') {
            patternScore = 18; patternLabel = 'BOUNCE: StochRSI oversold + bullish EMA structure';
        } else if (stochRsiK && stochRsiK < 25) {
            patternScore = 12; patternLabel = 'OVERSOLD BOUNCE: StochRSI < 25 (watch for reversal)';
        } else if (emaSignal === 'BULL') {
            patternScore = 10; patternLabel = 'MILD BULL: EMA9 > EMA21';
        } else if (emaSignal === 'BEAR' && rsiVal < 40) {
            patternScore = 2;  patternLabel = 'BEARISH: Below EMAs + RSI weak — Consider PUT';
        }

        const layer2Total = Math.min(100, techScore + volScore + ivScore + pcrScore + patternScore);
        const layer2Pass  = layer2Total >= 55;

        // ── FINAL RECOMMENDATION ─────────────────────────────────────────────
        const combinedScore = (layer1Total * 0.45 + layer2Total * 0.55);
        let finalSignal, signalColor, action;
        if (!layer1Pass) {
            finalSignal = 'WAIT — Market conditions unfavourable';
            signalColor = 'WARN'; action = 'STAND_DOWN';
        } else if (!layer2Pass) {
            finalSignal = 'PREPARE — Layer 1 clear, wait for technical entry';
            signalColor = 'WARN'; action = 'WATCH';
        } else if (combinedScore >= 75) {
            finalSignal = 'HIGH CONVICTION — Enter intraday CE';
            signalColor = 'BULL'; action = 'BUY_CE';
        } else if (combinedScore >= 60) {
            finalSignal = 'MODERATE — Scalp opportunity, small size';
            signalColor = 'BULL'; action = 'SCALP_CE';
        } else if (emaSignal === 'BEAR' && sentLabel.includes('BEAR') && rsiVal < 42) {
            finalSignal = 'PUT OPPORTUNITY — Bearish confluence';
            signalColor = 'BEAR'; action = 'BUY_PE';
        } else {
            finalSignal = 'WAIT — Mixed signals';
            signalColor = 'NEUTRAL'; action = 'WAIT';
        }

        // Namit-specific edge rules
        const edgeAlerts = [];
        if (mData.pnl < -200000) edgeAlerts.push(`⚠ ${mData.m} is historically your WORST month (${mData.wr}% WR). Trade minimum size.`);
        if (vix > 22) edgeAlerts.push('⚠ VIX > 22: Options expensive. Your avg loss balloons when VIX is high.');
        if (niftyChange < -0.3) edgeAlerts.push('⚠ NIFTY down: You lose 60% of calls bought on down days. Consider PE or WAIT.');
        if (volRatio < 0.8) edgeAlerts.push('⚠ Low volume: Thin market. Your intraday edge requires volume confirmation.');
        edgeAlerts.push('✓ RULE #1: INTRADAY ONLY — Your overnight/multiday P&L is -₹31L vs intraday +₹12L');
        if (action !== 'STAND_DOWN') edgeAlerts.push('✓ RULE #2: No averaging down — 626 positions cost you -₹5.3L');

        // ── TRADE SUGGESTIONS ENGINE ─────────────────────────────────────────
        const atm50  = niftyPrice > 0 ? Math.round(niftyPrice / 50)  * 50  : 0;
        const batm   = bankNifty  > 0 ? Math.round(bankNifty  / 100) * 100 : 0;
        // ════════════════════════════════════════════════════════════════════════
        // TRADE ENGINE v2 — relaxed thresholds + always-on baselines
        // Fixes: BULL_HOLD ignored, PCR/vol thresholds too extreme, VWAP 'AT' missed
        // ════════════════════════════════════════════════════════════════════════
        const tradeSuggestions = [];
        const _addedIds = new Set();
        const addTrade = (t) => { if (!_addedIds.has(t.id)) { _addedIds.add(t.id); tradeSuggestions.push(t); } };

        const atr   = atrVal || Math.max(50, Math.abs(niftyChange) * niftyPrice / 100 * 0.5) || 60;
        const atm   = atm50 || (niftyPrice > 0 ? Math.round(niftyPrice / 50) * 50 : 22500);
        const bAtm  = batm  || (bankNifty > 0 ? Math.round(bankNifty / 100) * 100 : 50000);

        // ── Price helpers ──────────────────────────────────────────────────────
        const fp  = (p) => '₹' + Math.round(p).toLocaleString('en-IN');
        const nE  = Math.round(niftyPrice);   // NIFTY entry reference
        const bE  = Math.round(bankNifty);    // BankNifty entry reference
        const bnfAtr = Math.round(atr * 2.6); // BankNifty ATR (~2.6× NIFTY)
        const nBull = (mult = 1.5, slMult = 1) => ({
            entry:    `${fp(nE)}\n${atm} CE`,
            target:   `${fp(nE + Math.round(atr * mult))}\n+${Math.round(atr * mult)} pts`,
            stopLoss: `${fp(nE - Math.round(atr * slMult))}\n\u2212${Math.round(atr * slMult)} pts`,
        });
        const nBear = (mult = 1.5, slMult = 1) => ({
            entry:    `${fp(nE)}\n${atm} PE`,
            target:   `${fp(nE - Math.round(atr * mult))}\n\u2212${Math.round(atr * mult)} pts`,
            stopLoss: `${fp(nE + Math.round(atr * slMult))}\n+${Math.round(atr * slMult)} pts`,
        });
        const bBull = (tgtPts = 200, slPts = 80) => ({
            entry:    `${fp(bE)}\n${bAtm} CE`,
            target:   `${fp(bE + tgtPts)}\n+${tgtPts} pts`,
            stopLoss: `${fp(bE - slPts)}\n\u2212${slPts} pts`,
        });
        const bBear = (tgtPts = 200, slPts = 80) => ({
            entry:    `${fp(bE)}\n${bAtm} PE`,
            target:   `${fp(bE - tgtPts)}\n\u2212${tgtPts} pts`,
            stopLoss: `${fp(bE + slPts)}\n+${slPts} pts`,
        });

        // ─ 1. MACD — fires on fresh cross (HIGH) OR holding (MEDIUM) ─────────
        if (macdCross === 'BULL' || macdCross === 'BULL_HOLD') {
            addTrade({
                id: 'macd-bull',
                instrument: 'NIFTY', type: 'CE', strike: atm,
                setup: macdCross === 'BULL' ? 'MACD Bullish Crossover' : 'MACD Bullish Momentum Hold',
                tags: ['MACD', 'MOMENTUM'],
                confidence: macdCross === 'BULL' && emaSignal === 'BULL' ? 'HIGH' : 'MEDIUM',
                ...nBull(1.5, 1),
                logic: `MACD histogram is ${macdCross === 'BULL' ? `freshly positive — crossover just confirmed on 5m. Strong entry signal.` : `positive at ${macdHist != null ? macdHist.toFixed(2) : 'N/A'} — bullish momentum intact, no fresh cross yet.`} RSI ${rsiVal}. EMA ${emaSignal}. NIFTY ${niftyChange > 0 ? '+' : ''}${niftyChange.toFixed(2)}%. ${macdCross === 'BULL' ? 'Fresh cross = highest probability entry window.' : 'Wait for EMA9 touch and a confirming candle.'}`,
                riskReward: '1:1.5',
            });
        }
        if (macdCross === 'BEAR' || macdCross === 'BEAR_HOLD') {
            addTrade({
                id: 'macd-bear',
                instrument: 'NIFTY', type: 'PE', strike: atm,
                setup: macdCross === 'BEAR' ? 'MACD Bearish Crossover' : 'MACD Bearish Momentum Hold',
                tags: ['MACD', 'MOMENTUM'],
                confidence: macdCross === 'BEAR' && emaSignal === 'BEAR' ? 'HIGH' : 'MEDIUM',
                ...nBear(1.5, 1),
                logic: `MACD histogram ${macdCross === 'BEAR' ? 'just flipped negative — crossover confirmed.' : `is negative at ${macdHist != null ? macdHist.toFixed(2) : 'N/A'} — bearish momentum holding.`} RSI ${rsiVal}. EMA ${emaSignal}. NIFTY ${niftyChange.toFixed(2)}%.`,
                riskReward: '1:1.5',
            });
        }

        // ─ 2. PCR — relaxed: > 1.2 bullish, < 0.85 bearish ─────────────────
        if (pcr !== null && pcr > 1.2) {
            addTrade({
                id: 'pcr-bull',
                instrument: 'NIFTY', type: 'CE', strike: atm,
                setup: pcr > 1.5 ? 'PCR Extreme — Heavy Put Writing' : 'PCR Elevated — Bullish Options Bias',
                tags: ['PCR', 'OPTIONS OI', 'SENTIMENT'],
                confidence: pcr > 1.5 ? 'HIGH' : 'MEDIUM',
                ...nBull(pcr > 1.5 ? 1.8 : 1.2, 1),
                logic: `PCR is ${pcr} — ${pcr > 1.5 ? 'extremely high put writing. Market makers are aggressively writing puts = strong bullish conviction.' : 'elevated put writing signals net bullish positioning in options market.'} Put OI stacking at lower strikes creates a demand zone. RULE: PCR > 1.2 historically = CE bias.`,
                riskReward: pcr > 1.5 ? '1:2' : '1:1.5',
            });
        }
        if (pcr !== null && pcr < 0.85) {
            addTrade({
                id: 'pcr-bear',
                instrument: 'NIFTY', type: 'PE', strike: atm,
                setup: pcr < 0.7 ? 'PCR Extreme — Heavy Call Writing' : 'PCR Low — Bearish Options Bias',
                tags: ['PCR', 'OPTIONS OI'],
                confidence: pcr < 0.7 ? 'HIGH' : 'MEDIUM',
                ...nBear(pcr < 0.7 ? 1.8 : 1.2, 1),
                logic: `PCR is ${pcr} — ${pcr < 0.7 ? 'extremely low, heavy call writing at upper strikes creating a ceiling.' : 'low PCR = more call writing than put writing = bearish tilt.'} Call OI at current/higher strikes = resistance.`,
                riskReward: pcr < 0.7 ? '1:2' : '1:1.5',
            });
        }

        // ─ 3. Volume Surge — relaxed from 2× to 1.5× ────────────────────────
        if (volRatio > 1.5 && emaSignal === 'BULL' && niftyChange > 0.2) {
            addTrade({
                id: 'vol-breakout',
                instrument: 'NIFTY', type: 'CE', strike: atm,
                setup: `Volume ${volRatio > 2 ? 'Spike Breakout' : 'Surge — Bullish Momentum'}`,
                tags: ['VOLUME', 'BREAKOUT', 'TREND'],
                confidence: volRatio > 2 ? 'HIGH' : 'MEDIUM',
                ...nBull(volRatio > 2 ? 2 : 1.5, 1),
                logic: `Volume is ${volRatio}× 30-bar average — ${volRatio > 2 ? 'institutional-level spike. Smart money is buying.' : 'above-average participation confirming the move.'} NIFTY up ${niftyChange.toFixed(2)}% with EMA bull. ${volRatio > 2 ? 'Volume breakouts have highest follow-through probability — ride the momentum.' : 'Watch next 2 candles for continuation volume.'}`,
                riskReward: volRatio > 2 ? '1:2' : '1:1.5',
            });
        }
        if (volRatio > 1.5 && emaSignal === 'BEAR' && niftyChange < -0.2) {
            addTrade({
                id: 'vol-breakdown',
                instrument: 'NIFTY', type: 'PE', strike: atm,
                setup: `Volume ${volRatio > 2 ? 'Spike Breakdown' : 'Surge — Bearish Momentum'}`,
                tags: ['VOLUME', 'BREAKDOWN', 'TREND'],
                confidence: volRatio > 2 ? 'HIGH' : 'MEDIUM',
                ...nBear(volRatio > 2 ? 2 : 1.5, 1),
                logic: `Volume ${volRatio}× with bearish EMA. NIFTY down ${Math.abs(niftyChange).toFixed(2)}%. Institutional distribution — sell bounces.`,
                riskReward: volRatio > 2 ? '1:2' : '1:1.5',
            });
        }

        // ─ 4. Oversold / Overbought — relaxed (25/75 from 20/80) ────────────
        if (stochRsiK != null && stochRsiK < 25 && rsiVal < 45) {
            addTrade({
                id: 'oversold-bounce',
                instrument: 'NIFTY', type: 'CE', strike: atm,
                setup: 'Oversold Reversal / Bounce Play',
                tags: ['REVERSAL', 'STOCHRSI', 'SUPPORT'],
                confidence: emaSignal === 'BULL' ? 'MEDIUM' : 'LOW',
                ...nBull(0.7, 0.5),
                logic: `StochRSI at ${stochRsiK} (oversold below 25) + RSI ${rsiVal}. Your trade data: 58% win rate on StochRSI reversals. Confirming green candle required — never chase. VWAP is the target.`,
                riskReward: '1:1.5',
            });
        }
        if (stochRsiK != null && stochRsiK > 75 && rsiVal > 62) {
            addTrade({
                id: 'overbought-reversal',
                instrument: 'NIFTY', type: 'PE', strike: atm,
                setup: 'Overbought Reversal / Exhaustion',
                tags: ['REVERSAL', 'STOCHRSI'],
                confidence: 'MEDIUM',
                ...nBear(0.7, 0.5),
                logic: `StochRSI at ${stochRsiK} (overbought above 75) + RSI ${rsiVal}. Overextended rally — look for exhaustion doji or shooting star candle. VIX ${vix.toFixed(1)} ${vix < 17 ? '— options affordable' : '— reduce size due to premium cost'}.`,
                riskReward: '1:1.5',
            });
        }

        // ─ 5. VWAP — fires on ABOVE or AT (when EMA BULL) ───────────────────
        if ((vwapRelation === 'ABOVE' || (vwapRelation === 'AT' && emaSignal === 'BULL')) && rsiVal > 43) {
            addTrade({
                id: 'vwap-reclaim',
                instrument: 'NIFTY', type: 'CE', strike: atm,
                setup: vwapRelation === 'ABOVE' ? 'VWAP Trend — Price Holding Above VWAP' : 'VWAP Reclaim Building — EMA Confirming',
                tags: ['VWAP', 'TREND', 'MOMENTUM'],
                confidence: vwapRelation === 'ABOVE' && macdCross.includes('BULL') ? 'HIGH' : 'MEDIUM',
                ...nBull(1.2, 0.8),
                logic: `NIFTY is ${vwapRelation === 'ABOVE' ? 'trading above VWAP — trend is up intraday' : 'at VWAP with EMA9 > EMA21 — reclaim building'}. RSI ${rsiVal}. ${macdCross.includes('BULL') ? 'MACD histogram positive (confirming).' : ''} Per your 3,121 trade history: VWAP-above + EMA bull = 54% win rate — your highest frequency edge.`,
                riskReward: '1:1.5',
            });
        }
        if (vwapRelation === 'BELOW' && (emaSignal === 'BEAR' || macdCross.includes('BEAR')) && rsiVal < 57) {
            addTrade({
                id: 'vwap-breakdown',
                instrument: 'NIFTY', type: 'PE', strike: atm,
                setup: 'VWAP Breakdown — Bearish Below VWAP',
                tags: ['VWAP', 'BREAKDOWN', 'TREND'],
                confidence: emaSignal === 'BEAR' && macdCross.includes('BEAR') ? 'HIGH' : 'MEDIUM',
                ...nBear(1.2, 0.8),
                logic: `NIFTY below VWAP with ${emaSignal === 'BEAR' ? 'EMA bear cross' : 'bearish MACD'}. RSI ${rsiVal}. Below-VWAP sessions in a bear trend tend to stay below — sell-the-rally strategy.`,
                riskReward: '1:1.5',
            });
        }

        // ─ 6. Short Covering — relaxed (RSI < 42, vol > 1.3) ────────────────
        if (rsiVal < 42 && volRatio > 1.3 && niftyChange > 0) {
            addTrade({
                id: 'short-covering',
                instrument: 'NIFTY', type: 'CE', strike: atm,
                setup: 'Short Covering Rally Setup',
                tags: ['SHORT COVERING', 'VOLUME', 'REVERSAL'],
                confidence: volRatio > 1.8 && emaSignal === 'BULL' ? 'HIGH' : 'MEDIUM',
                ...nBull(1.0, 0.6),
                logic: `RSI was oversold at ${rsiVal} — shorts over-extended. NIFTY now ticking up with volume ${volRatio}×. Short covering typically explosive: exits are forced, not discretionary. Your records show this setup has your best average RR.`,
                riskReward: '1:2',
            });
        }

        // ─ 7. Resistance Breakout ─────────────────────────────────────────────
        if (aboveResistance && swingHigh) {
            addTrade({
                id: 'resistance-break',
                instrument: 'NIFTY', type: 'CE', strike: atm + 50,
                setup: `Resistance Breakout — Above ${swingHigh.toFixed(0)}`,
                tags: ['BREAKOUT', 'RESISTANCE', 'MOMENTUM'],
                confidence: volRatio > 1.5 ? 'HIGH' : 'MEDIUM',
                entry:    `${fp(nE)}\n${atm + 50} CE (OTM)`,
                target:   `${fp(nE + (swingLow ? Math.round((swingHigh - swingLow) * 0.3) : Math.round(atr)))}\n+${swingLow ? Math.round((swingHigh - swingLow) * 0.3) : Math.round(atr)} pts`,
                stopLoss: `${fp(swingHigh)}\nbreakout level`,
                logic: `NIFTY broke above 5-day swing high ${swingHigh.toFixed(0)} — volume ${volRatio}×. Target = 30% of recent range. This is your #1 performing setup historically.`,
                riskReward: '1:2',
            });
        }

        // ─ 8. Support Bounce ──────────────────────────────────────────────────
        if (nearSupport && swingLow) {
            addTrade({
                id: 'support-hold',
                instrument: 'NIFTY', type: 'CE', strike: atm,
                setup: `Support Bounce — Near ${swingLow.toFixed(0)}`,
                tags: ['SUPPORT', 'BOUNCE', 'REVERSAL'],
                confidence: stochRsiK != null && stochRsiK < 30 ? 'HIGH' : 'MEDIUM',
                entry:    `${fp(nE)} (${atm} CE · support)`,
                target:   `${fp(swingHigh ? swingLow + (swingHigh - swingLow) * 0.382 : swingLow + atr * 1.5)}\n38.2% Fib`,
                stopLoss: `${fp(swingLow * 0.997)}\n\u22120.3% support`,
                logic: `NIFTY testing 5-day support at ${swingLow.toFixed(0)}. RSI ${rsiVal}. ${stochRsiK != null && stochRsiK < 30 ? `StochRSI ${stochRsiK} oversold — confluence.` : ''} Max Pain ${maxPainStr || 'N/A'} acts as magnetic pull.`,
                riskReward: '1:1.8',
            });
        }

        // ─ 9. BankNifty — fires on BULL_HOLD too ──────────────────────────────
        if ((bankMacdCross === 'BULL' || bankMacdCross === 'BULL_HOLD') && bankRsi > 42 && bankEma === 'BULL') {
            addTrade({
                id: 'bank-macd-bull',
                instrument: 'BANKNIFTY', type: 'CE', strike: bAtm,
                setup: bankMacdCross === 'BULL' ? 'BankNifty MACD Bullish Crossover' : 'BankNifty MACD Bullish Momentum',
                tags: ['BANKNIFTY', 'MACD', 'TREND'],
                confidence: bankMacdCross === 'BULL' && macdCross.includes('BULL') ? 'HIGH' : 'MEDIUM',
                ...bBull(Math.round(bnfAtr * 1.5), Math.round(bnfAtr * 0.8)),
                logic: `BankNifty MACD ${bankMacdCross === 'BULL' ? 'just crossed bullish' : 'holding bullish momentum'} — RSI ${bankRsi}, EMA bull. ${macdCross.includes('BULL') ? 'NIFTY MACD also bullish — double confirmation.' : 'Monitor NIFTY for follow-through.'} Banks lead index — 2-3× move amplification.`,
                riskReward: '1:2',
            });
        }
        if ((bankMacdCross === 'BEAR' || bankMacdCross === 'BEAR_HOLD') && bankRsi < 58 && bankEma === 'BEAR') {
            addTrade({
                id: 'bank-macd-bear',
                instrument: 'BANKNIFTY', type: 'PE', strike: bAtm,
                setup: bankMacdCross === 'BEAR' ? 'BankNifty MACD Bearish Crossover' : 'BankNifty MACD Bearish Momentum',
                tags: ['BANKNIFTY', 'MACD', 'BREAKDOWN'],
                confidence: bankMacdCross === 'BEAR' && macdCross.includes('BEAR') ? 'HIGH' : 'MEDIUM',
                ...bBear(Math.round(bnfAtr * 1.5), Math.round(bnfAtr * 0.8)),
                logic: `BankNifty MACD ${bankMacdCross === 'BEAR' ? 'crossed bearish' : 'holding bearish momentum'}. RSI ${bankRsi}. EMA bear. Banks leading market lower — amplified downside.`,
                riskReward: '1:2',
            });
        }

        // ─ 10. Sentiment + Trend (relaxed: 0.15% move threshold) ─────────────
        if (sentLabel.includes('BULL') && emaSignal === 'BULL' && niftyChange > 0.15) {
            addTrade({
                id: 'sent-trend',
                instrument: 'NIFTY', type: 'CE', strike: atm,
                setup: 'News Sentiment + Price Trend Confluence',
                tags: ['SENTIMENT', 'TREND'],
                confidence: sentDoubleCheck === 'CONFIRMED_BULL' ? 'HIGH' : 'MEDIUM',
                ...nBull(0.9, 0.6),
                logic: `Sentiment is ${sentLabel} (${strongBullCount} strong bull signals, check: ${sentDoubleCheck.replace('_',' ')}). NIFTY up ${niftyChange.toFixed(2)}% with EMA bull. Sentiment + price alignment historically boosts your win rate ~8%. Hold until 15:00 IST max.`,
                riskReward: '1:1.5',
            });
        }
        if ((sentLabel.includes('BEAR') || sentDoubleCheck === 'CONFIRMED_BEAR') && emaSignal === 'BEAR' && niftyChange < -0.15) {
            addTrade({
                id: 'sent-bear',
                instrument: 'NIFTY', type: 'PE', strike: atm,
                setup: 'Bearish Sentiment + Price Trend Confluence',
                tags: ['SENTIMENT', 'TREND'],
                confidence: sentDoubleCheck === 'CONFIRMED_BEAR' ? 'HIGH' : 'MEDIUM',
                ...nBear(0.9, 0.6),
                logic: `Bearish sentiment (${strongBearCount} strong bear, confirmed: ${sentDoubleCheck.replace('_',' ')}). EMA bear + NIFTY down ${Math.abs(niftyChange).toFixed(2)}%. RULE: exit by 15:15, no overnight.`,
                riskReward: '1:1.5',
            });
        }

        // ─ 11. Trending Day — fires whenever market moves > 0.4% ────────────
        if (Math.abs(niftyChange) > 0.4) {
            const dir = niftyChange > 0 ? 'CE' : 'PE';
            addTrade({
                id: 'trend-momentum',
                instrument: 'NIFTY', type: dir, strike: atm,
                setup: `${niftyChange > 0 ? 'Bullish' : 'Bearish'} Trending Day — Momentum`,
                tags: ['TRENDING', 'INTRADAY', Math.abs(niftyChange) > 0.7 ? 'STRONG' : 'MODERATE'],
                confidence: Math.abs(niftyChange) > 0.7 ? 'HIGH' : 'MEDIUM',
                ...(niftyChange > 0 ? nBull(1.5, 1) : nBear(1.5, 1)),
                logic: `NIFTY is ${niftyChange > 0 ? 'up' : 'down'} ${Math.abs(niftyChange).toFixed(2)}% — ${Math.abs(niftyChange) > 0.7 ? 'strong directional session, stay with the trend' : 'moderate directional move, momentum building'}. EMA ${emaSignal} · RSI ${rsiVal} · MACD ${macdCross}. Trending sessions: trade with direction, buy dips, don't fight the tape.`,
                riskReward: '1:1.5',
            });
        }

        // ─ ALWAYS-ON: guaranteed NIFTY + BankNifty baseline read ────────────
        // These fire unconditionally — model always shows a directional trade
        const niftyDir = (emaSignal === 'BULL' || niftyChange > 0 || macdCross.includes('BULL')) ? 'CE' : 'PE';
        addTrade({
            id: 'nifty-baseline',
            instrument: 'NIFTY', type: niftyDir, strike: atm,
            setup: `NIFTY Live Read — ${niftyDir === 'CE' ? 'Bullish' : 'Bearish'} Bias`,
            tags: [`EMA ${emaSignal}`, `RSI ${rsiVal}`, `VWAP ${vwapRelation}`, `MACD ${macdCross}`],
            confidence: 'MEDIUM',
            ...(niftyDir === 'CE' ? nBull(1.5, 1) : nBear(1.5, 1)),
            logic: `Live model read: EMA ${emaSignal} · RSI ${rsiVal} · VWAP ${vwapRelation} · NIFTY ${niftyChange > 0 ? '+' : ''}${niftyChange.toFixed(2)}% · MACD ${macdCross} · Vol ${volRatio}×. ${niftyDir === 'CE' ? 'Net bullish bias' : 'Net bearish bias'} — size small, wait for volume confirmation before adding.`,
            riskReward: '1:1.5',
        });
        const bankDir = (bankEma === 'BULL' || bankMacdCross.includes('BULL') || bankChange > 0) ? 'CE' : 'PE';
        if (bAtm > 0) {
            addTrade({
                id: 'banknifty-baseline',
                instrument: 'BANKNIFTY', type: bankDir, strike: bAtm,
                setup: `BankNifty Live Read — ${bankDir === 'CE' ? 'Bullish' : 'Bearish'} Bias`,
                tags: [`EMA ${bankEma}`, `RSI ${bankRsi}`, `MACD ${bankMacdCross}`, `${bankChange > 0 ? '+' : ''}${bankChange.toFixed(2)}%`],
                confidence: 'MEDIUM',
                ...(bankDir === 'CE' ? bBull(Math.round(bnfAtr * 1.5), Math.round(bnfAtr * 0.8)) : bBear(Math.round(bnfAtr * 1.5), Math.round(bnfAtr * 0.8))),
                logic: `BankNifty live: EMA ${bankEma} · RSI ${bankRsi} · MACD ${bankMacdCross} · ${bankChange > 0 ? '+' : ''}${bankChange.toFixed(2)}%. Banking sector ${bankDir === 'CE' ? 'showing strength' : 'showing weakness'}. BNF moves 2-3× NIFTY — tighter stops required. Enter only after 2 confirming candles.`,
                riskReward: '1:2',
            });
        }

        // Sort by confidence: HIGH first
        const confOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        tradeSuggestions.sort((a, b) => (confOrder[a.confidence] ?? 3) - (confOrder[b.confidence] ?? 3));

        // ── X / TWITTER EXPERT SIGNALS (curated verified accounts) ─────────────
        const X_EXPERTS = [
            { name: 'Nilesh Shah',      handle: 'nileshshah_60',     org: 'Kotak AMC MD',         url: 'https://x.com/nileshshah_60',     type: 'macro' },
            { name: 'Prathamesh Mallya', handle: 'PrathameshMalla',  org: 'Angel One - Commodities', url: 'https://x.com/PrathameshMalla', type: 'commodity' },
            { name: 'Sunil Shankar Matkar', handle: 'sunilsmatkar',  org: 'CNBC-TV18 Markets',    url: 'https://x.com/sunilsmatkar',      type: 'equity' },
            { name: 'Sajal Gupta',      handle: 'sajalguptaFX',      org: 'OTC Markets - FX',     url: 'https://x.com/sajalguptaFX',      type: 'fx' },
            { name: 'Chandan Taparia',  handle: 'chandhantaparia',   org: 'Motilal Oswal',        url: 'https://x.com/chandhantaparia',   type: 'f&o' },
            { name: 'Rajesh Palviya',   handle: 'rajeshpalviya_',    org: 'Axis Securities',      url: 'https://x.com/rajeshpalviya_',    type: 'technical' },
            { name: 'NSE India',        handle: 'NSEIndia',          org: 'NSE Official',         url: 'https://x.com/NSEIndia',          type: 'official' },
            { name: 'ET Markets',       handle: 'ETMarkets',         org: 'Economic Times',       url: 'https://x.com/ETMarkets',         type: 'news' },
            { name: 'CNBC TV18',        handle: 'CNBCTV18News',      org: 'CNBC-TV18 Official',   url: 'https://x.com/CNBCTV18News',      type: 'news' },
            { name: 'Vivek Bajaj',      handle: 'marketgurukul',     org: 'StockEdge / Market Guru', url: 'https://x.com/marketgurukul',  type: 'f&o' },
        ];

        const result = {
            timestamp: new Date().toISOString(),
            isMarketHours, niftyPrice, niftyChange, vix, bankNifty, bankChange,
            macd: { value: macdVal, signal: macdSignal, histogram: macdHist, cross: macdCross },
            bankNiftyIndicators: { rsi: bankRsi, ema: bankEma, macdCross: bankMacdCross },
            levels: { swingHigh, swingLow, maxPain: maxPainStr },
            tradeSuggestions,
            xExperts: X_EXPERTS,
            layer1: {
                score: +layer1Total.toFixed(1),
                pass: layer1Pass,
                signals: {
                    sentiment: { score: +sentNorm.toFixed(1), label: sentLabel, doubleCheck: sentDoubleCheck, rawScore: sentScore, strongBull: strongBullCount, strongBear: strongBearCount },
                    vix:       { score: vixScore, value: +vix.toFixed(1), label: vixLabel },
                    month:     { score: monthScore, month: mData.m, wr: mData.wr, pnl: mData.pnl, label: monthLabel },
                    trend:     { score: trendScore, change: +niftyChange.toFixed(2), label: trendLabel },
                },
            },
            layer2: {
                score: +layer2Total.toFixed(1),
                pass: layer2Pass,
                signals: {
                    technical: { score: techScore, rsi: rsiVal, ema: emaSignal, vwap: vwapRelation, atr: atrVal, stochRsi: stochRsiK, label: techLabel },
                    volume:    { score: volScore, ratio: volRatio, label: volLabel },
                    iv:        { score: ivScore, vix: +vix.toFixed(1), label: ivLabel },
                    pcr:       { score: pcrScore, value: pcr, label: pcrLabel },
                    pattern:   { score: patternScore, label: patternLabel },
                },
                options: { atmStrike, maxPain: maxPainStr, suggested: suggestedStrike, pcr },
            },
            recommendation: {
                signal: finalSignal, color: signalColor, action,
                combinedScore: +combinedScore.toFixed(1),
                holdRule: 'INTRADAY ONLY (exit by 15:15 IST)',
                edgeAlerts,
            },
            traderProfile: TRADER_EDGE,
        };

        personalModelCache = result;
        pmCacheTs = Date.now();
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
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
    console.log(`TerminalX API Live on ${PORT}`);
    // Pre-warm caches in background so first user gets fast response
    setTimeout(() => {
        fetch(`http://localhost:${PORT}/api/gti`).catch(() => {});
        fetch(`http://localhost:${PORT}/api/globalnews`).catch(() => {});
        fetch(`http://localhost:${PORT}/api/futures`).catch(() => {});
        fetch(`http://localhost:${PORT}/api/indicesbar`).catch(() => {});
        fetch(`http://localhost:${PORT}/api/livetape`).catch(() => {});
    }, 3000);
});
