'use strict';

const RSS_SOURCES = [
    { url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', pub: 'Economic Times'   },
    { url: 'https://www.moneycontrol.com/rss/latestnews.xml',                      pub: 'MoneyControl'     },
    { url: 'https://www.livemint.com/rss/markets',                                 pub: 'Livemint'         },
    { url: 'https://www.business-standard.com/rss/markets-106.rss',                pub: 'Business Standard'},
    { url: 'https://feeds.feedburner.com/ndtvprofit-latest',                       pub: 'NDTV Profit'      },
    { url: 'https://zeenews.india.com/business/rss.xml',                           pub: 'Zee Business'     },
];

const RSS_TTL = 90_000; // 90 s
let rssCache = { data: null, ts: 0 };

async function fetchRSS(url, max = 20) {
    const r   = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/xml,text/xml,*/*' },
        signal:  AbortSignal.timeout(7000),
    });
    const txt = await r.text();

    const items  = [];
    const RE_ITEM = /<item[^>]*>([\s\S]*?)<\/item>/gi;

    const getTag = (xml, tag) => {
        const m = new RegExp(
            `<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'
        ).exec(xml);
        return m
            ? m[1].trim()
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&#\d+;/g, '')
            : '';
    };

    let m;
    while ((m = RE_ITEM.exec(txt)) !== null && items.length < max) {
        const title = getTag(m[1], 'title');
        if (!title || title.length < 10) continue;
        const link    = getTag(m[1], 'link') || getTag(m[1], 'guid');
        const pubDate = getTag(m[1], 'pubDate');
        const ts      = pubDate ? new Date(pubDate).getTime() : Date.now();
        if (!isNaN(ts)) items.push({ title, link, ts });
    }
    return items.sort((a, b) => b.ts - a.ts);
}

module.exports = { RSS_SOURCES, RSS_TTL, rssCache, fetchRSS };
