# Quest Completer V1

A Discord.js bot to manage and complete quests automatically. Now includes a web dashboard!

## Features

### Discord Bot Commands
| Command | Description |
|---|---|
| `/link` | Link your account so the bot can track and complete quests for you |
| `/quest` | Complete a single specific quest |
| `/questall` | Complete all available quests at once |
| `/autoquest` | Enable automatic quest completion in the background |

### Web Dashboard
- **Login with Discord Token**: Enter your Discord user token to connect
- **User Profile**: View your Discord profile with avatar
- **Quest Statistics**: See total quests, completed, and remaining
- **Progress Tracking**: Visual progress bar showing completion percentage
- **Complete Individual Quests**: Click to complete specific quests
- **Complete All**: One-click button to complete all remaining quests

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

## Running

### Discord Bot
```bash
node src/index.js
```

### Web Dashboard
```bash
node web-server.js
```

The web dashboard will be available at `http://localhost:3000`

## Notes

- Make sure your bot has the required Gateway Intents enabled from the Discord Developer Portal.
- Slash commands may take a few minutes to register/update globally.
- The web dashboard uses the same Discord token authentication as the bot
- For the web dashboard, you need your Discord **user token** (not bot token)

## Support

- **Support Server:** (removed)
- **Developer:** KiT2|.ggnoobies - Customised Developer { its2yashpatel_ } (Synora 乂 Development)

- **Support Server:** (removed)
- **Developer:** KiT2|.ggnoobies { its2yashpatel_ } (Synora 乂 Development)
"# Site" 
