export default function Gauge({ val, label, color }) {
    const v   = parseFloat(val) || 0;
    const pct = Math.min(100, Math.max(0, v));

    return (
        <div className="gauge-wrap">
            <div className="gauge-arc">
                <div className="gauge-fill" style={{ '--pct': pct, '--color': color }} />
                <div className="gauge-center">
                    <span style={{ color }}>{v > 0 ? v.toFixed(1) : '--'}</span>
                </div>
            </div>
            <div className="gauge-label">{label}</div>
        </div>
    );
}
