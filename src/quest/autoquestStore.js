import * as fs from 'node:fs';
import * as path from 'node:path';

const AUTOQUEST_FILE = path.join(process.cwd(), 'autoquest.json');

function load() {
    try {
        const raw = JSON.parse(fs.readFileSync(AUTOQUEST_FILE, 'utf-8'));
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

function save(data) {
    fs.writeFileSync(AUTOQUEST_FILE, JSON.stringify(data, null, 2));
}

export function enableAutoquest(userId) {
    const data = load();
    if (data.includes(userId)) return false;
    data.push(userId);
    save(data);
    return true;
}

export function disableAutoquest(userId) {
    const data = load();
    const idx = data.indexOf(userId);
    if (idx === -1) return false;
    data.splice(idx, 1);
    save(data);
    return true;
}

export function isAutoquestEnabled(userId) {
    return load().includes(userId);
}

export function getAutoquestUsers() {
    return load();
}

export function getAutoquestUserCount() {
    return load().length;
}
