'use strict';

const NSE_HDR = {
    'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept:             'application/json, text/plain, */*',
    'Accept-Language':  'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding':  'gzip, deflate, br',
    Referer:            'https://www.nseindia.com/',
    Origin:             'https://www.nseindia.com',
    'sec-ch-ua':        '"Chromium";v="124", "Google Chrome";v="124"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform':'"Windows"',
    'sec-fetch-dest':   'empty',
    'sec-fetch-mode':   'cors',
    'sec-fetch-site':   'same-origin',
    Connection:         'keep-alive',
};

const NSE_TTL        = 3_000;   // 3 s — real-time
const NSE_COOKIE_TTL = 4 * 60 * 1000; // 4 min
const GIFT_TTL       = 15_000;  // 15 s

let nseAllIdxCache  = { data: null, ts: 0 };
let nseCookieCache  = { cookies: '', ts: 0 };
let lastKnownPCR    = { value: null, ts: 0 };
let bhavPCRCache    = { data: null, dateStr: '' };
let giftNiftyCache  = { data: null, ts: 0 };

// ── Utilities ──
function parseSetCookies(headers) {
    const raw   = headers.get('set-cookie') || '';
    const cookies = {};
    const parts = raw.split(/,\s*(?=[a-zA-Z0-9_-]+=)/);
    parts.forEach((part) => {
        const seg = part.split(';')[0].trim();
        const eq  = seg.indexOf('=');
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

// ── NSE Indices ──
async function getNSEIndices() {
    if (nseAllIdxCache.data && Date.now() - nseAllIdxCache.ts < NSE_TTL) return nseAllIdxCache.data;
    const r = await fetch('https://www.nseindia.com/api/allIndices', {
        headers: NSE_HDR,
        signal:  AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error(`NSE ${r.status}`);
    const j = await r.json();
    nseAllIdxCache = { data: j.data || [], ts: Date.now() };
    return nseAllIdxCache.data;
}

// ── NSE Session / Cookie Management ──
async function getNSESession() {
    if (nseCookieCache.cookies && Date.now() - nseCookieCache.ts < NSE_COOKIE_TTL) {
        return nseCookieCache.cookies;
    }
    try {
        const r1 = await fetch('https://www.nseindia.com', {
            headers: { ...NSE_HDR, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
            signal:  AbortSignal.timeout(10000),
        });
        const c1 = parseSetCookies(r1.headers);
        await new Promise((res) => setTimeout(res, 600));

        const r2 = await fetch('https://www.nseindia.com/option-chain', {
            headers: { ...NSE_HDR, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', Cookie: cookiesToStr(c1) },
            signal:  AbortSignal.timeout(10000),
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
    const r   = await fetch(url, {
        headers: { ...NSE_HDR, Cookie: cookies, Referer: 'https://www.nseindia.com/option-chain' },
        signal:  AbortSignal.timeout(8000),
    });
    if (!r.ok) {
        if (r.status === 401 || r.status === 403) nseCookieCache = { cookies: '', ts: 0 };
        throw new Error(`NSE OC HTTP ${r.status}`);
    }
    return r.json();
}

// ── Bhavcopy PCR ──
async function fetchPCRFromBhavcopy() {
    const zlib = require('zlib');

    const tryDate = async (d) => {
        const ds  = d.toISOString().slice(0, 10).replace(/-/g, '');
        const url = `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${ds}_F_0000.csv.zip`;
        const r   = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal:  AbortSignal.timeout(25000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return { buf: Buffer.from(await r.arrayBuffer()), ds };
    };

    let buf, ds;
    const base = new Date();
    for (let i = 1; i <= 7; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() - i);
        if (d.getDay() === 0 || d.getDay() === 6) continue;
        try { ({ buf, ds } = await tryDate(d)); break; } catch { /* try previous day */ }
    }
    if (!buf) throw new Error('No bhavcopy found in last 7 days');

    const sig      = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const off      = buf.indexOf(sig);
    const compMethod = buf.readUInt16LE(off + 8);
    const fnLen    = buf.readUInt16LE(off + 26);
    const exLen    = buf.readUInt16LE(off + 28);
    const compSize = buf.readUInt32LE(off + 18);
    const dataStart = off + 30 + fnLen + exLen;
    const compressed = buf.slice(dataStart, dataStart + compSize);

    const csv = await new Promise((res, rej) => {
        if (compMethod === 0) res(compressed);
        else zlib.inflateRaw(compressed, (e, r) => e ? rej(e) : res(r));
    });

    const lines    = csv.toString('utf8').split('\n');
    const hdr      = lines[0].split(',');
    const symIdx   = hdr.indexOf('TckrSymb');
    const optIdx   = hdr.indexOf('OptnTp');
    const oiIdx    = hdr.indexOf('OpnIntrst');
    const strikeIdx= hdr.indexOf('StrkPric');

    let ceOI = 0, peOI = 0;
    const strikeMap = {};
    for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(',');
        if (c[symIdx] !== 'NIFTY') continue;
        const oi     = parseFloat(c[oiIdx]) || 0;
        const strike = parseFloat(c[strikeIdx]) || 0;
        const type   = c[optIdx];
        if (!strikeMap[strike]) strikeMap[strike] = { ce: 0, pe: 0 };
        if (type === 'CE') { ceOI += oi; strikeMap[strike].ce += oi; }
        else if (type === 'PE') { peOI += oi; strikeMap[strike].pe += oi; }
    }

    const pcr = ceOI > 0 ? +(peOI / ceOI).toFixed(2) : null;
    const strikes = Object.keys(strikeMap).map(Number).sort((a, b) => a - b);
    let maxPainStrike = null;
    if (strikes.length) {
        let minPain = Infinity;
        for (const K of strikes) {
            const pain = strikes.reduce((s, st) =>
                s + (strikeMap[st].ce || 0) * Math.max(K - st, 0)
                  + (strikeMap[st].pe || 0) * Math.max(st - K, 0), 0);
            if (pain < minPain) { minPain = pain; maxPainStrike = K; }
        }
    }
    return { pcr, ceOI, peOI, maxPain: maxPainStrike, date: ds, source: 'bhavcopy' };
}

async function getLivePCR() {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    if (bhavPCRCache.data && bhavPCRCache.dateStr === todayStr) return bhavPCRCache.data;
    try {
        const data = await fetchPCRFromBhavcopy();
        bhavPCRCache = { data, dateStr: todayStr };
        return data;
    } catch (e) {
        if (bhavPCRCache.data) return bhavPCRCache.data;
        throw e;
    }
}

// ── GIFT NIFTY (MoneyControl) ──
const MC_GIFT_URL = 'https://appfeeds.moneycontrol.com/jsonapi/market/indices?format=json&ind_id=in%3Bgsx';
const MC_HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Referer:      'https://www.moneycontrol.com/',
    Accept:       'application/json, text/plain, */*',
};

async function fetchGiftNifty() {
    if (giftNiftyCache.data && Date.now() - giftNiftyCache.ts < GIFT_TTL) return giftNiftyCache.data;
    const r = await fetch(MC_GIFT_URL, { headers: MC_HDR, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`MC GIFT ${r.status}`);
    const j   = await r.json();
    const idx = j.indices;
    if (!idx || !idx.lastprice) throw new Error('MC GIFT: no price');

    const parseNum = (s) => parseFloat((String(s || '0')).replace(/,/g, '')) || 0;
    const data = {
        symbol:        'GIFT-NIFTY',
        name:          'GIFT NIFTY',
        price:         parseNum(idx.lastprice),
        change:        parseNum(idx.change),
        changePercent: parseNum(idx.percentchange),
        open:          parseNum(idx.open),
        high:          parseNum(idx.high),
        low:           parseNum(idx.low),
        prevClose:     parseNum(idx.prevclose),
        marketState:   idx.market_state || 'UNKNOWN',
        lastUpdated:   idx.lastupdated  || '',
        isLive:        true,
        src:           'MoneyControl',
    };
    giftNiftyCache = { data, ts: Date.now() };
    return data;
}

module.exports = {
    NSE_HDR,
    getNSEIndices,
    getNSESession,
    fetchNSEOptionChain,
    getLivePCR,
    fetchGiftNifty,
};
