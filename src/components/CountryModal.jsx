export default function CountryModal({ modal, onClose }) {
    if (!modal) return null;

    return (
        <div className="cm-overlay" onClick={onClose}>
            <div className="cm-box" onClick={(e) => e.stopPropagation()}>
                <div className="cm-head">
                    <div className="cm-title-block">
                        <div className="cm-country">{modal.name}</div>
                        <div className="cm-sub">MARKET INDICES · {modal.iso}</div>
                    </div>
                    <button className="cm-close" onClick={onClose}>✕</button>
                </div>

                {!modal.data ? (
                    <div className="cm-loading">⟳ Fetching market data…</div>
                ) : modal.data.length === 0 ? (
                    <div className="cm-empty">No index data available for this region</div>
                ) : (
                    <div className="cm-list">
                        {modal.data.map((idx, i) => (
                            <div key={i} className="cm-row">
                                <div className="cm-row-left">
                                    <div className="cm-sym">{idx.symbol}</div>
                                    <div className="cm-idx-name">{idx.name?.slice(0, 32)}</div>
                                </div>
                                <div className="cm-row-right">
                                    <span className="cm-price">
                                        {idx.price != null
                                            ? idx.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })
                                            : '—'}
                                        {idx.currency && idx.currency !== 'INR' ? ` ${idx.currency}` : ''}
                                    </span>
                                    <span className={`cm-chg ${(idx.changePercent || 0) >= 0 ? 'pos' : 'neg'}`}>
                                        {(idx.changePercent || 0) >= 0 ? '▲' : '▼'}
                                        {Math.abs(idx.changePercent || 0).toFixed(2)}%
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="cm-footer">⊙ Data via Yahoo Finance · Cached 60s</div>
            </div>
        </div>
    );
}
