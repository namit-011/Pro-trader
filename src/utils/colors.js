export const gtiColor = (g) =>
    g >= 80 ? '#ef4444' : g >= 60 ? '#fb923c' : g >= 35 ? '#3b82f6' : '#22c55e';

export const gtiLevel = (g) =>
    g >= 80 ? 'CRITICAL' : g >= 60 ? 'ELEVATED' : g >= 35 ? 'MEDIUM' : 'LOW';

export const dirColor = (d) =>
    ({ BUY: '#10b981', SELL: '#ef4444', HOLD: '#eab308' }[d] || '#94a3b8');

export const sentColor = (s) =>
    ({ bullish: '#10b981', bearish: '#ef4444', neutral: '#94a3b8' }[s] || '#94a3b8');

export const sentLabel = (s) =>
    ({ bullish: '▲ BULLISH', bearish: '▼ BEARISH', neutral: '→ NEUTRAL' }[s] || '→ NEUTRAL');

export const actionColor = (a) =>
    ({
        'STRONG BUY': '#10b981',
        BUY:          '#10b981',
        HOLD:         '#eab308',
        SELL:         '#ef4444',
        'STRONG SELL':'#b91c1c',
    }[a] || '#94a3b8');

export const indiaLabel = (s) =>
    ({ bullish: '▲ India', bearish: '▼ India', neutral: '~ India' }[s] || '~ India');
