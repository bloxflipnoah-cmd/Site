# Quest Completer V1

A Discord.js bot to manage and complete quests automatically.

## Features / Commands

| Command | Description |
|---|---|
| `/link` | Link your account so the bot can track and complete quests for you |
| `/quest` | Complete a single specific quest |
| `/questall` | Complete all available quests at once |
| `/autoquest` | Enable automatic quest completion in the background |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | Yes | Your bot's token from the Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | Your application's client ID |
| `BOT_PREFIX` | No | Prefix for text commands (default: `,,`) |

Create a `.env` file in the root directory:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
BOT_PREFIX=,,
```

## Installation

```bash
npm install
```

Then start the bot:

```bash
node index.js
```

## Notes

- Make sure your bot has the required Gateway Intents enabled from the Discord Developer Portal.
- Slash commands may take a few minutes to register/update globally.

## Support

- **Support Server:** [dsc.gg/synoraxdev](https://dsc.gg/synoraxdev)
- **Developer:** KiT2|.ggnoobies - Customised Developer { its2yashpatel_ } (Synora 乂 Development)

- **Support Server:** [dsc.gg/synoraxdev](https://dsc.gg/synoraxdev)
- **Developer:** KiT2|.ggnoobies { its2yashpatel_ } (Synora 乂 Development)
