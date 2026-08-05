import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

const STORE_FILE = 'tokens.json';
const ALGORITHM = 'aes-256-gcm';

function deriveKey(secret) {
    return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(text, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        data: encrypted.toString('hex'),
    });
}

function decrypt(stored, key) {
    try {
        const { iv, tag, data } = JSON.parse(stored);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        return decipher.update(Buffer.from(data, 'hex')) + decipher.final('utf8');
    } catch {
        return null;
    }
}

function loadStore() {
    try {
        return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveStore(store) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

export class TokenStore {
    constructor(secret) {
        this.key = deriveKey(secret);
    }

    save(userId, token) {
        const store = loadStore();
        store[userId] = encrypt(token, this.key);
        saveStore(store);
    }

    get(userId) {
        const store = loadStore();
        const raw = store[userId];
        if (!raw) return null;
        return decrypt(raw, this.key);
    }

    remove(userId) {
        const store = loadStore();
        if (!store[userId]) return false;
        delete store[userId];
        saveStore(store);
        return true;
    }

    has(userId) {
        const store = loadStore();
        return !!store[userId];
    }

    get size() {
        return Object.keys(loadStore()).length;
    }

    listUserIds() {
        return Object.keys(loadStore());
    }
}
