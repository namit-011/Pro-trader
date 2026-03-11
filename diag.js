const yahooFinance = require('yahoo-finance2').default;

async function test() {
    const ticker = 'RELIANCE.NS';
    console.log('--- Testing Historical (1mo) ---');
    try {
        const res = await yahooFinance.chart(ticker, { range: '1mo', interval: '1d' });
        console.log('Quotes count:', res.quotes.length);
        if (res.quotes.length > 0) console.log('Last quote:', res.quotes[res.quotes.length - 1]);
    } catch (e) {
        console.error('Err:', e.message);
    }

    console.log('\n--- Testing Intraday (1d/1m) ---');
    try {
        const res = await yahooFinance.chart(ticker, { range: '1d', interval: '1m' });
        console.log('Quotes count:', res.quotes.length);
    } catch (e) {
        console.error('Err:', e.message);
    }

    console.log('\n--- Testing News Sorting ---');
    try {
        const res = await yahooFinance.search('Nifty Sensex Market');
        const news = res.news || [];
        console.log('News count:', news.length);
        if (news.length > 0) {
            news.sort((a, b) => b.providerPublishTime - a.providerPublishTime);
            console.log('Latest News Time:', new Date(news[0].providerPublishTime * 1000).toLocaleString());
        }
    } catch (e) {
        console.error('Err:', e.message);
    }
}

test();
