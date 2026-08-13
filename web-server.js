import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QuestClient } from './src/quest/questClient.js';
import { MongoClient } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3004;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://bloxflipnoah_db_user:FzJR4H5JKSpXHyvt@cluster0.aediear.mongodb.net/?appName=Cluster0&retryWrites=true&w=majority";
const DB_NAME = process.env.DB_NAME || "obistral";

// Admin Discord IDs (comma-separated)
const ADMIN_DISCORD_IDS = process.env.ADMIN_DISCORD_IDS 
    ? process.env.ADMIN_DISCORD_IDS.split(",").map(id => id.trim()).filter(id => id)
    : ["1484879718015832127"];

// =========================================================
// MONGODB CONNECTION
// =========================================================

let mongoClient = null;
let db = null;

async function connectToMongoDB() {
    try {
        mongoClient = new MongoClient(MONGODB_URI);
        await mongoClient.connect();
        db = mongoClient.db(DB_NAME);
        console.log('Connected to MongoDB Atlas');

        // Create indexes for better performance
        const sessionsCollection = db.collection('sessions');
        await sessionsCollection.createIndex({ sessionId: 1 }, { unique: true });
        await sessionsCollection.createIndex({ discordToken: 1 });

        const robuxFarmCollection = db.collection('robux_farm_data');
        await robuxFarmCollection.createIndex({ discordToken: 1 }, { unique: true });

        const withdrawalsCollection = db.collection('withdrawals');
        await withdrawalsCollection.createIndex({ discordToken: 1 });
        await withdrawalsCollection.createIndex({ status: 1 });
        await withdrawalsCollection.createIndex({ createdAt: -1 });

    } catch (error) {
        console.error('MongoDB connection error:', error);
    }
}

// =========================================================
// WITHDRAWAL STORAGE (MONGODB + FILE FALLBACK)
// =========================================================

const WITHDRAWALS_FILE = path.join(__dirname, 'withdrawals-data.json');

async function createWithdrawal(discordToken, userId, username, psd, gamepassId, robuxAmount) {
    const withdrawal = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
        discordToken,
        userId,
        username,
        psd,
        gamepassId,
        robuxAmount,
        status: 'pending',
        createdAt: new Date()
    };

    // Try MongoDB first
    try {
        if (db) {
            const collection = db.collection('withdrawals');
            await collection.insertOne(withdrawal);
            return withdrawal;
        }
    } catch (error) {
        console.error('MongoDB withdrawal save error, falling back to file:', error.message);
    }

    // Fallback to file
    try {
        let fileData = [];
        if (fs.existsSync(WITHDRAWALS_FILE)) {
            fileData = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, 'utf8'));
        }
        fileData.push(withdrawal);
        fs.writeFileSync(WITHDRAWALS_FILE, JSON.stringify(fileData, null, 2));
        return withdrawal;
    } catch (error) {
        console.error('File withdrawal save error:', error);
        throw error;
    }
}

async function getWithdrawals() {
    // Try MongoDB first
    try {
        if (db) {
            const collection = db.collection('withdrawals');
            const withdrawals = await collection.find({}).sort({ createdAt: -1 }).toArray();
            return withdrawals;
        }
    } catch (error) {
        console.error('MongoDB withdrawals load error, falling back to file:', error.message);
    }

    // Fallback to file
    try {
        if (fs.existsSync(WITHDRAWALS_FILE)) {
            return JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('File withdrawals load error:', error);
    }

    return [];
}

async function updateWithdrawalStatus(withdrawalId, status) {
    // Try MongoDB first
    try {
        if (db) {
            const collection = db.collection('withdrawals');
            await collection.updateOne(
                { id: withdrawalId },
                { $set: { status, updatedAt: new Date() } }
            );
            return;
        }
    } catch (error) {
        console.error('MongoDB withdrawal update error, falling back to file:', error.message);
    }

    // Fallback to file
    try {
        if (fs.existsSync(WITHDRAWALS_FILE)) {
            let fileData = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, 'utf8'));
            const withdrawal = fileData.find(w => w.id === withdrawalId);
            if (withdrawal) {
                withdrawal.status = status;
                withdrawal.updatedAt = new Date();
                fs.writeFileSync(WITHDRAWALS_FILE, JSON.stringify(fileData, null, 2));
            }
        }
    } catch (error) {
        console.error('File withdrawal update error:', error);
    }
}

// =========================================================
// ROBUX FARM DATA STORAGE (MONGODB + FILE FALLBACK)
// =========================================================

const ROBUX_FARM_DATA_FILE = path.join(__dirname, 'robux-farm-data.json');

async function loadRobuxFarmData(discordToken) {
    try {
        // Try MongoDB first
        if (db) {
            const collection = db.collection('robux_farm_data');
            const data = await collection.findOne({ discordToken });

            if (data) {
                return {
                    adsWatched: data.adsWatched || 0,
                    earnings: data.earnings || 0,
                    robuxEarned: data.robuxEarned || 0
                };
            }
        }
    } catch (error) {
        console.error('MongoDB load error, falling back to file:', error.message);
    }

    // Fallback to file
    try {
        if (fs.existsSync(ROBUX_FARM_DATA_FILE)) {
            const data = fs.readFileSync(ROBUX_FARM_DATA_FILE, 'utf8');
            const parsedData = JSON.parse(data);
            return parsedData[discordToken] || { adsWatched: 0, earnings: 0, robuxEarned: 0 };
        }
    } catch (error) {
        console.error('File load error:', error);
    }

    return { adsWatched: 0, earnings: 0, robuxEarned: 0 };
}

async function saveRobuxFarmData(discordToken, data) {
    // Try MongoDB first
    try {
        if (db) {
            const collection = db.collection('robux_farm_data');
            await collection.updateOne(
                { discordToken },
                {
                    $set: {
                        ...data,
                        discordToken,
                        lastUpdated: new Date()
                    }
                },
                { upsert: true }
            );
            return;
        }
    } catch (error) {
        console.error('MongoDB save error, falling back to file:', error.message);
    }

    // Fallback to file
    try {
        let fileData = {};
        if (fs.existsSync(ROBUX_FARM_DATA_FILE)) {
            fileData = JSON.parse(fs.readFileSync(ROBUX_FARM_DATA_FILE, 'utf8'));
        }
        fileData[discordToken] = {
            ...data,
            lastUpdated: Date.now()
        };
        fs.writeFileSync(ROBUX_FARM_DATA_FILE, JSON.stringify(fileData, null, 2));
    } catch (error) {
        console.error('File save error:', error);
    }
}

// =========================================================
// SESSION MANAGEMENT (MONGODB + FILE FALLBACK)
// =========================================================

const SESSIONS_FILE = path.join(__dirname, 'sessions-data.json');

async function getSession(sessionId) {
    try {
        // Try MongoDB first
        if (db) {
            const collection = db.collection('sessions');
            const session = await collection.findOne({ sessionId });

            if (session) {
                return {
                    sessionId: session.sessionId,
                    discordToken: session.discordToken,
                    createdAt: session.createdAt
                };
            }
        }
    } catch (error) {
        console.error('MongoDB session load error, falling back to file:', error.message);
    }

    // Fallback to file
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            const parsedData = JSON.parse(data);
            return parsedData[sessionId] || null;
        }
    } catch (error) {
        console.error('File session load error:', error);
    }

    return null;
}

async function createSession(sessionId, discordToken, userId) {
    // Try MongoDB first
    try {
        if (db) {
            const collection = db.collection('sessions');
            await collection.updateOne(
                { sessionId },
                {
                    $set: {
                        sessionId,
                        discordToken,
                        userId,
                        createdAt: new Date()
                    }
                },
                { upsert: true }
            );
            return;
        }
    } catch (error) {
        console.error('MongoDB session save error, falling back to file:', error.message);
    }

    // Fallback to file
    try {
        let fileData = {};
        if (fs.existsSync(SESSIONS_FILE)) {
            fileData = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        }
        fileData[sessionId] = {
            sessionId,
            discordToken,
            userId,
            createdAt: new Date().toISOString()
        };
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(fileData, null, 2));
    } catch (error) {
        console.error('File session save error:', error);
    }
}

async function deleteSession(sessionId) {
    // Try MongoDB first
    try {
        if (db) {
            const collection = db.collection('sessions');
            await collection.deleteOne({ sessionId });
            return;
        }
    } catch (error) {
        console.error('MongoDB session delete error, falling back to file:', error.message);
    }

    // Fallback to file
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            let fileData = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
            delete fileData[sessionId];
            fs.writeFileSync(SESSIONS_FILE, JSON.stringify(fileData, null, 2));
        }
    } catch (error) {
        console.error('File session delete error:', error);
    }
}

// =========================================================
// SESSIONS
// =========================================================

const sessions = new Map();


// =========================================================
// ANTI-DDOS
// =========================================================

const DDOS_PROTECTION = {
    maxRequestsPerMinute: 300,
    maxRequestsPerHour: 2000,
    banThreshold: 500,
    banDuration: 5 * 60 * 1000,
    suspiciousThreshold: 100,
    blockDuration: 2 * 60 * 1000
};

const requestTracker = new Map();
const blockedIPs = new Map();
const suspiciousIPs = new Map();


// =========================================================
// CLIENT IP
// =========================================================

function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];

    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }

    return (
        req.headers['x-real-ip'] ||
        req.socket.remoteAddress ||
        req.connection.remoteAddress ||
        'unknown'
    );
}


// =========================================================
// DDOS PROTECTION
// =========================================================

// Rate limiting for API endpoints
const apiRateLimit = new Map();
const API_RATE_LIMITS = {
    perMinute: 60,
    perHour: 500
};

function checkAPIRateLimit(ip) {
    const now = Date.now();
    let tracker = apiRateLimit.get(ip);

    if (!tracker) {
        tracker = { requests: [] };
        apiRateLimit.set(ip, tracker);
    }

    // Clean old requests (older than 1 hour)
    tracker.requests = tracker.requests.filter(timestamp => now - timestamp < 3600000);

    // Check per-minute limit
    const minuteRequests = tracker.requests.filter(timestamp => now - timestamp < 60000);
    if (minuteRequests.length >= API_RATE_LIMITS.perMinute) {
        return {
            allowed: false,
            reason: 'API rate limit exceeded (per minute)',
            retryAfter: 60
        };
    }

    // Check per-hour limit
    if (tracker.requests.length >= API_RATE_LIMITS.perHour) {
        return {
            allowed: false,
            reason: 'API rate limit exceeded (per hour)',
            retryAfter: 3600
        };
    }

    // Add current request
    tracker.requests.push(now);
    return { allowed: true };
}

function checkDDoSProtection(ip) {
    const now = Date.now();

    // Check if IP is already blocked
    if (blockedIPs.has(ip)) {
        const blockExpiry = blockedIPs.get(ip);

        if (now < blockExpiry) {
            return {
                allowed: false,
                reason: 'IP is temporarily blocked due to suspicious activity',
                retryAfter: Math.ceil((blockExpiry - now) / 1000)
            };
        } else {
            blockedIPs.delete(ip);
        }
    }

    // Get or create IP tracker
    let tracker = requestTracker.get(ip);

    if (!tracker) {
        tracker = {
            requests: [],
            totalRequests: 0,
            lastReset: now
        };

        requestTracker.set(ip, tracker);
    }

    // Clean old requests
    tracker.requests = tracker.requests.filter(
        time => now - time < 3600000
    );

    // Add current request
    tracker.requests.push(now);
    tracker.totalRequests++;

    // Check minute rate limit
    const minuteRequests = tracker.requests.filter(
        time => now - time < 60000
    );

    if (minuteRequests.length > DDOS_PROTECTION.maxRequestsPerMinute) {
        return {
            allowed: false,
            reason: 'Too many requests per minute',
            retryAfter: 60
        };
    }

    // Check hour rate limit
    if (tracker.requests.length > DDOS_PROTECTION.maxRequestsPerHour) {
        blockedIPs.set(
            ip,
            now + DDOS_PROTECTION.banDuration
        );

        return {
            allowed: false,
            reason: 'Hourly rate limit exceeded - IP temporarily blocked',
            retryAfter: DDOS_PROTECTION.banDuration / 1000
        };
    }

    // Check suspicious burst
    const recentRequests = tracker.requests.filter(
        time => now - time < 10000
    );

    if (recentRequests.length > DDOS_PROTECTION.suspiciousThreshold) {
        const suspiciousCount =
            (suspiciousIPs.get(ip) || 0) + 1;

        suspiciousIPs.set(ip, suspiciousCount);

        if (suspiciousCount >= 3) {
            blockedIPs.set(
                ip,
                now + DDOS_PROTECTION.blockDuration
            );

            return {
                allowed: false,
                reason: 'Suspicious activity detected - IP temporarily blocked',
                retryAfter: DDOS_PROTECTION.blockDuration / 1000
            };
        }

        return {
            allowed: false,
            reason: 'Too many requests in short time - please slow down',
            retryAfter: 10
        };
    }

    return {
        allowed: true
    };
}


// =========================================================
// SECURITY LOG
// =========================================================

function logSecurityEvent(ip, event, details) {
    const timestamp = new Date().toISOString();

    console.log(
        `[SECURITY] ${timestamp} - IP: ${ip} - Event: ${event} - Details: ${details}`
    );
}


// =========================================================
// MIME TYPES
// =========================================================

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',

    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',

    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};


// =========================================================
// COOKIES
// =========================================================

function parseCookies(cookieHeader) {
    const cookies = {};

    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const [name, ...rest] = cookie.trim().split('=');

            if (name) {
                cookies[name] = rest.join('=');
            }
        });
    }

    return cookies;
}


// =========================================================
// SESSION ID
// =========================================================

function getSessionId(cookies) {
    return cookies.session_id;
}


// =========================================================
// JSON RESPONSE
// =========================================================

function sendJson(res, data, statusCode = 200) {
    const jsonData = JSON.stringify(data);

    console.log(
        `Sending JSON response (${statusCode}):`,
        jsonData.substring(0, 100) + '...'
    );

    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(jsonData)
    });

    res.end(jsonData);
}


// =========================================================
// SEND FILE
// =========================================================

function sendFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();

    const contentType =
        mimeTypes[ext] ||
        'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.error(
                'File not found:',
                filePath
            );

            console.error(
                'Error:',
                err.message
            );

            res.writeHead(404, {
                'Content-Type': 'text/html; charset=utf-8'
            });

            res.end('<h1>404 Not Found</h1>');

            return;
        }

        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache'
        });

        res.end(data);
    });
}


// =========================================================
// PARSE POST BODY
// =========================================================

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk;
        });

        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(e);
            }
        });

        req.on('error', reject);
    });
}


// =========================================================
// CREATE SERVER
// =========================================================

const server = http.createServer(async (req, res) => {

    console.log(`${req.method} ${req.url}`);


    // =====================================================
    // CORS
    // =====================================================

    res.setHeader(
        'Access-Control-Allow-Origin',
        '*'
    );

    res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS'
    );

    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization'
    );

    // =====================================================
    // SECURITY HEADERS
    // =====================================================

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');


    // =====================================================
    // OPTIONS
    // =====================================================

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }


    // =====================================================
    // DDOS PROTECTION (DÉSACTIVÉ TEMPORAIREMENT)
    // =====================================================

    const clientIP = getClientIP(req);

    const protectionResult =
        checkDDoSProtection(clientIP);

    if (!protectionResult.allowed) {
        // Désactivé temporairement - bypass le blocage
        console.log('DDOS protection bypassed for:', clientIP);
    }

    /*

    if (!protectionResult.allowed) {

        logSecurityEvent(
            clientIP,
            'BLOCKED',
            protectionResult.reason
        );

        res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After':
                protectionResult.retryAfter.toString()
        });

        res.end(
            JSON.stringify({
                error: 'Too many requests',
                reason: protectionResult.reason,
                retryAfter: protectionResult.retryAfter
            })
        );

        return;
    }

    */
    // =====================================================
    // PARSE URL
    // =====================================================

    let url;

    try {
        url = new URL(
            req.url,
            `http://${req.headers.host}`
        );
    } catch (e) {

        console.error(
            'URL parse error:',
            e
        );

        res.writeHead(400, {
            'Content-Type': 'text/html'
        });

        res.end('<h1>Bad Request</h1>');

        return;
    }

    const pathname = url.pathname;

    const cookies =
        parseCookies(req.headers.cookie);

    const sessionId =
        getSessionId(cookies);

    // Try to get session from MongoDB first, then fall back to Map
    let session = await getSession(sessionId);
    if (!session) {
        session = sessions.get(sessionId);
    }


    // =====================================================
    // LOGIN API
    // =====================================================

    if (
        pathname === '/login' &&
        req.method === 'POST'
    ) {

        console.log(
            'POST /login received'
        );

        try {

            const body =
                await parseBody(req);

            console.log(
                'Body parsed:',
                body
            );

            const { token } = body;

            if (!token) {

                console.log(
                    'No token provided'
                );

                sendJson(
                    res,
                    {
                        error: 'Token is required'
                    },
                    400
                );

                return;
            }


            console.log(
                'Login attempt for token:',
                token.substring(0, 10) + '...'
            );

            console.log(
                'Token length:',
                token.length
            );

            console.log(
                'Token format check:',
                token.startsWith('mfa.')
                    ? 'MFA token'
                    : 'Regular token'
            );


            // =================================================
            // VALIDATE TOKEN
            // =================================================

            const questClient =
                new QuestClient(token);

            let userData;

            try {

                userData =
                    await questClient.fetchUserRaw();

                console.log(
                    'User data received:',
                    userData
                );

            } catch (fetchError) {

                console.error(
                    'Fetch user error:',
                    fetchError
                );

                console.error(
                    'Fetch user error details:',
                    fetchError.message
                );

                sendJson(
                    res,
                    {
                        error:
                            'Failed to fetch user data: ' +
                            fetchError.message
                    },
                    401
                );

                return;
            }


            if (!userData.id) {

                console.error(
                    'Invalid token - no user ID'
                );

                sendJson(
                    res,
                    {
                        error: 'Invalid token'
                    },
                    401
                );

                return;
            }


            console.log(
                'Login successful for user:',
                userData.username
            );


            // =================================================
            // CREATE SESSION
            // =================================================

            const newSessionId =
                Date.now().toString() +
                Math.random()
                    .toString(36)
                    .substring(2, 11);

            const sessionData = {
                sessionId: newSessionId,
                discordToken: token,
                userId: userData.id,
                username: userData.username,
                avatar: userData.avatar
            };

            // Save to both Map (for immediate use) and MongoDB (for persistence)
            sessions.set(newSessionId, sessionData);
            await createSession(newSessionId, token, userData.id);

            console.log(
                'Session created, redirecting to dashboard'
            );

            res.setHeader(
                'Set-Cookie',
                `session_id=${newSessionId}; Path=/; HttpOnly`
            );


            sendJson(
                res,
                {
                    success: true,
                    redirect: '/mode-selection'
                }
            );

        } catch (error) {

            console.error(
                'Login error:',
                error
            );

            sendJson(
                res,
                {
                    error:
                        'Invalid or expired token: ' +
                        error.message
                },
                401
            );
        }

        return;
    }


    // =====================================================
    // LOGIN PAGE
    // =====================================================

    if (
        pathname === '/' ||
        pathname === '/login'
    ) {

        if (req.method === 'GET') {

            if (session) {

                res.writeHead(
                    302,
                    {
                        'Location': '/mode-selection'
                    }
                );

                res.end();

            } else {

                sendFile(
                    res,
                    path.join(
                        __dirname,
                        'public',
                        'login.html'
                    )
                );
            }

            return;
        }
    }


    // =====================================================
    // MODE SELECTION
    // =====================================================

    if (pathname === '/mode-selection') {

        if (!session) {

            res.writeHead(
                302,
                {
                    'Location': '/login'
                }
            );

            res.end();

        } else {

            sendFile(
                res,
                path.join(
                    __dirname,
                    'public',
                    'mode-selection.html'
                )
            );
        }

        return;
    }


    // =====================================================
    // ROBUX FARM
    // =====================================================

    if (pathname === '/robux-farm') {

        if (!session) {

            res.writeHead(
                302,
                {
                    'Location': '/login'
                }
            );

            res.end();

        } else if (url.searchParams.get('from') === 'selection') {

            sendFile(
                res,
                path.join(
                    __dirname,
                    'public',
                    'robux-farm.html'
                )
            );

        } else {

            res.writeHead(
                302,
                {
                    'Location': '/mode-selection'
                }
            );

            res.end();
        }

        return;
    }


    // =====================================================
    // DASHBOARD
    // =====================================================

    if (pathname === '/dashboard') {

        if (!session) {

            res.writeHead(
                302,
                {
                    'Location': '/login'
                }
            );

            res.end();

        } else if (url.searchParams.get('from') === 'selection') {

            sendFile(
                res,
                path.join(
                    __dirname,
                    'public',
                    'dashboard.html'
                )
            );

        } else {

            res.writeHead(
                302,
                {
                    'Location': '/mode-selection'
                }
            );

            res.end();
        }

        return;
    }


    // =====================================================
    // CSS
    // =====================================================

    if (
        pathname === '/style.css' &&
        req.method === 'GET'
    ) {

        sendFile(
            res,
            path.join(
                __dirname,
                'public',
                'style.css'
            )
        );

        return;
    }


    // =====================================================
    // SERVICE WORKER (Monetag)
    // =====================================================

    if (
        pathname === '/sw.js' &&
        req.method === 'GET'
    ) {

        sendFile(
            res,
            path.join(
                __dirname,
                'sw.js'
            )
        );

        return;
    }


    // =====================================================
    // BACKGROUND.MP4
    // =====================================================

    if (
        pathname === '/background.mp4' &&
        req.method === 'GET'
    ) {

        console.log(
            'Serving background.mp4'
        );

        const videoPath =
            path.join(
                __dirname,
                'public',
                'background.mp4'
            );

        console.log(
            'Video path:',
            videoPath
        );

        const ext = path.extname(videoPath).toLowerCase();
        const contentType = 'video/mp4';

        fs.readFile(videoPath, (err, data) => {
            if (err) {
                console.error(
                    'Video not found:',
                    videoPath
                );

                console.error(
                    'Error:',
                    err.message
                );

                res.writeHead(404, {
                    'Content-Type': 'text/html; charset=utf-8'
                });

                res.end('<h1>404 Not Found</h1>');

                return;
            }

            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': 'no-cache'
            });

            res.end(data);
        });

        return;
    }


    // =====================================================
    // USER API
    // =====================================================

    if (
        pathname === '/api/user' &&
        req.method === 'GET'
    ) {

        const ip = getClientIP(req);
        const rateLimitCheck = checkAPIRateLimit(ip);
        if (!rateLimitCheck.allowed) {
            sendJson(res, { error: rateLimitCheck.reason }, 429);
            return;
        }

        if (!session) {

            sendJson(
                res,
                {
                    error: 'Unauthorized'
                },
                401
            );

            return;
        }

        try {

            const questClient =
                new QuestClient(
                    session.userToken
                );

            const userData =
                await questClient.fetchUserRaw();

            // Check if user is admin
            const isAdmin = userData.username === 'theotim3637_04894';

            sendJson(
                res,
                {
                    id: userData.id,
                    username: userData.username,
                    global_name: userData.global_name,
                    avatar: userData.avatar,
                    discriminator:
                        userData.discriminator,
                    isAdmin: isAdmin
                }
            );

        } catch (error) {

            console.error(
                'User data error:',
                error
            );

            sendJson(
                res,
                {
                    error:
                        'Failed to fetch user data'
                },
                500
            );
        }

        return;
    }


    // =====================================================
    // QUESTS API
    // =====================================================

    if (
        pathname === '/api/quests' &&
        req.method === 'GET'
    ) {

        const ip = getClientIP(req);
        const rateLimitCheck = checkAPIRateLimit(ip);
        if (!rateLimitCheck.allowed) {
            sendJson(res, { error: rateLimitCheck.reason }, 429);
            return;
        }

        if (!session) {

            sendJson(
                res,
                {
                    error: 'Unauthorized'
                },
                401
            );

            return;
        }

        try {

            const questClient =
                new QuestClient(
                    session.userToken
                );

            const questManager =
                await questClient.fetchQuests();

            const quests =
                questManager.list();

            const validQuests =
                questManager.filterQuestsValid();

            const completedQuests =
                questManager.getCompleted();

            const total =
                completedQuests.length +
                validQuests.length;


            // Check if user is admin for global stats
            const userData = await questClient.fetchUserRaw();
            const isAdmin = userData.username === 'theotim3637_04894';

            let globalStats = null;
            if (isAdmin) {
                // For admin, get global stats from all sessions
                let totalGlobalCompleted = 0;
                let totalGlobalQuests = 0;

                for (const [sessionId, sessionData] of sessions) {
                    try {
                        const client = new QuestClient(sessionData.userToken);
                        const manager = await client.fetchQuests();
                        const completed = manager.getCompleted();
                        const valid = manager.filterQuestsValid();
                        totalGlobalCompleted += completed.length;
                        totalGlobalQuests += (completed.length + valid.length);
                    } catch (e) {
                        console.error('Error getting stats for session:', sessionId);
                    }
                }

                globalStats = {
                    totalCompleted: totalGlobalCompleted,
                    totalQuests: totalGlobalQuests
                };
            }

            sendJson(
                res,
                {
                    total: total,
                    completed:
                        completedQuests.length,
                    globalStats: globalStats,

                    quests:
                        quests.map(q => ({
                            id: q.id,
                            name: q.name,
                            completed: q.completed,
                            progress: q.progress
                        }))
                }
            );

        } catch (error) {

            console.error(
                'Quests data error:',
                error
            );

            sendJson(
                res,
                {
                    error:
                        'Failed to fetch quests data'
                },
                500
            );
        }

        return;
    }


    // =====================================================
    // COMPLETE QUEST
    // =====================================================

    if (
        pathname.match(
            /^\/api\/quest\/[^\/]+\/complete$/
        ) &&
        req.method === 'POST'
    ) {

        const ip = getClientIP(req);
        const rateLimitCheck = checkAPIRateLimit(ip);
        if (!rateLimitCheck.allowed) {
            sendJson(res, { error: rateLimitCheck.reason }, 429);
            return;
        }

        if (!session) {

            sendJson(
                res,
                {
                    error: 'Unauthorized'
                },
                401
            );

            return;
        }

        try {

            const questId =
                pathname.split('/')[3];

            const questClient =
                new QuestClient(
                    session.userToken
                );

            const questManager =
                await questClient.fetchQuests();

            const validQuests =
                questManager.filterQuestsValid();

            const quest =
                validQuests.find(
                    q => q.id === questId
                );


            if (!quest) {

                sendJson(
                    res,
                    {
                        error:
                            'Quest not found or not valid'
                    },
                    404
                );

                return;
            }


            const completed =
                await questManager.doingQuest(
                    quest
                );


            if (!completed) {

                sendJson(
                    res,
                    {
                        error:
                            'Failed to complete quest'
                    },
                    500
                );

                return;
            }


            await questClient.fetchQuests();


            sendJson(
                res,
                {
                    success: true,
                    message:
                        'Quest completed successfully'
                }
            );

        } catch (error) {

            console.error(
                'Complete quest error:',
                error
            );

            sendJson(
                res,
                {
                    error:
                        'Failed to complete quest'
                },
                500
            );
        }

        return;
    }


    // =====================================================
    // COMPLETE ALL QUESTS
    // =====================================================

    if (
        pathname === '/api/quests/complete-all' &&
        req.method === 'POST'
    ) {

        const ip = getClientIP(req);
        const rateLimitCheck = checkAPIRateLimit(ip);
        if (!rateLimitCheck.allowed) {
            sendJson(res, { error: rateLimitCheck.reason }, 429);
            return;
        }

        if (!session) {

            sendJson(
                res,
                {
                    error: 'Unauthorized'
                },
                401
            );

            return;
        }

        try {

            const questClient =
                new QuestClient(
                    session.userToken
                );

            const questManager =
                await questClient.fetchQuests();

            const validQuests =
                questManager.filterQuestsValid();

            const results = [];


            for (const quest of validQuests) {

                try {

                    const completed =
                        await questManager.doingQuest(
                            quest
                        );

                    results.push({
                        questId: quest.id,
                        success: completed
                    });

                } catch (error) {

                    results.push({
                        questId: quest.id,
                        success: false,
                        error: error.message
                    });
                }
            }


            const completedCount =
                results.filter(
                    r => r.success
                ).length;


            sendJson(
                res,
                {
                    success: true,
                    total: validQuests.length,
                    completed: completedCount,
                    results
                }
            );

        } catch (error) {

            console.error(
                'Complete all quests error:',
                error
            );

            sendJson(
                res,
                {
                    error:
                        'Failed to complete quests'
                },
                500
            );
        }

        return;
    }


    // =====================================================
    // ROBUX FARM API - GET DATA
    // =====================================================

    if (
        pathname === '/api/robux-farm/data' &&
        req.method === 'GET'
    ) {

        if (!session) {
            sendJson(
                res,
                { error: 'Unauthorized' },
                401
            );
            return;
        }

        try {
            const userData = await loadRobuxFarmData(session.discordToken);

            sendJson(
                res,
                { success: true, data: userData }
            );

        } catch (error) {
            console.error('Get robux farm data error:', error);
            sendJson(
                res,
                { error: 'Failed to load data' },
                500
            );
        }

        return;
    }


    // =====================================================
    // ROBUX FARM API - SAVE DATA
    // =====================================================

    if (
        pathname === '/api/robux-farm/data' &&
        req.method === 'POST'
    ) {

        if (!session) {
            sendJson(
                res,
                { error: 'Unauthorized' },
                401
            );
            return;
        }

        try {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const { adsWatched, earnings, robuxEarned } = JSON.parse(body);

                    await saveRobuxFarmData(session.discordToken, {
                        adsWatched,
                        earnings,
                        robuxEarned
                    });

                    sendJson(
                        res,
                        { success: true }
                    );

                } catch (parseError) {
                    console.error('Parse error:', parseError);
                    sendJson(
                        res,
                        { error: 'Invalid request body' },
                        400
                    );
                }
            });

        } catch (error) {
            console.error('Save robux farm data error:', error);
            sendJson(
                res,
                { error: 'Failed to save data' },
                500
            );
        }

        return;
    }


    // =====================================================
    // WITHDRAWAL API - CREATE WITHDRAWAL
    // =====================================================

    if (
        pathname === '/api/withdrawals' &&
        req.method === 'POST'
    ) {

        if (!session) {
            sendJson(
                res,
                { error: 'Unauthorized' },
                401
            );
            return;
        }

        try {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const { psd, gamepassId, robuxAmount } = JSON.parse(body);

                    if (!psd || !gamepassId || !robuxAmount) {
                        sendJson(
                            res,
                            { error: 'Missing required fields: psd, gamepassId, robuxAmount' },
                            400
                        );
                        return;
                    }

                    if (robuxAmount < 200) {
                        sendJson(
                            res,
                            { error: 'Minimum withdrawal is 200 Robux' },
                            400
                        );
                        return;
                    }

                    // Check if user has enough Robux
                    const userData = await loadRobuxFarmData(session.discordToken);
                    if (userData.robuxEarned < robuxAmount) {
                        sendJson(
                            res,
                            { error: 'Insufficient Robux balance' },
                            400
                        );
                        return;
                    }

                    // Create withdrawal
                    const withdrawal = await createWithdrawal(
                        session.discordToken,
                        session.userId,
                        session.username,
                        psd,
                        gamepassId,
                        robuxAmount
                    );

                    // Deduct Robux from user balance
                    await saveRobuxFarmData(session.discordToken, {
                        adsWatched: userData.adsWatched,
                        earnings: userData.earnings,
                        robuxEarned: userData.robuxEarned - robuxAmount
                    });

                    sendJson(
                        res,
                        { success: true, withdrawal }
                    );

                } catch (parseError) {
                    console.error('Parse error:', parseError);
                    sendJson(
                        res,
                        { error: 'Invalid request body' },
                        400
                    );
                }
            });

        } catch (error) {
            console.error('Create withdrawal error:', error);
            sendJson(
                res,
                { error: 'Failed to create withdrawal' },
                500
            );
        }

        return;
    }


    // =====================================================
    // WITHDRAWAL API - GET WITHDRAWALS (ADMIN ONLY)
    // =====================================================

    if (
        pathname === '/api/withdrawals' &&
        req.method === 'GET'
    ) {

        if (!session) {
            sendJson(
                res,
                { error: 'Unauthorized' },
                401
            );
            return;
        }

        // Check if user is admin
        if (!ADMIN_DISCORD_IDS.includes(session.userId)) {
            sendJson(
                res,
                { error: 'Forbidden - Admin only' },
                403
            );
            return;
        }

        try {
            const withdrawals = await getWithdrawals();
            sendJson(
                res,
                { success: true, withdrawals }
            );

        } catch (error) {
            console.error('Get withdrawals error:', error);
            sendJson(
                res,
                { error: 'Failed to load withdrawals' },
                500
            );
        }

        return;
    }


    // =====================================================
    // WITHDRAWAL API - UPDATE STATUS (ADMIN ONLY)
    // =====================================================

    if (
        pathname === '/api/withdrawals/status' &&
        req.method === 'POST'
    ) {

        if (!session) {
            sendJson(
                res,
                { error: 'Unauthorized' },
                401
            );
            return;
        }

        // Check if user is admin
        if (!ADMIN_DISCORD_IDS.includes(session.userId)) {
            sendJson(
                res,
                { error: 'Forbidden - Admin only' },
                403
            );
            return;
        }

        try {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const { withdrawalId, status } = JSON.parse(body);

                    if (!withdrawalId || !status) {
                        sendJson(
                            res,
                            { error: 'Missing required fields: withdrawalId, status' },
                            400
                        );
                        return;
                    }

                    if (!['pending', 'approved', 'rejected'].includes(status)) {
                        sendJson(
                            res,
                            { error: 'Invalid status. Must be: pending, approved, or rejected' },
                            400
                        );
                        return;
                    }

                    await updateWithdrawalStatus(withdrawalId, status);

                    sendJson(
                        res,
                        { success: true }
                    );

                } catch (parseError) {
                    console.error('Parse error:', parseError);
                    sendJson(
                        res,
                        { error: 'Invalid request body' },
                        400
                    );
                }
            });

        } catch (error) {
            console.error('Update withdrawal status error:', error);
            sendJson(
                res,
                { error: 'Failed to update withdrawal status' },
                500
            );
        }

        return;
    }


    // =====================================================
    // USER API - ADMIN STATUS CHECK
    // =====================================================

    if (
        pathname === '/api/user/admin-status' &&
        req.method === 'GET'
    ) {

        if (!session) {
            sendJson(
                res,
                { error: 'Unauthorized' },
                401
            );
            return;
        }

        const isAdmin = ADMIN_DISCORD_IDS.includes(session.userId);

        sendJson(
            res,
            { isAdmin }
        );

        return;
    }


    // =====================================================
    // LOGOUT
    // =====================================================

    if (
        pathname === '/logout' &&
        req.method === 'POST'
    ) {

        if (sessionId) {
            sessions.delete(sessionId);
            await deleteSession(sessionId);
        }

        sendJson(
            res,
            {
                success: true,
                redirect: '/login'
            }
        );

        return;
    }


    // =====================================================
    // 404
    // =====================================================

    res.writeHead(
        404,
        {
            'Content-Type':
                'text/html; charset=utf-8'
        }
    );

    res.end(
        '<h1>404 Not Found</h1>'
    );
});


// =========================================================
// START SERVER
// =========================================================

async function startServer() {
    // Connect to MongoDB first
    await connectToMongoDB();

    server.listen(
        PORT,
        () => {
            console.log(
                'Quest Completer Web Dashboard running on http://localhost:' + PORT
            );
        }
    );
}

startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});