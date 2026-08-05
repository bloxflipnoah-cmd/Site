// : ! Synora 乂 Development !
// + Discord: its2yashpatel_
// + Community: (removed) (Synora 乂 Development)
// + for any queries reach out Community or DM me.

import { ActivityType } from 'discord.js';
import { PREFIX } from '../utils/config.js';
import { startAutoquestWatcher } from '../utils/autoquestWatcher.js';

const col = {
    reset:  '\x1b[0m',
    bright: '\x1b[1m',
    green:  '\x1b[92m',
    white:  '\x1b[97m',
    gray:   '\x1b[90m',
    purple: '\x1b[35m',
};

const line = `${col.purple}${col.bright}  ─────────────────────────────────────${col.reset}`;

export default {
    name: 'clientReady',
    once: true,
    async execute(client) {
        client.user.setPresence({
            activities: [{ name: `Quest Completer V1 | ${PREFIX}help`, type: ActivityType.Watching }],
            status: 'online',
        });

        console.log(line);
        console.log(`  ${col.green}${col.bright}✓ ${col.white}Logged in as ${col.green}${client.user.tag}${col.reset}`);
        console.log(`  ${col.green}${col.bright}✓ ${col.white}Serving ${col.green}${client.guilds.cache.size}${col.white} guild(s)${col.reset}`);
        console.log(line);

        startAutoquestWatcher(client);
    },
};

// : ! Synora 乂 Development !
// + Discord: its2yashpatel_
// + Community: (removed) (Synora 乂 Development)
// + for any queries reach out Community or DM me.
