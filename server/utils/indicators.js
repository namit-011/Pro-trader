'use strict';

function btEMA(arr, period) {
    const k   = 2 / (period + 1);
    const out = [];
    let prev  = null;
    for (const v of arr) {
        if (v == null) { out.push(null); continue; }
        if (prev === null) { prev = v; out.push(v); continue; }
        prev = v * k + prev * (1 - k);
        out.push(+prev.toFixed(4));
    }
    return out;
}

function btMACD(closes) {
    const e12  = btEMA(closes, 12);
    const e26  = btEMA(closes, 26);
    const line = e12.map((v, i) => (v != null && e26[i] != null) ? v - e26[i] : null);
    const sig  = btEMA(line, 9);
    return line.map((v, i) => (v != null && sig[i] != null) ? +(v - sig[i]).toFixed(4) : null);
}

function btRSI(closes, period = 14) {
    const out = new Array(period).fill(null);
    if (closes.length <= period) return out;

    let avgG = 0, avgL = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d > 0) avgG += d; else avgL -= d;
    }
    avgG /= period;
    avgL /= period;
    out.push(avgL === 0 ? 100 : +(100 - 100 / (1 + avgG / avgL)).toFixed(2));

    for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
        avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
        out.push(avgL === 0 ? 100 : +(100 - 100 / (1 + avgG / avgL)).toFixed(2));
    }
    return out;
}

function btATR(bars, period = 14) {
    const tr = [bars[0].high - bars[0].low];
    for (let i = 1; i < bars.length; i++) {
        const pc = bars[i - 1].close;
        tr.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc)));
    }
    const out = new Array(period - 1).fill(null);
    let a = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
    out.push(+a.toFixed(2));
    for (let i = period; i < tr.length; i++) {
        a = (a * (period - 1) + tr[i]) / period;
        out.push(+a.toFixed(2));
    }
    return out;
}

function btVWAP(bars) {
    const result = new Array(bars.length).fill(null);
    let cumTPV = 0, cumV = 0, prevDay = null;

    for (let i = 0; i < bars.length; i++) {
        const d   = new Date(bars[i].date);
        const ist = new Date(d.getTime() + 5.5 * 3600000);
        const day = ist.toISOString().slice(0, 10);

        if (day !== prevDay) { cumTPV = 0; cumV = 0; prevDay = day; }

        const tp  = (bars[i].high + bars[i].low + bars[i].close) / 3;
        const vol = bars[i].volume || 1;
        cumTPV += tp * vol;
        cumV   += vol;
        result[i] = +(cumTPV / cumV).toFixed(2);
    }
    return result;
}

module.exports = { btEMA, btMACD, btRSI, btATR, btVWAP };
