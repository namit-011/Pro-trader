export const fmt = (n, d = 2) =>
    n != null && !isNaN(n) ? Number(n).toFixed(d) : 'N/A';

export const fmtCur = (n, c = '₹') =>
    n != null && !isNaN(n) && n !== 0
        ? `${c}${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
        : 'N/A';
