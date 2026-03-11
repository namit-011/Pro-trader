const yahooFinance = require('yahoo-finance2').default;

async function test() {
    try {
        console.log('Testing RELIANCE.NS with 6mo/1d...');
        const results = await yahooFinance.chart('RELIANCE.NS', { period1: '2024-01-01', interval: '1d' });
        console.log('Success 1, quotes:', results.quotes.length);
    } catch (e) {
        console.error('Fail 1:', e.message);
    }

    try {
        console.log('Testing AAPL with range/interval...');
        const results = await yahooFinance.chart('AAPL', { range: '1d', interval: '1m' });
        console.log('Success 2, quotes:', results.quotes.length);
    } catch (e) {
        console.error('Fail 2:', e.message);
    }
}

test();
