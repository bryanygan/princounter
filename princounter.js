require('dotenv').config();
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TARGET_CHANNEL_ID = process.env.CHANNEL_ID;
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

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
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
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
      { body: [setpointsCommand.toJSON(), checkpointsCommand.toJSON(), leaderboardCommand.toJSON()] }
    );
  } else {
    console.warn('Skipping slash registration: CLIENT_ID or GUILD_ID undefined.');
  }
  const existing = await db.get('points');
  if (!existing) {
    await db.set('points', {});
  }
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  // Only process messages in the specified channel
  if (message.channel.id !== TARGET_CHANNEL_ID) return;

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
    await message.reply(`🎉 <@${userId}> earned 1 point. They now have **${newPoints}** ${pointWord} total.`);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'setpoints') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
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
});

client.login(process.env.DISCORD_TOKEN);