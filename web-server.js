import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QuestClient } from './src/quest/questClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3004;

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

    const session =
        sessions.get(sessionId);


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

            sessions.set(
                newSessionId,
                {
                    userId: userData.id,
                    userToken: token,
                    username: userData.username,
                    avatar: userData.avatar
                }
            );


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
                    redirect: '/dashboard'
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
                        'Location': '/dashboard'
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

        } else {

            sendFile(
                res,
                path.join(
                    __dirname,
                    'public',
                    'dashboard.html'
                )
            );
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
    // LOGOUT
    // =====================================================

    if (
        pathname === '/logout' &&
        req.method === 'POST'
    ) {

        if (sessionId) {
            sessions.delete(sessionId);
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

server.listen(
    PORT,
    () => {
        console.log(
            `Quest Completer Web Dashboard running on http://localhost:${PORT}`
        );
    }
);