'use strict';

const isIndianTicker = (t) => /\.(NS|BO)$/i.test(t) || ['^NSEI', '^NSEBANK', '^BSESN'].includes(t);

const erfApprox = (x) => {
    const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - t * (a[0] + t * (a[1] + t * (a[2] + t * (a[3] + t * a[4])))) * Math.exp(-x * x);
    return s * y;
};

const N  = (x) => 0.5 * (1 + erfApprox(x / Math.SQRT2));
const Np = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const bsPrice = (S, K, T, r, σ, type) => {
    if (T <= 0) return Math.max(0, type === 'C' ? S - K : K - S);
    const d1 = (Math.log(S / K) + (r + 0.5 * σ * σ) * T) / (σ * Math.sqrt(T));
    const d2 = d1 - σ * Math.sqrt(T);
    return type === 'C'
        ? S * N(d1) - K * Math.exp(-r * T) * N(d2)
        : K * Math.exp(-r * T) * N(-d2) - S * N(-d1);
};

const bsGreeks = (S, K, T, r, σ, type) => {
    if (T <= 0 || σ <= 0) {
        return { delta: type === 'C' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0 };
    }
    const sqrtT = Math.sqrt(T);
    const d1    = (Math.log(S / K) + (r + 0.5 * σ * σ) * T) / (σ * sqrtT);
    const d2    = d1 - σ * sqrtT;
    const nd1   = Np(d1);
    const delta = type === 'C' ? N(d1) : N(d1) - 1;
    const gamma = +(nd1 / (S * σ * sqrtT)).toFixed(6);
    const theta = type === 'C'
        ? +(((-S * nd1 * σ) / (2 * sqrtT) - r * K * Math.exp(-r * T) * N(d2))  / 365).toFixed(2)
        : +(((-S * nd1 * σ) / (2 * sqrtT) + r * K * Math.exp(-r * T) * N(-d2)) / 365).toFixed(2);
    const vega  = +(S * nd1 * sqrtT / 100).toFixed(2);
    return { delta: +delta.toFixed(3), gamma, theta, vega };
};

const prevOICache = new Map();

const getLastThursday = (y, m) => {
    const d = new Date(y, m + 1, 0);
    while (d.getDay() !== 4) d.setDate(d.getDate() - 1);
    return d;
};

const getNSEExpiries = (n = 3) => {
    const now = new Date();
    const out = [];
    let y = now.getFullYear(), m = now.getMonth();
    while (out.length < n) {
        const exp = getLastThursday(y, m);
        if (exp > now)
            out.push(exp.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
        if (++m > 11) { m = 0; y++; }
    }
    return out;
};

const buildTheoreticalChain = (price, hv, expiryStr) => {
    const MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
    const [dd, mon, yyyy] = expiryStr.split(' ');
    const expDate = new Date(+yyyy, MONTHS[mon], +dd);
    const T = Math.max(1, (expDate - new Date()) / (1000 * 60 * 60 * 24)) / 365;
    const r = 0.065;
    const iv = Math.max(10, Math.min(80, hv));

    const step = price < 100 ? 1 : price < 500 ? 5 : price < 2000 ? 50 : price < 5000 ? 100 : 200;
    const atm   = Math.round(price / step) * step;
    const calls = [], puts = [];

    for (let i = -10; i <= 10; i++) {
        const K = atm + i * step;
        if (K <= 0) continue;
        const m      = (K - price) / price;
        const callIV = Math.max(5, iv + m * 15 + (Math.random() - 0.5) * 2);
        const putIV  = Math.max(5, iv - m * 12 + 2 + (Math.random() - 0.5) * 2);
        const cPrice = Math.max(0.05, +bsPrice(price, K, T, r, callIV / 100, 'C').toFixed(2));
        const pPrice = Math.max(0.05, +bsPrice(price, K, T, r, putIV  / 100, 'P').toFixed(2));
        const cOI    = Math.round(Math.exp(-2.5 * Math.pow(m + 0.005, 2)) * (400000 + Math.random() * 200000));
        const pOI    = Math.round(Math.exp(-2.5 * Math.pow(m - 0.005, 2)) * (500000 + Math.random() * 200000));
        const cG     = bsGreeks(price, K, T, r, callIV / 100, 'C');
        const pG     = bsGreeks(price, K, T, r, putIV  / 100, 'P');

        const cKey = `C_${K}`, pKey = `P_${K}`;
        const cOIChange = prevOICache.has(cKey) ? cOI - prevOICache.get(cKey) : 0;
        const pOIChange = prevOICache.has(pKey) ? pOI - prevOICache.get(pKey) : 0;
        prevOICache.set(cKey, cOI);
        prevOICache.set(pKey, pOI);

        calls.push({
            strike: K, lastPrice: cPrice,
            bid: +(cPrice * 0.98).toFixed(2), ask: +(cPrice * 1.02).toFixed(2),
            iv: +callIV.toFixed(1), oi: cOI, oiChange: cOIChange,
            vol: Math.round(cOI * 0.25 * Math.random()), inTheMoney: K < price,
            delta: cG.delta, gamma: cG.gamma, theta: cG.theta, vega: cG.vega,
        });
        puts.push({
            strike: K, lastPrice: pPrice,
            bid: +(pPrice * 0.98).toFixed(2), ask: +(pPrice * 1.02).toFixed(2),
            iv: +putIV.toFixed(1), oi: pOI, oiChange: pOIChange,
            vol: Math.round(pOI * 0.25 * Math.random()), inTheMoney: K > price,
            delta: pG.delta, gamma: pG.gamma, theta: pG.theta, vega: pG.vega,
        });
    }

    const totalCallOI = calls.reduce((s, o) => s + o.oi, 0);
    const totalPutOI  = puts.reduce((s, o) => s + o.oi, 0);
    const pcr         = totalCallOI > 0 ? +(totalPutOI / totalCallOI).toFixed(2) : null;
    const allStrikes  = calls.map((c) => c.strike);
    let minLoss = Infinity, maxPain = allStrikes[Math.floor(allStrikes.length / 2)];
    for (const p of allStrikes) {
        const loss = calls.reduce((s, o) => s + Math.max(0, p - o.strike) * o.oi, 0)
                   + puts.reduce((s, o) => s + Math.max(0, o.strike - p) * o.oi, 0);
        if (loss < minLoss) { minLoss = loss; maxPain = p; }
    }
    const maxOI = Math.max(...calls.map((o) => o.oi), ...puts.map((o) => o.oi), 1);
    return { calls, puts, pcr, maxPain, atm, maxOI, totalCallOI, totalPutOI };
};

module.exports = { isIndianTicker, bsPrice, bsGreeks, getNSEExpiries, buildTheoreticalChain };
