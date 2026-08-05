// : ! Synora 乂 Development !
// + Discord: its2yashpatel_
// + Community: (removed) (Synora 乂 Development)
// + for any queries reach out Community or DM me.

import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const col = {
    reset:  '\x1b[0m',
    bright: '\x1b[1m',
    purple: '\x1b[35m',
    white:  '\x1b[97m',
    gray:   '\x1b[90m',
    green:  '\x1b[92m',
    cyan:   '\x1b[96m',
    red:    '\x1b[91m',
};

const tag  = `${col.purple}${col.bright}  [SlashCmds]${col.reset}`;
const line = `${col.purple}${col.bright}  ─────────────────────────────────────${col.reset}`;

export default async function deployCommands(token, clientId) {
    if (!token || !clientId) {
        console.log(`${tag} ${col.red}Missing TOKEN or CLIENT_ID — skipping slash command deploy.${col.reset}`);
        return;
    }

    const commands = [];
    const commandFiles = readdirSync(join(__dirname, '../commands')).filter(f => f.endsWith('.js'));

    for (const file of commandFiles) {
        const mod = await import(pathToFileURL(join(__dirname, '../commands', file)).href);
        // default export
        if (mod.default?.data) commands.push(mod.default.data.toJSON());
        // named exports (e.g. questCommands.js)
        for (const [key, val] of Object.entries(mod)) {
            if (key === 'default') continue;
            if (val?.data?.toJSON) commands.push(val.data.toJSON());
        }
    }

    console.log(line);
    console.log(`${tag} ${col.white}${col.bright}Registering slash commands...${col.reset}`);

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log(`${tag} ${col.green}  ✓ ${col.white}${commands.length} command(s) registered: ${col.gray}${commands.map(c => c.name).join(', ')}${col.reset}`);
    } catch (err) {
        console.log(`${tag} ${col.red}  ✗ Failed to register commands: ${err.message}${col.reset}`);
    }

    console.log(line);
}

// : ! Synora 乂 Development !
// + Discord: its2yashpatel_
// + Community: (removed) (Synora 乂 Development)
// + for any queries reach out Community or DM me.
