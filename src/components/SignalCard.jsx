import { dirColor } from '../utils/colors';

export default function SignalCard({ sig, onAnalyze }) {
    const dc = dirColor(sig.direction);

    return (
        <div className="sig-card" onClick={() => onAnalyze(sig.ticker + '.NS')}>
            <div className="sc-top">
                <div className="sc-ticker-row">
                    <span className="sc-sym">{sig.ticker}</span>
                    <span
                        className="sc-dir-badge"
                        style={{ color: dc, borderColor: dc + '55', background: dc + '18' }}
                    >
                        {sig.direction}
                    </span>
                </div>
                <div className="sc-price-col">
                    <span className="sc-price">
                        ₹{sig.price?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </span>
                    <span className={`sc-chg ${sig.change >= 0 ? 'pos' : 'neg'}`}>
                        {sig.change >= 0 ? '▲' : '▼'}{Math.abs(sig.change).toFixed(2)}%
                    </span>
                </div>
            </div>

            <div className="sc-name">
                {sig.name} <span className="sc-cls">· {sig.cls}</span>
            </div>

            <div className="sc-conf-row">
                <span className="sc-conf-label">Confidence</span>
                <div className="sc-conf-track">
                    <div className="sc-conf-fill" style={{ width: `${sig.confidence}%`, background: dc }} />
                </div>
                <span className="sc-conf-pct" style={{ color: dc }}>{sig.confidence}%</span>
            </div>

            <div className="sc-bars">
                <div className="sc-bar-row">
                    <span className="pos">Bull</span>
                    <div className="sc-track"><div className="sc-fill pos" style={{ width: `${sig.bull}%` }} /></div>
                    <span className="pos sc-pct">{sig.bull}%</span>
                </div>
                <div className="sc-bar-row">
                    <span className="neg">Bear</span>
                    <div className="sc-track"><div className="sc-fill neg" style={{ width: `${sig.bear}%` }} /></div>
                    <span className="neg sc-pct">{sig.bear}%</span>
                </div>
            </div>

            <div className="sc-tags">
                <span className={`sc-vol vol-${sig.vol?.toLowerCase()}`}>VOL: {sig.vol}</span>
                {sig.volSurge && <span className="sc-surge">⚡ SURGE</span>}
                <span className="sc-tag">{sig.timeframe}</span>
                <span className="sc-tag">RR {sig.rr}</span>
            </div>

            <div className="sc-geo">⚡ {sig.geoDriver}</div>
        </div>
    );
}
