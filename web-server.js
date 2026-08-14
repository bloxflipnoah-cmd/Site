import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QuestClient } from './src/quest/questClient.js';
import Database from 'better-sqlite3';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3004;

// Database configuration
const DATABASE_URL = process.env.DATABASE_URL || null;
const DB_PATH = path.join(__dirname, 'database.sqlite');

// Admin Discord IDs (comma-separated)
const ADMIN_DISCORD_IDS = process.env.ADMIN_DISCORD_IDS
    ? process.env.ADMIN_DISCORD_IDS.split(",").map(id => id.trim()).filter(id => id)
    : ["1484879718015832127", "1161678276700414002"];

// Admin usernames (comma-separated)
const ADMIN_USERNAMES = process.env.ADMIN_USERNAMES
    ? process.env.ADMIN_USERNAMES.split(",").map(name => name.trim()).filter(name => name)
    : ["noahlefaux25"];

// Helper function to check if user is admin
function isAdminUser(userId, username) {
    return ADMIN_DISCORD_IDS.includes(userId) || ADMIN_USERNAMES.includes(username);
}

// =========================================================
// DATABASE INITIALIZATION (POSTGRESQL + SQLITE FALLBACK)
// =========================================================

let db = null; // SQLite database
let pgPool = null; // PostgreSQL pool
let usePostgreSQL = false;

async function initDatabase() {
    console.log('=== STARTING DATABASE INITIALIZATION ===');
    console.log('DATABASE_URL:', DATABASE_URL ? 'configured' : 'not configured');

    // Try PostgreSQL first (for Railway)
    if (DATABASE_URL) {
        try {
            pgPool = new pg.Pool({
                connectionString: DATABASE_URL,
                ssl: { rejectUnauthorized: false }
            });

            // Test connection
            const client = await pgPool.connect();
            await client.query('SELECT NOW()');
            client.release();

            // Create tables
            await createPostgreSQLTables();
            
            // Migrate existing tables to fix column naming
            await migratePostgreSQLTables();

            usePostgreSQL = true;
            console.log('=== POSTGRESQL DATABASE INITIALIZED ===');
            return;
        } catch (error) {
            console.error('=== POSTGRESQL CONNECTION ERROR, FALLING BACK TO SQLITE ===', error.message);
        }
    }

    // Fallback to SQLite (for local development)
    try {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');

        // Create SQLite tables
        createSQLiteTables();

        console.log('=== SQLITE DATABASE INITIALIZED ===');
    } catch (error) {
        console.error('=== SQLITE INITIALIZATION ERROR ===', error);
    }
}

function createSQLiteTables() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            sessionId TEXT PRIMARY KEY,
            userId TEXT NOT NULL,
            userToken TEXT NOT NULL,
            username TEXT,
            avatar TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS robux_farm_data (
            userId TEXT PRIMARY KEY,
            adsWatched INTEGER DEFAULT 0,
            earnings REAL DEFAULT 0,
            robuxEarned REAL DEFAULT 0,
            lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS withdrawals (
            id TEXT PRIMARY KEY,
            discordToken TEXT NOT NULL,
            userId TEXT NOT NULL,
            username TEXT,
            psd TEXT,
            gamepassId TEXT,
            robuxAmount REAL NOT NULL,
            status TEXT DEFAULT 'pending',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS user_warnings (
            userId TEXT PRIMARY KEY,
            warningCount INTEGER DEFAULT 0,
            banUntil DATETIME,
            isPermanentlyBanned INTEGER DEFAULT 0,
            lastWarningAt DATETIME,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

async function createPostgreSQLTables() {
    const client = await pgPool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                "sessionId" TEXT PRIMARY KEY,
                "userId" TEXT NOT NULL,
                "userToken" TEXT NOT NULL,
                "username" TEXT,
                "avatar" TEXT,
                "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS robux_farm_data (
                "userId" TEXT PRIMARY KEY,
                "adsWatched" INTEGER DEFAULT 0,
                "earnings" REAL DEFAULT 0,
                "robuxEarned" REAL DEFAULT 0,
                "lastUpdated" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS withdrawals (
                "id" TEXT PRIMARY KEY,
                "discordToken" TEXT NOT NULL,
                "userId" TEXT NOT NULL,
                "username" TEXT,
                "psd" TEXT,
                "gamepassId" TEXT,
                "robuxAmount" REAL NOT NULL,
                "status" TEXT DEFAULT 'pending',
                "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS user_warnings (
                "userId" TEXT PRIMARY KEY,
                "warningCount" INTEGER DEFAULT 0,
                "banUntil" TIMESTAMP,
                "isPermanentlyBanned" INTEGER DEFAULT 0,
                "lastWarningAt" TIMESTAMP,
                "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } finally {
        client.release();
    }
}

async function migratePostgreSQLTables() {
    const client = await pgPool.connect();
    try {
        // Check and migrate robux_farm_data table
        try {
            const columnInfo = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'robux_farm_data'
            `);
            
            const columns = columnInfo.rows.map(row => row.column_name);
            console.log('Current robux_farm_data columns:', columns);
            
            // If we have lowercase columns (PostgreSQL default), migrate them instead of dropping
            if (columns.some(col => col === col.toLowerCase() && 
                ['userid', 'adswatched', 'robuxearned', 'lastupdated', 'earnings'].includes(col))) {
                console.log('Detected lowercase columns in robux_farm_data, migrating columns...');
                
                // Backup existing data
                await client.query(`CREATE TABLE IF NOT EXISTS robux_farm_data_backup AS SELECT * FROM robux_farm_data`);
                
                // Rename columns one by one to preserve data
                if (columns.includes('userid')) {
                    await client.query(`ALTER TABLE robux_farm_data RENAME COLUMN userid TO "userId"`);
                }
                if (columns.includes('adswatched')) {
                    await client.query(`ALTER TABLE robux_farm_data RENAME COLUMN adswatched TO "adsWatched"`);
                }
                if (columns.includes('robuxearned')) {
                    await client.query(`ALTER TABLE robux_farm_data RENAME COLUMN robuxearned TO "robuxEarned"`);
                }
                if (columns.includes('lastupdated')) {
                    await client.query(`ALTER TABLE robux_farm_data RENAME COLUMN lastupdated TO "lastUpdated"`);
                }
                
                console.log('Column migration completed, data preserved');
            } else if (columns.includes('userid')) {
                console.log('Migrating robux_farm_data columns...');
                await client.query(`ALTER TABLE robux_farm_data RENAME COLUMN userid TO "userId"`);
            }
            if (columns.includes('adswatched')) {
                await client.query(`ALTER TABLE robux_farm_data RENAME COLUMN adswatched TO "adsWatched"`);
            }
            if (columns.includes('robuxearned')) {
                await client.query(`ALTER TABLE robux_farm_data RENAME COLUMN robuxearned TO "robuxEarned"`);
            }
            if (columns.includes('lastupdated')) {
                await client.query(`ALTER TABLE robux_farm_data RENAME COLUMN lastupdated TO "lastUpdated"`);
            }
        } catch (error) {
            console.log('robux_farm_data migration error or not needed:', error.message);
        }

        // Check and migrate sessions table
        try {
            const columnInfo = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'sessions'
            `);
            
            const columns = columnInfo.rows.map(row => row.column_name);
            
            if (columns.includes('sessionid')) {
                console.log('Migrating sessions columns...');
                await client.query(`ALTER TABLE sessions RENAME COLUMN sessionid TO "sessionId"`);
            }
            if (columns.includes('userid')) {
                await client.query(`ALTER TABLE sessions RENAME COLUMN userid TO "userId"`);
            }
            if (columns.includes('usertoken')) {
                await client.query(`ALTER TABLE sessions RENAME COLUMN usertoken TO "userToken"`);
            }
            if (columns.includes('createdat')) {
                await client.query(`ALTER TABLE sessions RENAME COLUMN createdat TO "createdAt"`);
            }
        } catch (error) {
            console.log('sessions migration error or not needed:', error.message);
        }

        // Check and migrate withdrawals table
        try {
            const columnInfo = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'withdrawals'
            `);
            
            const columns = columnInfo.rows.map(row => row.column_name);
            
            if (columns.includes('discordtoken')) {
                console.log('Migrating withdrawals columns...');
                await client.query(`ALTER TABLE withdrawals RENAME COLUMN discordtoken TO "discordToken"`);
            }
            if (columns.includes('userid')) {
                await client.query(`ALTER TABLE withdrawals RENAME COLUMN userid TO "userId"`);
            }
            if (columns.includes('gamepassid')) {
                await client.query(`ALTER TABLE withdrawals RENAME COLUMN gamepassid TO "gamepassId"`);
            }
            if (columns.includes('robuxamount')) {
                await client.query(`ALTER TABLE withdrawals RENAME COLUMN robuxamount TO "robuxAmount"`);
            }
            if (columns.includes('createdat')) {
                await client.query(`ALTER TABLE withdrawals RENAME COLUMN createdat TO "createdAt"`);
            }
            if (columns.includes('updatedat')) {
                await client.query(`ALTER TABLE withdrawals RENAME COLUMN updatedat TO "updatedAt"`);
            }
        } catch (error) {
            console.log('withdrawals migration error or not needed:', error.message);
        }

        console.log('PostgreSQL table migration completed');
    } finally {
        client.release();
    }
}

// =========================================================
// SESSION MANAGEMENT (POSTGRESQL + SQLITE)
// =========================================================

async function getSession(sessionId) {
    if (usePostgreSQL) {
        try {
            const client = await pgPool.connect();
            try {
                const result = await client.query(
                    'SELECT * FROM sessions WHERE "sessionId" = $1',
                    [sessionId]
                );
                if (result.rows.length > 0) {
                    const row = result.rows[0];
                    return {
                        sessionId: row.sessionId,
                        userId: row.userId,
                        userToken: row.userToken,
                        username: row.username,
                        avatar: row.avatar
                    };
                }
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PostgreSQL session load error:', error);
        }
    } else {
        try {
            const stmt = db.prepare('SELECT * FROM sessions WHERE sessionId = ?');
            const session = stmt.get(sessionId);

            if (session) {
                return {
                    sessionId: session.sessionId,
                    userId: session.userId,
                    userToken: session.userToken,
                    username: session.username,
                    avatar: session.avatar
                };
            }
        } catch (error) {
            console.error('SQLite session load error:', error);
        }
    }

    return null;
}

async function createSession(sessionId, userId, userToken, username, avatar) {
    if (usePostgreSQL) {
        try {
            const client = await pgPool.connect();
            try {
                await client.query(`
                    INSERT INTO sessions ("sessionId", "userId", "userToken", "username", "avatar")
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT ("sessionId") DO UPDATE SET
                        "userId" = EXCLUDED."userId",
                        "userToken" = EXCLUDED."userToken",
                        "username" = EXCLUDED."username",
                        "avatar" = EXCLUDED."avatar"
                `, [sessionId, userId, userToken, username, avatar]);
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PostgreSQL session save error:', error);
        }
    } else {
        try {
            const stmt = db.prepare(`
                INSERT INTO sessions (sessionId, userId, userToken, username, avatar)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(sessionId) DO UPDATE SET
                    userId = excluded.userId,
                    userToken = excluded.userToken,
                    username = excluded.username,
                    avatar = excluded.avatar
            `);
            stmt.run(sessionId, userId, userToken, username, avatar);
        } catch (error) {
            console.error('SQLite session save error:', error);
        }
    }
}

async function deleteSession(sessionId) {
    if (usePostgreSQL) {
        try {
            const client = await pgPool.connect();
            try {
                await client.query('DELETE FROM sessions WHERE "sessionId" = $1', [sessionId]);
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PostgreSQL session delete error:', error);
        }
    } else {
        try {
            const stmt = db.prepare('DELETE FROM sessions WHERE sessionId = ?');
            stmt.run(sessionId);
        } catch (error) {
            console.error('SQLite session delete error:', error);
        }
    }
}

// =========================================================
// ROBUX FARM DATA STORAGE (POSTGRESQL + SQLITE)
// =========================================================

async function loadRobuxFarmData(userId) {
    console.log('loadRobuxFarmData - usePostgreSQL:', usePostgreSQL, 'userId:', userId);

    if (usePostgreSQL) {
        try {
            const client = await pgPool.connect();
            try {
                const result = await client.query(
                    'SELECT * FROM robux_farm_data WHERE "userId" = $1',
                    [userId]
                );
                console.log('PostgreSQL query result rows:', result.rows.length);
                if (result.rows.length > 0) {
                    const row = result.rows[0];
                    return {
                        adsWatched: row.adsWatched || 0,
                        earnings: row.earnings || 0,
                        robuxEarned: row.robuxEarned || 0
                    };
                }
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PostgreSQL load robux farm data error:', error);
        }
    } else {
        try {
            const stmt = db.prepare('SELECT * FROM robux_farm_data WHERE userId = ?');
            const data = stmt.get(userId);

            console.log('SQLite query result:', data ? 'found' : 'not found');

            if (data) {
                return {
                    adsWatched: data.adsWatched || 0,
                    earnings: data.earnings || 0,
                    robuxEarned: data.robuxEarned || 0
                };
            }
        } catch (error) {
            console.error('SQLite load robux farm data error:', error);
        }
    }

    console.log('Returning default data (0, 0, 0)');
    return { adsWatched: 0, earnings: 0, robuxEarned: 0 };
}

async function saveRobuxFarmData(userId, data) {
    // Data validation and integrity checks
    if (!userId || typeof userId !== 'string') {
        throw new Error('Invalid userId');
    }
    
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid data object');
    }
    
    // Validate numeric values
    const adsWatched = parseInt(data.adsWatched) || 0;
    const earnings = parseFloat(data.earnings) || 0;
    const robuxEarned = parseFloat(data.robuxEarned) || 0;
    
    // Sanity checks to prevent data corruption
    if (adsWatched < 0 || adsWatched > 1000000) {
        console.error(`[DATA_INTEGRITY] Invalid adsWatched value: ${adsWatched} for user ${userId}`);
        throw new Error('Invalid adsWatched value');
    }
    
    if (earnings < 0 || earnings > 1000000) {
        console.error(`[DATA_INTEGRITY] Invalid earnings value: ${earnings} for user ${userId}`);
        throw new Error('Invalid earnings value');
    }
    
    if (robuxEarned < 0 || robuxEarned > 1000000) {
        console.error(`[DATA_INTEGRITY] Invalid robuxEarned value: ${robuxEarned} for user ${userId}`);
        throw new Error('Invalid robuxEarned value');
    }
    
    // Check mathematical consistency
    const expectedEarnings = (adsWatched / 1000) * 0.20; // CPM = 0.20
    const expectedRobux = expectedEarnings * (200 / 1.50); // ROBUX_PER_EURO
    
    // Allow small margin of error for floating point arithmetic
    const earningsDiff = Math.abs(earnings - expectedEarnings);
    const robuxDiff = Math.abs(robuxEarned - expectedRobux);
    
    if (earningsDiff > 10) { // Allow €10 margin
        console.warn(`[DATA_INTEGRITY] Earnings mismatch for user ${userId}: expected ${expectedEarnings.toFixed(2)}, got ${earnings.toFixed(2)}`);
    }
    
    if (robuxDiff > 100) { // Allow 100 robux margin
        console.warn(`[DATA_INTEGRITY] Robux mismatch for user ${userId}: expected ${expectedRobux.toFixed(2)}, got ${robuxEarned.toFixed(2)}`);
    }

    if (usePostgreSQL) {
        try {
            const client = await pgPool.connect();
            try {
                await client.query(`
                    INSERT INTO robux_farm_data ("userId", "adsWatched", "earnings", "robuxEarned")
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT ("userId") DO UPDATE SET
                        "adsWatched" = EXCLUDED."adsWatched",
                        "earnings" = EXCLUDED."earnings",
                        "robuxEarned" = EXCLUDED."robuxEarned",
                        "lastUpdated" = CURRENT_TIMESTAMP
                `, [userId, adsWatched, earnings, robuxEarned]);
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PostgreSQL save robux farm data error:', error);
            throw error;
        }
    } else {
        try {
            const stmt = db.prepare(`
                INSERT INTO robux_farm_data (userId, adsWatched, earnings, robuxEarned)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(userId) DO UPDATE SET
                    adsWatched = excluded.adsWatched,
                    earnings = excluded.earnings,
                    robuxEarned = excluded.robuxEarned,
                    lastUpdated = CURRENT_TIMESTAMP
            `);
            stmt.run(userId, adsWatched, earnings, robuxEarned);
        } catch (error) {
            console.error('SQLite save robux farm data error:', error);
            throw error;
        }
    }
}

// =========================================================
// WARNING/BAN SYSTEM (POSTGRESQL + SQLITE)
// =========================================================

async function getUserWarnings(userId) {
    if (usePostgreSQL) {
        try {
            const client = await pgPool.connect();
            try {
                const result = await client.query(
                    'SELECT * FROM user_warnings WHERE "userId" = $1',
                    [userId]
                );
                if (result.rows.length > 0) {
                    const row = result.rows[0];
                    return {
                        warningCount: row.warningCount || 0,
                        banUntil: row.banUntil,
                        isPermanentlyBanned: row.isPermanentlyBanned === 1,
                        lastWarningAt: row.lastWarningAt
                    };
                }
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PostgreSQL get user warnings error:', error);
        }
    } else {
        try {
            const stmt = db.prepare('SELECT * FROM user_warnings WHERE userId = ?');
            const data = stmt.get(userId);

            if (data) {
                return {
                    warningCount: data.warningCount || 0,
                    banUntil: data.banUntil,
                    isPermanentlyBanned: data.isPermanentlyBanned === 1,
                    lastWarningAt: data.lastWarningAt
                };
            }
        } catch (error) {
            console.error('SQLite get user warnings error:', error);
        }
    }

    return { warningCount: 0, banUntil: null, isPermanentlyBanned: false, lastWarningAt: null };
}

async function addUserWarning(userId) {
    const currentWarnings = await getUserWarnings(userId);
    const newWarningCount = currentWarnings.warningCount + 1;
    
    let banUntil = null;
    let isPermanentlyBanned = 0;

    if (newWarningCount === 1) {
        // 24h ban
        const banDate = new Date();
        banDate.setHours(banDate.getHours() + 24);
        banUntil = banDate.toISOString();
    } else if (newWarningCount === 2) {
        // 48h ban
        const banDate = new Date();
        banDate.setHours(banDate.getHours() + 48);
        banUntil = banDate.toISOString();
    } else if (newWarningCount >= 3) {
        // Permanent ban
        isPermanentlyBanned = 1;
    }

    if (usePostgreSQL) {
        try {
            const client = await pgPool.connect();
            try {
                await client.query(`
                    INSERT INTO user_warnings ("userId", "warningCount", "banUntil", "isPermanentlyBanned", "lastWarningAt")
                    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                    ON CONFLICT ("userId") DO UPDATE SET
                        "warningCount" = EXCLUDED."warningCount",
                        "banUntil" = EXCLUDED."banUntil",
                        "isPermanentlyBanned" = EXCLUDED."isPermanentlyBanned",
                        "lastWarningAt" = EXCLUDED."lastWarningAt"
                `, [userId, newWarningCount, banUntil, isPermanentlyBanned]);
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PostgreSQL add user warning error:', error);
        }
    } else {
        try {
            const stmt = db.prepare(`
                INSERT INTO user_warnings (userId, warningCount, banUntil, isPermanentlyBanned, lastWarningAt)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(userId) DO UPDATE SET
                    warningCount = excluded.warningCount,
                    banUntil = excluded.banUntil,
                    isPermanentlyBanned = excluded.isPermanentlyBanned,
                    lastWarningAt = excluded.lastWarningAt
            `);
            stmt.run(userId, newWarningCount, banUntil, isPermanentlyBanned);
        } catch (error) {
            console.error('SQLite add user warning error:', error);
        }
    }

    return {
        warningCount: newWarningCount,
        banUntil,
        isPermanentlyBanned: isPermanentlyBanned === 1
    };
}

async function clearUserWarnings(userId) {
    if (usePostgreSQL) {
        try {
            const client = await pgPool.connect();
            try {
                await client.query(`
                    UPDATE user_warnings SET 
                        "warningCount" = 0,
                        "banUntil" = NULL,
                        "isPermanentlyBanned" = 0
                    WHERE "userId" = $1
                `, [userId]);
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PostgreSQL clear user warnings error:', error);
        }
    } else {
        try {
            const stmt = db.prepare(`
                UPDATE user_warnings SET 
                    warningCount = 0,
                    banUntil = NULL,
                    isPermanentlyBanned = 0
                WHERE userId = ?
            `);
            stmt.run(userId);
        } catch (error) {
            console.error('SQLite clear user warnings error:', error);
        }
    }
}

async function isUserBanned(userId) {
    const warnings = await getUserWarnings(userId);
    
    // Check permanent ban
    if (warnings.isPermanentlyBanned) {
        return { banned: true, reason: 'Permanently banned', banUntil: null };
    }
    
    // Check temporary ban
    if (warnings.banUntil) {
        const banUntil = new Date(warnings.banUntil);
        const now = new Date();
        
        if (now < banUntil) {
            const hoursRemaining = Math.ceil((banUntil - now) / (1000 * 60 * 60));
            return { banned: true, reason: `Temporary ban (${hoursRemaining}h remaining)`, banUntil: warnings.banUntil };
        }
    }
    
    return { banned: false, reason: null, banUntil: null };
}

// =========================================================
// WITHDRAWAL STORAGE (POSTGRESQL + SQLITE)
// =========================================================

async function createWithdrawal(discordToken, userId, username, psd, gamepassId, robuxAmount) {
    const withdrawalId = Date.now().toString() + Math.random().toString(36).substring(2, 11);

    if (usePostgreSQL) {
        try {
            const client = await pgPool.connect();
            try {
                await client.query(`
                    INSERT INTO withdrawals ("id", "discordToken", "userId", "username", "psd", "gamepassId", "robuxAmount", "status", "createdAt", "updatedAt")
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', CURRENT_TIMESTAMP, NULL)
                `, [withdrawalId, discordToken, userId, username, psd, gamepassId, robuxAmount]);
                return { id: withdrawalId, discordToken, userId, username, psd, gamepassId, robuxAmount, status: 'pending' };
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PostgreSQL create withdrawal error:', error);
            throw error;
        }
    } else {
        try {
            const stmt = db.prepare(`
                INSERT INTO withdrawals (id, discordToken, userId, username, psd, gamepassId, robuxAmount, status, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, NULL)
            `);
            stmt.run(withdrawalId, discordToken, userId, username, psd, gamepassId, robuxAmount);
            return { id: withdrawalId, discordToken, userId, username, psd, gamepassId, robuxAmount, status: 'pending' };
        } catch (error) {
            console.error('SQLite create withdrawal error:', error);
            throw error;
        }
    }
}

async function getWithdrawals() {
    if (usePostgreSQL) {
        try {
            const client = await pgPool.connect();
            try {
                const result = await client.query('SELECT * FROM withdrawals ORDER BY "createdAt" DESC');
                return result.rows;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PostgreSQL get withdrawals error:', error);
            return [];
        }
    } else {
        try {
            const stmt = db.prepare('SELECT * FROM withdrawals ORDER BY createdAt DESC');
            return stmt.all();
        } catch (error) {
            console.error('SQLite get withdrawals error:', error);
            return [];
        }
    }
}

async function updateWithdrawalStatus(withdrawalId, status) {
    if (usePostgreSQL) {
        try {
            const client = await pgPool.connect();
            try {
                await client.query(`
                    UPDATE withdrawals SET "status" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2
                `, [status, withdrawalId]);
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('PostgreSQL update withdrawal status error:', error);
        }
    } else {
        try {
            const stmt = db.prepare(`
                UPDATE withdrawals SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?
            `);
            stmt.run(status, withdrawalId);
        } catch (error) {
            console.error('SQLite update withdrawal status error:', error);
        }
    }
}

// =========================================================
// SESSIONS (IN-MEMORY FALLBACK)
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

// Rate limiting for robux farm (anti-exploitation)
const robuxFarmRateLimit = new Map();
const ROBUX_FARM_LIMITS = {
    cooldownMs: 10000, // 10 seconds cooldown
    maxAdsPerHour: 360 // Maximum realistic ads per hour (1 per 10s)
};

// Quest completion tracking (anti-exploitation)
const questCompletionTracker = new Map();
const QUEST_ABUSE_LIMITS = {
    minTimeBetweenQuests: 19000, // 19 seconds minimum between quests to avoid warning
    maxQuestsPerMinute: 3, // Maximum 3 quests per minute (1 per 20s)
    autoWarnThreshold: 2, // Auto-warn after 2 violations
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

function checkRobuxFarmRateLimit(userId) {
    const now = Date.now();
    let tracker = robuxFarmRateLimit.get(userId);

    if (!tracker) {
        tracker = { lastAdTime: 0, adsThisHour: [], totalAds: 0 };
        robuxFarmRateLimit.set(userId, tracker);
    }

    // Clean old ads (older than 1 hour)
    tracker.adsThisHour = tracker.adsThisHour.filter(timestamp => now - timestamp < 3600000);

    // Check cooldown (10 seconds between ads)
    if (now - tracker.lastAdTime < ROBUX_FARM_LIMITS.cooldownMs) {
        const cooldownRemaining = Math.ceil((ROBUX_FARM_LIMITS.cooldownMs - (now - tracker.lastAdTime)) / 1000);
        return {
            allowed: false,
            reason: 'Cooldown active',
            retryAfter: cooldownRemaining
        };
    }

    // Check hourly limit
    if (tracker.adsThisHour.length >= ROBUX_FARM_LIMITS.maxAdsPerHour) {
        return {
            allowed: false,
            reason: 'Hourly ad limit exceeded',
            retryAfter: 3600
        };
    }

    return { allowed: true };
}

function recordRobuxFarmAd(userId) {
    const now = Date.now();
    let tracker = robuxFarmRateLimit.get(userId);
    
    if (!tracker) {
        tracker = { lastAdTime: 0, adsThisHour: [], totalAds: 0 };
        robuxFarmRateLimit.set(userId, tracker);
    }

    tracker.lastAdTime = now;
    tracker.adsThisHour.push(now);
    tracker.totalAds++;
}

function checkQuestAbuse(userId) {
    const now = Date.now();
    let tracker = questCompletionTracker.get(userId);

    if (!tracker) {
        tracker = { questTimes: [], violations: 0 };
        questCompletionTracker.set(userId, tracker);
    }

    // Clean old quest times (older than 1 minute)
    tracker.questTimes = tracker.questTimes.filter(timestamp => now - timestamp < 60000);

    // Check if user completed quests too quickly
    if (tracker.questTimes.length >= 2) {
        const lastTwoQuests = tracker.questTimes.slice(-2);
        const timeBetweenQuests = lastTwoQuests[1] - lastTwoQuests[0];

        if (timeBetweenQuests < QUEST_ABUSE_LIMITS.minTimeBetweenQuests) {
            tracker.violations++;
            console.log(`[QUEST_ABUSE] User ${userId} completed 2 quests in ${timeBetweenQuests}ms (violation #${tracker.violations})`);

            // Auto-warn after threshold
            if (tracker.violations >= QUEST_ABUSE_LIMITS.autoWarnThreshold) {
                console.log(`[AUTO_WARN] User ${userId} auto-warned for quest abuse`);
                addUserWarning(userId);
                tracker.violations = 0; // Reset violations after warning
            }

            return {
                allowed: false,
                reason: 'Quest completion too fast',
                violations: tracker.violations
            };
        }
    }

    return { allowed: true };
}

function recordQuestCompletion(userId) {
    const now = Date.now();
    let tracker = questCompletionTracker.get(userId);
    
    if (!tracker) {
        tracker = { questTimes: [], violations: 0 };
        questCompletionTracker.set(userId, tracker);
    }

    tracker.questTimes.push(now);
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

    // Try to get session from database first, then fall back to Map
    let session = await getSession(sessionId);
    if (!session) {
        session = sessions.get(sessionId);
    }

    // Check if user is banned (skip for admin users and API requests)
    // Only block robux farm page, allow other pages like dashboard
    if (session && !isAdminUser(session.userId, session.username) && !pathname.startsWith('/api/')) {
        const banStatus = await isUserBanned(session.userId);
        if (banStatus.banned) {
            console.log(`[BAN] User ${session.userId} is banned: ${banStatus.reason}`);
            
            // Get warning details for the ban page
            const warnings = await getUserWarnings(session.userId);
            
            // Only block robux-farm page specifically
            if (req.method === 'GET' && (pathname === '/robux-farm' || pathname === '/robux-farm.html')) {
                res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`
                    <!DOCTYPE html>
                    <html lang="fr">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Account Suspended</title>
                        <style>
                            body {
                                font-family: Arial, sans-serif;
                                background: #02030a;
                                color: white;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                min-height: 100vh;
                                margin: 0;
                            }
                            .container {
                                text-align: center;
                                padding: 40px;
                                background: rgba(7, 10, 31, 0.67);
                                border: 1px solid rgba(120, 140, 255, 0.12);
                                border-radius: 15px;
                                max-width: 500px;
                            }
                            h1 { color: #f44336; margin-bottom: 20px; }
                            .reason { color: #70799a; margin: 20px 0; font-size: 1.1rem; }
                            .warning-count { 
                                background: rgba(255, 193, 7, 0.1); 
                                border: 1px solid rgba(255, 193, 7, 0.3); 
                                border-radius: 8px; 
                                padding: 15px; 
                                margin: 20px 0; 
                            }
                            .warning-count h3 { color: #ffc107; margin: 0 0 10px 0; }
                            .warning-count p { color: #70799a; margin: 5px 0; }
                            .rules {
                                text-align: left;
                                background: rgba(255, 255, 255, 0.05);
                                padding: 15px;
                                border-radius: 8px;
                                margin: 20px 0;
                            }
                            .rules h3 { color: #00d4ff; margin: 0 0 10px 0; }
                            .rules ul { color: #70799a; margin: 0; padding-left: 20px; }
                            .rules li { margin: 5px 0; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>⚠️ Robux Farm Suspended</h1>
                            <p class="reason">${banStatus.reason}</p>
                            
                            <div class="warning-count">
                                <h3>⚠️ Warnings: ${warnings.warningCount}/3</h3>
                                ${warnings.banUntil ? `<p>Ban ends: ${new Date(warnings.banUntil).toLocaleString()}</p>` : '<p>Permanent ban</p>'}
                            </div>
                            
                            <div class="rules">
                                <h3>📋 Warning System Rules:</h3>
                                <ul>
                                    <li>1 warning = 24h ban</li>
                                    <li>2 warnings = 48h ban</li>
                                    <li>3 warnings = Permanent ban</li>
                                </ul>
                            </div>
                            
                            <p style="color: #70799a; margin-top: 20px;">Auto Quest is still available. Contact support if you believe this is an error.</p>
                        </div>
                    </body>
                    </html>
                `);
                return;
            }
        }
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
                userId: userData.id,
                userToken: token,
                username: userData.username,
                avatar: userData.avatar
            };

            // Save to both Map (for immediate use) and database (for persistence)
            sessions.set(newSessionId, sessionData);
            await createSession(newSessionId, userData.id, token, userData.username, userData.avatar);

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
    // ADMIN PANEL
    // =====================================================

    if (
        pathname === '/admin' ||
        pathname === '/admin.html'
    ) {

        if (!session) {

            res.writeHead(
                302,
                {
                    'Location': '/login'
                }
            );

            res.end();

            return;
        }

        sendFile(
            res,
            path.join(
                __dirname,
                'public',
                'admin.html'
            )
        );

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

            // Check if user is admin by Discord ID or username
            const isAdmin = isAdminUser(userData.id, userData.username);

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
            const isAdmin = isAdminUser(userData.id, userData.username);

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

                    // Record each quest completion (but don't block complete-all)
                    recordQuestCompletion(session.userId);

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
            const userData = await loadRobuxFarmData(session.userId);

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

                    // Get current data to validate increment
                    const currentData = await loadRobuxFarmData(session.userId);
                    
                    // Validate adsWatched increment (anti-exploitation)
                    const adsDiff = adsWatched - currentData.adsWatched;
                    
                    // Log suspicious activity
                    if (adsDiff > 1) {
                        console.log(`[SUSPICIOUS] User ${session.userId} tried to increment ads by ${adsDiff} in one request`);
                        logSecurityEvent(getClientIP(req), 'ROBUX_FARM_EXPLOIT', `User ${session.userId} attempted ads increment of ${adsDiff}`);
                    }
                    
                    // Only allow increment of 1 ad per request (enforced by rate limit)
                    if (adsDiff < 0) {
                        sendJson(res, { error: 'Invalid ads count (cannot decrease)' }, 400);
                        return;
                    }
                    
                    if (adsDiff > 1) {
                        sendJson(res, { error: 'Invalid ads increment (rate limited to 1 per request)' }, 429);
                        return;
                    }

                    // Check rate limit for robux farm
                    const rateLimitCheck = checkRobuxFarmRateLimit(session.userId);
                    if (!rateLimitCheck.allowed) {
                        console.log(`[RATE_LIMIT] User ${session.userId} blocked: ${rateLimitCheck.reason}`);
                        sendJson(res, { 
                            error: rateLimitCheck.reason,
                            retryAfter: rateLimitCheck.retryAfter
                        }, 429);
                        return;
                    }

                    // Record the ad
                    if (adsDiff === 1) {
                        recordRobuxFarmAd(session.userId);
                    }

                    await saveRobuxFarmData(session.userId, {
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
                        { error: 'Failed to save data' },
                        500
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
    // ADMIN API - MANAGE USER ROBUX FARM DATA
    // =====================================================

    if (
        pathname === '/api/admin/robux-farm' &&
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
        if (!isAdminUser(session.userId, session.username)) {
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
                    const { targetUserId, action, adsWatched, earnings, robuxEarned } = JSON.parse(body);

                    if (!targetUserId || !action) {
                        sendJson(res, { error: 'Missing required fields: targetUserId, action' }, 400);
                        return;
                    }

                    const currentData = await loadRobuxFarmData(targetUserId);

                    let newData;
                    if (action === 'add') {
                        // Add robux to user
                        const addAmount = robuxEarned || 0;
                        newData = {
                            adsWatched: currentData.adsWatched,
                            earnings: currentData.earnings + (addAmount / ROBUX_PER_EURO),
                            robuxEarned: currentData.robuxEarned + addAmount
                        };
                        console.log(`[ADMIN] User ${session.userId} added ${addAmount} robux to user ${targetUserId}`);
                    } else if (action === 'set') {
                        // Set specific values
                        newData = {
                            adsWatched: adsWatched !== undefined ? adsWatched : currentData.adsWatched,
                            earnings: earnings !== undefined ? earnings : currentData.earnings,
                            robuxEarned: robuxEarned !== undefined ? robuxEarned : currentData.robuxEarned
                        };
                        console.log(`[ADMIN] User ${session.userId} set data for user ${targetUserId}:`, newData);
                    } else if (action === 'reset') {
                        // Reset user data
                        newData = {
                            adsWatched: 0,
                            earnings: 0,
                            robuxEarned: 0
                        };
                        console.log(`[ADMIN] User ${session.userId} reset data for user ${targetUserId}`);
                    } else {
                        sendJson(res, { error: 'Invalid action. Must be: add, set, or reset' }, 400);
                        return;
                    }

                    await saveRobuxFarmData(targetUserId, newData);

                    sendJson(res, {
                        success: true,
                        previousData: currentData,
                        newData: newData
                    });

                } catch (parseError) {
                    console.error('Parse error:', parseError);
                    sendJson(res, { error: 'Failed to process request' }, 500);
                }
            });

        } catch (error) {
            console.error('Admin robux farm error:', error);
            sendJson(res, { error: 'Failed to process request' }, 500);
        }

        return;
    }


    // =====================================================
    // ADMIN API - WARNING MANAGEMENT
    // =====================================================

    if (
        pathname === '/api/admin/warnings' &&
        req.method === 'POST'
    ) {

        if (!session) {
            sendJson(res, { error: 'Unauthorized' }, 401);
            return;
        }

        // Check if user is admin
        if (!isAdminUser(session.userId, session.username)) {
            sendJson(res, { error: 'Forbidden - Admin only' }, 403);
            return;
        }

        try {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const { targetUserId, action } = JSON.parse(body);

                    if (!targetUserId || !action) {
                        sendJson(res, { error: 'Missing required fields: targetUserId, action' }, 400);
                        return;
                    }

                    let result;
                    if (action === 'add') {
                        result = await addUserWarning(targetUserId);
                        console.log(`[ADMIN] User ${session.userId} added warning to user ${targetUserId}. New count: ${result.warningCount}`);
                    } else if (action === 'clear') {
                        await clearUserWarnings(targetUserId);
                        result = { warningCount: 0, banUntil: null, isPermanentlyBanned: false };
                        console.log(`[ADMIN] User ${session.userId} cleared warnings for user ${targetUserId}`);
                    } else {
                        sendJson(res, { error: 'Invalid action. Must be: add or clear' }, 400);
                        return;
                    }

                    const currentWarnings = await getUserWarnings(targetUserId);
                    const banStatus = await isUserBanned(targetUserId);

                    sendJson(res, {
                        success: true,
                        warnings: currentWarnings,
                        banStatus: banStatus
                    });

                } catch (parseError) {
                    console.error('Parse error:', parseError);
                    sendJson(res, { error: 'Failed to process request' }, 500);
                }
            });

        } catch (error) {
            console.error('Admin warnings error:', error);
            sendJson(res, { error: 'Failed to process request' }, 500);
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
                    const userData = await loadRobuxFarmData(session.userId);
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
                        session.userToken,
                        session.userId,
                        session.username,
                        psd,
                        gamepassId,
                        robuxAmount
                    );

                    // Deduct Robux from user balance
                    await saveRobuxFarmData(session.userId, {
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
        if (!isAdminUser(session.userId, session.username)) {
            sendJson(
                res,
                { error: 'Forbidden - Admin only' },
                403
            );
            return;
        }

        try {
            const withdrawals = getWithdrawals();
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
        if (!isAdminUser(session.userId, session.username)) {
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

                    updateWithdrawalStatus(withdrawalId, status);

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

        const isAdmin = isAdminUser(session.userId, session.username);

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

    res.end(
        '<h1>404 Not Found</h1>'
    );
});


// =========================================================
// START SERVER
// =========================================================

// Initialize database (async)
initDatabase().then(() => {
    server.listen(
        PORT,
        () => {
            console.log(
                'Quest Completer Web Dashboard running on http://localhost:' + PORT
            );
        }
    );
}).catch(error => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
});