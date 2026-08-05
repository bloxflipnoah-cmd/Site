import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QuestClient } from './src/quest/questClient.js';
import { TokenStore } from './src/quest/tokenStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3004;

// Discord configuration
const GUILD_ID = '1534514417306435604';
const BUYER_ROLE_ID = '1534622916535128094';

// Simple session storage (in production, use proper session management)
const sessions = new Map();

// Initialize token store
const tokenStore = new TokenStore(process.env.DISCORD_TOKEN || 'default-secret');

// MIME types
const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// Helper function to parse cookies
function parseCookies(cookieHeader) {
    const cookies = {};
    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const [name, value] = cookie.trim().split('=');
            cookies[name] = value;
        });
    }
    return cookies;
}

// Helper function to get session ID
function getSessionId(cookies) {
    return cookies.session_id;
}

// Helper function to send JSON response
function sendJson(res, data, statusCode = 200) {
    const jsonData = JSON.stringify(data);
    console.log(`Sending JSON response (${statusCode}):`, jsonData.substring(0, 100) + '...');
    res.writeHead(statusCode, { 
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonData)
    });
    res.end(jsonData);
}

// Helper function to send file
function sendFile(res, filePath) {
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>404 Not Found</h1>');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

// Helper function to parse POST body
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
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

// Helper function to check if user has buyer role
async function hasBuyerRole(userId) {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
        console.error('BOT_TOKEN environment variable not set');
        return false;
    }

    try {
        const response = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bot ${botToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error('Failed to fetch guild member:', response.status);
            return false;
        }

        const member = await response.json();
        return member.roles && member.roles.includes(BUYER_ROLE_ID);
    } catch (error) {
        console.error('Error checking buyer role:', error);
        return false;
    }
}

// Create server
const server = http.createServer(async (req, res) => {
    console.log(`${req.method} ${req.url}`);
    
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    let url;
    try {
        url = new URL(req.url, `http://${req.headers.host}`);
    } catch (e) {
        console.error('URL parse error:', e);
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Bad Request</h1>');
        return;
    }

    const pathname = url.pathname;
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = getSessionId(cookies);
    const session = sessions.get(sessionId);

    // API Routes (must come before static file serving)
    if (pathname === '/login' && req.method === 'POST') {
        console.log('POST /login received');
        try {
            const body = await parseBody(req);
            console.log('Body parsed:', body);
            const { token } = body;

            if (!token) {
                console.log('No token provided');
                sendJson(res, { error: 'Token is required' }, 400);
                return;
            }

            console.log('Login attempt for token:', token.substring(0, 10) + '...');

            // Validate token by fetching user info
            const questClient = new QuestClient(token);
            const userData = await questClient.fetchUserRaw();

            console.log('User data received:', userData);

            if (!userData.id) {
                console.error('Invalid token - no user ID');
                sendJson(res, { error: 'Invalid token' }, 401);
                return;
            }

            console.log('Login successful for user:', userData.username);

            // Check if user has buyer role
            const hasRole = await hasBuyerRole(userData.id);
            if (!hasRole) {
                console.error('User does not have buyer role');
                sendJson(res, { error: 'You need the buyer role to access this dashboard' }, 403);
                return;
            }

            // Create session
            const newSessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
            sessions.set(newSessionId, {
                userId: userData.id,
                userToken: token,
                username: userData.username,
                avatar: userData.avatar
            });

            // Store token in token store
            tokenStore.save(userData.id, token);

            console.log('Session created, redirecting to dashboard');
            
            // Set session cookie BEFORE sending response
            res.setHeader('Set-Cookie', `session_id=${newSessionId}; Path=/; HttpOnly`);
            sendJson(res, { success: true, redirect: '/dashboard' });
        } catch (error) {
            console.error('Login error:', error);
            sendJson(res, { error: 'Invalid or expired token: ' + error.message }, 401);
        }
        return;
    }

    // Serve static files
    if (pathname === '/' || pathname === '/login') {
        if (req.method === 'GET') {
            if (session) {
                res.writeHead(302, { 'Location': '/dashboard' });
                res.end();
            } else {
                sendFile(res, path.join(__dirname, 'public', 'login.html'));
            }
            return;
        }
    }

    if (pathname === '/dashboard') {
        if (!session) {
            res.writeHead(302, { 'Location': '/login' });
            res.end();
        } else {
            sendFile(res, path.join(__dirname, 'public', 'dashboard.html'));
        }
        return;
    }

    // Serve CSS
    if (pathname === '/style.css') {
        sendFile(res, path.join(__dirname, 'public', 'style.css'));
        return;
    }

    if (pathname === '/api/user' && req.method === 'GET') {
        if (!session) {
            sendJson(res, { error: 'Unauthorized' }, 401);
            return;
        }

        try {
            const questClient = new QuestClient(session.userToken);
            const userData = await questClient.fetchUserRaw();

            sendJson(res, {
                id: userData.id,
                username: userData.username,
                global_name: userData.global_name,
                avatar: userData.avatar,
                discriminator: userData.discriminator
            });
        } catch (error) {
            console.error('User data error:', error);
            sendJson(res, { error: 'Failed to fetch user data' }, 500);
        }
        return;
    }

    if (pathname === '/api/quests' && req.method === 'GET') {
        if (!session) {
            sendJson(res, { error: 'Unauthorized' }, 401);
            return;
        }

        try {
            const questClient = new QuestClient(session.userToken);
            const questManager = await questClient.fetchQuests();
            const quests = questManager.list();

            // Use the same filtering as the Discord bot
            const validQuests = questManager.filterQuestsValid();
            const completedQuests = questManager.getCompleted();

            const total = completedQuests.length + validQuests.length;
            sendJson(res, {
                total: total,
                completed: completedQuests.length,
                uncompleted: validQuests.map(quest => ({
                    id: quest.id,
                    config: quest.config,
                    userStatus: quest.userStatus,
                    isCompleted: quest.isCompleted(),
                    isExpired: quest.isExpired()
                }))
            });
        } catch (error) {
            console.error('Quests error:', error);
            sendJson(res, { error: 'Failed to fetch quests' }, 500);
        }
        return;
    }

    if (pathname.match(/^\/api\/quest\/[^\/]+\/complete$/) && req.method === 'POST') {
        if (!session) {
            sendJson(res, { error: 'Unauthorized' }, 401);
            return;
        }

        try {
            const questId = pathname.split('/')[3];
            const questClient = new QuestClient(session.userToken);
            const questManager = await questClient.fetchQuests();

            // Use the same filtering as the Discord bot
            const validQuests = questManager.filterQuestsValid();
            const quest = validQuests.find(q => q.id === questId);
            
            if (!quest) {
                sendJson(res, { error: 'Quest not found or not valid' }, 404);
                return;
            }

            await questManager.doingQuest(quest);

            sendJson(res, { success: true, message: 'Quest completed successfully' });
        } catch (error) {
            console.error('Complete quest error:', error);
            sendJson(res, { error: 'Failed to complete quest' }, 500);
        }
        return;
    }

    if (pathname === '/api/quests/complete-all' && req.method === 'POST') {
        if (!session) {
            sendJson(res, { error: 'Unauthorized' }, 401);
            return;
        }

        try {
            const questClient = new QuestClient(session.userToken);
            const questManager = await questClient.fetchQuests();
            
            // Use the same filtering as the Discord bot
            const validQuests = questManager.filterQuestsValid();
            const results = [];

            for (const quest of validQuests) {
                try {
                    await questManager.doingQuest(quest);
                    results.push({ questId: quest.id, success: true });
                } catch (error) {
                    results.push({ questId: quest.id, success: false, error: error.message });
                }
            }

            sendJson(res, {
                success: true,
                total: validQuests.length,
                completed: results.filter(r => r.success).length,
                results
            });
        } catch (error) {
            console.error('Complete all quests error:', error);
            sendJson(res, { error: 'Failed to complete quests' }, 500);
        }
        return;
    }

    if (pathname === '/logout' && req.method === 'POST') {
        if (sessionId) {
            sessions.delete(sessionId);
        }
        sendJson(res, { success: true, redirect: '/login' });
        return;
    }

    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 Not Found</h1>');
});

// Start server
server.listen(PORT, () => {
    console.log(`Quest Completer Web Dashboard running on http://localhost:${PORT}`);
});