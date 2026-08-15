import { Constants } from './constants.js';
import { QuestManager } from './questManager.js';

const BASE_URL    = 'https://discord.com/api/v10';
const BASE_URL_V9 = 'https://discord.com/api/v9';
const RETRYABLE   = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 4;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

export class QuestClient {
    #token;
    questManager = null;

    constructor(userToken) {
        this.#token = userToken;
    }

    #buildHeaders() {
        return {
            'Authorization':      this.#token,
            'User-Agent':         Constants.USER_AGENT,
            'Content-Type':       'application/json',
            'accept-language':    'vi',
            'origin':             'https://discord.com',
            'pragma':             'no-cache',
            'priority':           'u=1, i',
            'referer':            'https://discord.com/channels/@me',
            'sec-ch-ua':          '"Not)A;Brand";v="8", "Chromium";v="138"',
            'sec-ch-ua-mobile':   '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest':     'empty',
            'sec-fetch-mode':     'cors',
            'sec-fetch-site':     'same-origin',
            'x-debug-options':    'bugReporterEnabled',
            'x-discord-locale':   'en-US',
            'x-discord-timezone': 'Asia/Saigon',
            'x-super-properties': Buffer.from(JSON.stringify(Constants.Properties)).toString('base64'),
        };
    }

    async #request(method, path, body, query) {
        const url = `${BASE_URL}${path}${query ? `?${query}` : ''}`;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            let res;
            try {
                res = await fetch(url, {
                    method,
                    headers: this.#buildHeaders(),
                    body: body !== undefined ? JSON.stringify(body) : undefined,
                });
            } catch (err) {
                if (attempt < MAX_RETRIES) { await sleep(2 ** attempt * 1000); continue; }
                throw new Error(`Network error on ${method} ${path}: ${err.message}`);
            }

            if (res.status === 429) {
                const retryAfter = Number(res.headers.get('retry-after') ?? 1) * 1000;
                await sleep(retryAfter);
                continue;
            }

            if (!res.ok) {
                if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES) {
                    await sleep(2 ** attempt * 1500);
                    continue;
                }
                const text = await res.text();
                throw new Error(`${res.status}: ${res.statusText} — ${text}`);
            }

            return res.json();
        }
        throw new Error(`Max retries exceeded for ${method} ${path}`);
    }

    async get(path, query) {
        return this.#request('GET', path, undefined, query);
    }

    async post(path, body) {
        return this.#request('POST', path, body);
    }

    async rawCall(method, path, body, base = 'v10') {
        const baseUrl = base === 'v9' ? BASE_URL_V9 : BASE_URL;
        try {
            const res = await fetch(`${baseUrl}${path}`, {
                method,
                headers: this.#buildHeaders(),
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
            return { status: res.status, text: await res.text() };
        } catch (err) {
            return { status: 0, text: err?.message ?? 'network error' };
        }
    }

    async fetchQuests() {
        const response = await this.get('/quests/@me');
        this.questManager = QuestManager.fromResponse(this, response);
        return this.questManager;
    }

    async fetchQuestsRaw() { return this.get('/quests/@me'); }
    async fetchUserRaw()   { return this.get('/users/@me'); }
}
