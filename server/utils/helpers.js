'use strict';

const getRelativeTime = (dateInput) => {
    const d     = dateInput instanceof Date ? dateInput : new Date(dateInput);
    const delta = Math.round((new Date() - d) / 1000);
    if (delta < 60)    return `${delta}s ago`;
    if (delta < 3600)  return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

const toPeriod1 = (rangeStr) => {
    const d   = new Date();
    const map = {
        '1d':  [0, 0, -1],
        '5d':  [0, 0, -5],
        '1mo': [0, -1, 0],
        '3mo': [0, -3, 0],
        '6mo': [0, -6, 0],
        '1y':  [-1, 0, 0],
        '2y':  [-2, 0, 0],
    };
    const [y, m, day] = map[rangeStr] || [0, -6, 0];
    d.setFullYear(d.getFullYear() + y);
    d.setMonth(d.getMonth() + m);
    d.setDate(d.getDate() + day);
    return d;
};

const cleanName = (n, sym) =>
    (n || sym)
        .replace(/ NSE$/i, '')
        .replace(/ Limited$/i, ' Ltd')
        .replace(/ Ltd\.$/, ' Ltd');

const parseNum = (s) => parseFloat((String(s || '0')).replace(/,/g, '')) || 0;

const fmtCap = (v) =>
    v >= 1e12 ? (v / 1e12).toFixed(2) + 'T'
    : v >= 1e9  ? (v / 1e9).toFixed(2)  + 'B'
    : v >= 1e6  ? (v / 1e6).toFixed(2)  + 'M'
    : String(v);

module.exports = { getRelativeTime, toPeriod1, cleanName, parseNum, fmtCap };
