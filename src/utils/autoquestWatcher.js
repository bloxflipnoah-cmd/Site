import { getAutoquestUsers } from '../quest/autoquestStore.js';
import { runAutoquestForUser } from '../commands/questCommands.js';
import { QuestClient } from '../quest/questClient.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes
const completedQuestIds = new Set(); // track already-processed quest IDs globally

export function startAutoquestWatcher(client) {
    console.log('  \x1b[92m●\x1b[0m \x1b[97mAutoquest watcher started\x1b[0m');

    setInterval(async () => {
        const users = getAutoquestUsers();
        if (users.length === 0) return;

        for (const userId of users) {
            try {
                const token = client.tokenStore.get(userId);
                if (!token) continue;

                const qc = new QuestClient(token);
                const manager = await qc.fetchQuests();
                const valid = manager.filterQuestsValid();

                for (const quest of valid) {
                    const key = `${userId}:${quest.id}`;
                    if (completedQuestIds.has(key)) continue;
                    completedQuestIds.add(key);
                    // run in background, don't await to avoid blocking other users
                    runAutoquestForUser(userId, quest, client.tokenStore, client).catch(() => {});
                }
            } catch {
                // silently skip — token may be expired, handled inside runAutoquestForUser
            }
        }
    }, POLL_INTERVAL_MS);
}
