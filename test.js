const yahooFinance = require('yahoo-finance2').default;
yahooFinance.quote('AAPL').then(res => console.log('OK')).catch(err => {
    require('fs').writeFileSync('err2.txt', err.stack || err.toString());
});
