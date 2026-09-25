const config = require('./config');

// In-memory rate limiting store: ip -> { count, resetTime }
const rateLimitStore = new Map();

// Periodic cleanup of stale rate limit entries
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimitStore.entries()) {
        if (now > data.resetTime) {
            rateLimitStore.delete(ip);
        }
    }
}, 60000);
if (cleanupInterval.unref) cleanupInterval.unref();

function applySecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'");
    if (config.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
}

function handleCors(req, res) {
    const origin = req.headers.origin;
    if (origin) {
        if (config.ALLOWED_ORIGINS.includes('*') || config.ALLOWED_ORIGINS.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            res.setHeader('Access-Control-Max-Age', '86400');
        } else {
            return false; // Disallowed origin
        }
    }
    return true;
}

function checkRateLimit(req) {
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let record = rateLimitStore.get(ip);

    if (!record || now > record.resetTime) {
        record = { count: 1, resetTime: now + config.RATE_LIMIT_WINDOW_MS };
        rateLimitStore.set(ip, record);
        return true;
    }

    record.count++;
    if (record.count > config.RATE_LIMIT_MAX_REQUESTS) {
        return false;
    }
    return true;
}

function parseJsonBody(req, maxBytes = config.MAX_BODY_SIZE) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];

        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                req.destroy();
                const err = new Error('Payload Too Large');
                err.statusCode = 413;
                reject(err);
            } else {
                chunks.push(chunk);
            }
        });

        req.on('end', () => {
            if (chunks.length === 0) {
                return resolve({});
            }
            const bodyStr = Buffer.concat(chunks).toString('utf8');
            try {
                const json = JSON.parse(bodyStr);
                resolve(json);
            } catch (err) {
                const parseErr = new Error('Invalid JSON Body');
                parseErr.statusCode = 400;
                reject(parseErr);
            }
        });

        req.on('error', (err) => reject(err));
    });
}

module.exports = {
    applySecurityHeaders,
    handleCors,
    checkRateLimit,
    parseJsonBody
};
