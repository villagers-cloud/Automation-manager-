const http = require('http');
const url = require('url');
const config = require('./config');
const middleware = require('./middleware');

function sendResponse(res, statusCode, data) {
    middleware.applySecurityHeaders(res);
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
    // 1. CORS check
    if (!middleware.handleCors(req, res)) {
        return sendResponse(res, 403, { error: 'Origin not allowed by CORS policy' });
    }

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
        middleware.applySecurityHeaders(res);
        res.writeHead(204);
        return res.end();
    }

    // 2. HTTP Method Check
    const allowedMethods = ['GET', 'POST', 'OPTIONS'];
    if (!allowedMethods.includes(req.method)) {
        return sendResponse(res, 405, { error: 'Method Not Allowed' });
    }

    // 3. Rate Limit Check
    if (!middleware.checkRateLimit(req)) {
        console.warn(`[SECURITY] Rate limit exceeded for IP: ${req.socket.remoteAddress}`);
        return sendResponse(res, 429, { error: 'Too Many Requests' });
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    try {
        // Route: /api/health
        if (pathname === '/api/health') {
            return sendResponse(res, 200, {
                status: 'ok',
                service: 'Automation Manager Secure Proxy',
                timestamp: new Date().toISOString(),
                environment: config.NODE_ENV
            });
        }

        // Explicitly REJECT open proxy query attempts (e.g. /api/proxy?url=https://...)
        if (pathname.startsWith('/api/proxy') && parsedUrl.query.url) {
            console.warn(`[SECURITY] Open proxy attempt rejected from IP: ${req.socket.remoteAddress}`);
            return sendResponse(res, 400, { error: 'Arbitrary open proxy requests are forbidden' });
        }

        // Route: /api/proxy/* (Allowlisted proxy routes)
        if (pathname.startsWith('/api/proxy/')) {
            const serviceKey = pathname.replace('/api/proxy/', '');
            if (!config.APPROVED_SERVICES[serviceKey]) {
                return sendResponse(res, 404, { error: 'Proxy route not found or not allowlisted' });
            }

            // Future allowlisted service proxy handling logic goes here
            return sendResponse(res, 501, { error: 'Service connector not configured' });
        }

        // Default: 404 for unknown endpoints
        return sendResponse(res, 404, { error: 'Endpoint Not Found' });

    } catch (err) {
        console.error('[SERVER ERROR]', err.message || err);
        const statusCode = err.statusCode || 500;
        const message = config.NODE_ENV === 'production' ? 'An internal error occurred' : err.message;
        return sendResponse(res, statusCode, { error: message });
    }
});

if (require.main === module) {
    server.listen(config.PORT, config.HOST, () => {
        console.log(`Automation Manager Secure Proxy running on http://${config.HOST}:${config.PORT}`);
    });
}

module.exports = server;
