# Discord Bot Setup (Hébergement séparé)

Le bot Discord est dans le fichier `discord-bot.js` et peut être hébergé séparément du serveur web.

## Installation des dépendances

```bash
npm install discord.js dotenv
```

## Configuration

1. Créez un fichier `.env` avec:
```
DISCORD_BOT_TOKEN=votre_token_bot_discord_ici
```

2. Lancez le bot:
```bash
node discord-bot.js
```

## Hébergement

Vous pouvez héberger ce bot sur:
- **Replit**: https://replit.com
- **Glitch**: https://glitch.com
- **Heroku**: https://heroku.com
- **Render**: https://render.com
- **Votre propre serveur**

## Commandes du Bot

- `!token` - Tutoriels pour obtenir le token Discord
- `!vouch` - Informations sur le système de vouch
- Détection automatique des problèmes de token

## Variables d'environnement requises

- `DISCORD_BOT_TOKEN`: Token de votre bot Discord (obtenu depuis https://discord.com/developers/applications)