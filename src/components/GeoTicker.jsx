export default function GeoTicker({ events }) {
    const doubled = [...events, ...events];

    return (
        <div className="geo-ticker">
            <div className="gt-live-badge">
                <span className="gt-dot" />LIVE
            </div>
            <div className="gt-runway">
                <div className="gt-scroll-track">
                    {doubled.map((e, i) => (
                        <a
                            key={i}
                            href={e.link || '#'}
                            target="_blank"
                            rel="noreferrer"
                            className={`gt-event lvl-${(e.level || 'low').toLowerCase()}`}
                        >
                            <span className={`gt-lvl-dot lvl-${(e.level || 'low').toLowerCase()}`} />
                            <strong>{e.title}</strong>
                            <span className="gt-meta">{e.time} · {e.region}</span>
                            <span className={`gt-badge lvl-${(e.level || 'low').toLowerCase()}`}>{e.level}</span>
                        </a>
                    ))}
                </div>
            </div>
        </div>
    );
}
