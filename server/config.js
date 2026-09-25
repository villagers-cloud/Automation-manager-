// Server Configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'production';

// Security Configuration
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

const MAX_BODY_SIZE = 100 * 1024; // 100 KB max payload
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per 15 min per IP

// Allowlist for future API integration endpoints (currently empty - no external AI calls active)
const APPROVED_SERVICES = {};

module.exports = {
    PORT,
    HOST,
    NODE_ENV,
    ALLOWED_ORIGINS,
    MAX_BODY_SIZE,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX_REQUESTS,
    APPROVED_SERVICES
};
