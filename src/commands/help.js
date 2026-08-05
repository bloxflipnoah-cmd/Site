import {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    ThumbnailBuilder,
    MessageFlags,
} from 'discord.js';
import { getEmoji } from '../handlers/emoji.js';
import { PREFIX } from '../utils/config.js';

export default {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('See all available commands'),
    prefix: 'help',

    async execute(interaction) {
        await interaction.reply(buildHelp(interaction.user, interaction.client));
    },

    async prefixExecute(message, _a, client) {
        await message.reply(buildHelp(message.author, client));
    },
};

function buildHelp(user, client) {
    const avatar = user.displayAvatarURL({ size: 128, extension: 'png' });
    const botAvatar = client.user.displayAvatarURL({ size: 128, extension: 'png' });
    const c = new ContainerBuilder().setAccentColor(0x5865F2);

    // ── Header ──────────────────────────────────────────────────────────────
    c.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 🤖 Quest Bot\n-# Hey **${user.username}**, here's everything I can do`,
                ),
            )
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatar)),
    );

    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // ── Token Section ────────────────────────────────────────────────────────
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `🔗 **Token**\n` +
            `\`/link\`  \`${PREFIX}link\` — Link your Discord user token\n` +
            `\`/unlink\`  \`${PREFIX}unlink\` — Remove your saved token\n` +
            `\`/tokencheck\`  \`${PREFIX}tokencheck\` — Check if your token is still valid`,
        ),
    );

    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // ── Quest Section ────────────────────────────────────────────────────────
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `🎮 **Quests**\n` +
            `\`/quest\`  \`${PREFIX}quest\` — Pick and complete one quest\n` +
            `\`/questall\`  \`${PREFIX}questall\` — Complete all quests at once\n` +
            `\`/questlist\`  \`${PREFIX}questlist\` — View all your quests & status\n` +
            `\`/autoquest\`  \`${PREFIX}autoquest\` — Auto-complete new quests as they drop`,
        ),
    );

    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // ── Utility Section ──────────────────────────────────────────────────────
    c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `🛠️ **Utility**\n` +
            `\`/ping\`  \`${PREFIX}ping\` — Check bot latency\n` +
            `\`/help\`  \`${PREFIX}help\` — You're already here`,
        ),
    );

    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // ── Footer ───────────────────────────────────────────────────────────────
    c.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `-# 🌐 Serving **${client.guilds.cache.size}** server(s)  ·  Prefix: \`${PREFIX}\``,
                ),
            )
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)),
    );

    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}
