require('dotenv').config();
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TARGET_CHANNEL_ID = process.env.CHANNEL_ID;
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActivityType } = require('discord.js');

// Define slash command for point overrides
const setpointsCommand = new SlashCommandBuilder()
  .setName('setpoints')
  .setDescription('Override a user’s points')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('The user to set points for')
      .setRequired(true))
  .addIntegerOption(option =>
    option.setName('points')
      .setDescription('Number of points to set')
      .setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
// Define slash command for checking user’s points
const checkpointsCommand = new SlashCommandBuilder()
  .setName('checkpoints')
  .setDescription('Show your current point total')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('Optional: user to check points for')
      .setRequired(false));

// Define slash command for showing the leaderboard
const leaderboardCommand = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Show top point earners')
  .addIntegerOption(option =>
    option.setName('limit')
      .setDescription('Number of users to display (default 10)')
      .setRequired(false));

// Define slash command for backfilling points from message history
const backfillCommand = new SlashCommandBuilder()
  .setName('backfill')
  .setDescription('Backfill points from existing messages in the channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// Define slash command for clearing points
const clearpointsCommand = new SlashCommandBuilder()
  .setName('clearpoints')
  .setDescription('Clear points for a user or all users')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('Optional: user to clear points for')
      .setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const redeemCommand = new SlashCommandBuilder()
  .setName('redeem')
  .setDescription('Redeem points for a reward')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('The user to redeem points for')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('reward')
      .setDescription('Reward to redeem')
      .setRequired(true)
      .addChoices(
        { name: 'Free Order', value: 'Free Order' },
        { name: 'Perm Fee',    value: 'Perm Fee'   }
      ))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// Function to traverse channel history and increment points for image attachments
async function backfillChannelPoints(channel) {
  let lastId = null;
  let processed = 0;
  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    const batch = await channel.messages.fetch(options);
    if (!batch.size) break;
    for (const msg of batch.values()) {
      if (msg.attachments.some(att => att.contentType?.startsWith('image/'))) {
        const uid = msg.author.id;
        const cur = (await db.get(`points.${uid}`)) || 0;
        await db.set(`points.${uid}`, cur + 1);
      }
    }
    processed += batch.size;
    lastId = batch.last().id;
    // avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }
  return processed;
}

const { QuickDB } = require('quick.db');
const db = new QuickDB();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('ready', async () => {
  // Register slash commands if IDs are set
  if (CLIENT_ID && GUILD_ID) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: [setpointsCommand.toJSON(), checkpointsCommand.toJSON(), leaderboardCommand.toJSON(), backfillCommand.toJSON(), clearpointsCommand.toJSON(), redeemCommand.toJSON()] }
    );
  } else {
    console.warn('Skipping slash registration: CLIENT_ID or GUILD_ID undefined.');
  }
  const existing = await db.get('points');
  if (!existing) {
    await db.set('points', {});
  }
  // rotate playing status
  const statuses = [
    { name: `70-80% off food!`, type: ActivityType.Playing },
    { name: `discord.gg/zreats`, type: ActivityType.Watching },
    { name: `Cheap food here!`, type: ActivityType.Listening },
    { name: `Make a ticket!`, type: ActivityType.Competing },
    { name: `Enjoy fast delivery!`, type: ActivityType.Playing },
    { name: `prin was here`, type: ActivityType.Watching }
  ];
  let statusIndex = 0;
  setInterval(() => {
    client.user.setPresence({
      activities: [statuses[statusIndex]],
      status: 'online'
    });
    statusIndex = (statusIndex + 1) % statuses.length;
  }, 15000);
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  // Only process messages in the specified channel
  if (message.channel.id !== TARGET_CHANNEL_ID) return;

  // Check bot send-message permission
  const channelPerms = message.channel.permissionsFor(client.user);
  if (!channelPerms?.has(PermissionFlagsBits.SendMessages)) {
    console.error(`[Points] Missing SendMessages permission in channel ${message.channel.id}`);
    return;
  }

  // Check for image attachments
  const imageAttachments = message.attachments.filter(attachment =>
    attachment.contentType?.startsWith('image/')
  );

  if (imageAttachments.size > 0) {
    const userId = message.author.id;
    const username = message.author.username;

    // Get current points from database
    const currentPoints = (await db.get(`points.${userId}`)) || 0;
    const newPoints = currentPoints + 1;

    // Update database
    await db.set(`points.${userId}`, newPoints);

    // Send reply
    const pointWord = newPoints === 1 ? 'point' : 'points';
    try {
      await message.reply(`🎉 <@${userId}> earned 1 point. They now have **${newPoints}** ${pointWord} total.`);
    } catch (err) {
      console.error('[Points] Failed to send reply:', err);
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'setpoints') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
    }
    const targetUser = interaction.options.getUser('user');
    const overridePoints = interaction.options.getInteger('points');
    await db.set(`points.${targetUser.id}`, overridePoints);
    await interaction.reply({ content: `🔧 Set <@${targetUser.id}>'s points to **${overridePoints}**.`, flags: MessageFlags.Ephemeral });
  }
  if (interaction.commandName === 'checkpoints') {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    if (targetUser.id !== interaction.user.id && 
        !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ You do not have permission to check others’ points.', flags: MessageFlags.Ephemeral });
    }
    const points = (await db.get(`points.${targetUser.id}`)) || 0;
    const plural = points === 1 ? 'point' : 'points';
    const mention = targetUser.id === interaction.user.id ? 'You have' : `<@${targetUser.id}> has`;
    await interaction.reply({ content: `${mention} **${points}** ${plural}.`, flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === 'leaderboard') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ You do not have permission to view the leaderboard.', flags: MessageFlags.Ephemeral });
    }
    const limit = interaction.options.getInteger('limit') || 10;
    const allPoints = (await db.get('points')) || {};
    const entries = Object.entries(allPoints)
      .map(([id, pts]) => ({ id, pts }))
      .sort((a, b) => b.pts - a.pts)
      .slice(0, limit);
    if (entries.length === 0) {
      return interaction.reply({ content: 'No points have been recorded yet.', flags: MessageFlags.Ephemeral });
    }
    const lines = entries.map((e, i) => {
      const word = e.pts === 1 ? 'point' : 'points';
      return `${i + 1}. <@${e.id}> — ${e.pts} ${word}`;
    });
    await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === 'backfill') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = client.channels.cache.get(TARGET_CHANNEL_ID);
    if (!channel || !channel.isTextBased?.()) {
      return interaction.followUp({ content: '❌ Target channel not found or unsupported.', flags: MessageFlags.Ephemeral });
    }
    // Check bot permissions in target channel
    const perms = channel.permissionsFor(client.user);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.ReadMessageHistory)) {
      return interaction.followUp({ content: "❌ I need View Channel and Read Message History permissions to backfill this channel.", flags: MessageFlags.Ephemeral });
    }
    const total = await backfillChannelPoints(channel);
    await interaction.followUp({ content: `✅ Processed **${total}** messages and updated points.`, flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === 'clearpoints') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ You do not have permission to clear points.', flags: MessageFlags.Ephemeral });
    }
    const targetUser = interaction.options.getUser('user');
    if (targetUser) {
      await db.set(`points.${targetUser.id}`, 0);
      return interaction.reply({ content: `✅ Cleared points for <@${targetUser.id}>.`, flags: MessageFlags.Ephemeral });
    } else {
      await db.set('points', {});
      return interaction.reply({ content: '✅ Cleared points for all users.', flags: MessageFlags.Ephemeral });
    }
  }

  if (interaction.commandName === 'redeem') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
    }
    const targetUser = interaction.options.getUser('user');
    const reward = interaction.options.getString('reward');
    const userId = targetUser.id;
    const currentPoints = (await db.get(`points.${userId}`)) || 0;
    if (currentPoints < 10) {
      return interaction.reply({ content: `❌ <@${userId}> needs at least 10 points to redeem.`, flags: MessageFlags.Ephemeral });
    }
    const newPoints = currentPoints - 10;
    await db.set(`points.${userId}`, newPoints);

    let replyMessage = `✅ Redeemed **${reward}** for <@${userId}>. They now have **${newPoints}** points.`;
    if (reward === 'Perm Fee') {
      const guildMember = await interaction.guild.members.fetch(userId);
      await guildMember.roles.add('1371247728646033550');
      replyMessage += ' They have been granted the VIP role.';
    }
    return interaction.reply({ content: replyMessage, flags: MessageFlags.Ephemeral });
  }
});

client.login(process.env.DISCORD_TOKEN);