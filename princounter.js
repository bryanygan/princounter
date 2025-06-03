require('dotenv').config();
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TARGET_CHANNEL_ID = process.env.CHANNEL_ID;
const VIP_ROLE_ID = process.env.VIP_ROLE_ID || '1371247728646033550';
const AUTO_ROLE_ID = '1350935336435449969'; // Role to give when posting images
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActivityType } = require('discord.js');

// Define slash command for point overrides
const setpointsCommand = new SlashCommandBuilder()
  .setName('setpoints')
  .setDescription('Override a user\'s points')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('The user to set points for')
      .setRequired(true))
  .addIntegerOption(option =>
    option.setName('points')
      .setDescription('Number of points to set')
      .setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// Define slash command for checking user's points
const checkpointsCommand = new SlashCommandBuilder()
  .setName('checkpoints')
  .setDescription('Show your current point total')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('Optional: user to check points for')
      .setRequired(false));

// Define slash command for showing the leaderboard - NOW PUBLIC!
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

// Define slash command for redeeming points
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
        { name: 'Perm Fee', value: 'Perm Fee' }
      ))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// Define slash command for adding points to a user
const addpointsCommand = new SlashCommandBuilder()
  .setName('addpoints')
  .setDescription('Add points to a user')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('The user to add points to')
      .setRequired(true))
  .addIntegerOption(option =>
    option.setName('points')
      .setDescription('Number of points to add')
      .setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// Initialize QuickDB
const { QuickDB } = require('quick.db');
const db = new QuickDB();

// IMPROVEMENT 1: Rate limiting and queue management
const userCooldowns = new Map(); // Track user cooldowns
const processingQueue = new Map(); // Track ongoing operations per user

// IMPROVEMENT 2: Enhanced database helper functions with better concurrency
async function getUserPoints(userId) {
  const allPoints = (await db.get('points')) || {};
  return allPoints[userId] || 0;
}

async function setUserPoints(userId, points) {
  // IMPROVEMENT 3: Prevent concurrent modifications per user
  const userKey = `points_${userId}`;
  
  // Wait if another operation is in progress for this user
  while (processingQueue.has(userKey)) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  processingQueue.set(userKey, true);
  
  try {
    const allPoints = (await db.get('points')) || {};
    allPoints[userId] = Math.max(0, points); // Ensure points can't go negative
    await db.set('points', allPoints);
    return allPoints[userId];
  } finally {
    processingQueue.delete(userKey);
  }
}

async function addUserPoints(userId, pointsToAdd) {
  // IMPROVEMENT 4: Atomic-like operation for adding points
  const userKey = `points_${userId}`;
  
  // Wait if another operation is in progress for this user
  while (processingQueue.has(userKey)) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  processingQueue.set(userKey, true);
  
  try {
    const allPoints = (await db.get('points')) || {};
    const currentPoints = allPoints[userId] || 0;
    const newPoints = currentPoints + pointsToAdd;
    allPoints[userId] = Math.max(0, newPoints);
    await db.set('points', allPoints);
    return allPoints[userId];
  } finally {
    processingQueue.delete(userKey);
  }
}

async function getLeaderboard(limit = 10) {
  const allPoints = (await db.get('points')) || {};
  return Object.entries(allPoints)
    .map(([userId, points]) => ({ userId, points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

async function clearAllPoints() {
  // IMPROVEMENT 5: Clear processing queue when clearing all points
  processingQueue.clear();
  await db.set('points', {});
}

// IMPROVEMENT 6: Enhanced rate limiting function
function isUserOnCooldown(userId, cooldownMs = 1000) {
  const now = Date.now();
  const lastAction = userCooldowns.get(userId);
  
  if (lastAction && (now - lastAction) < cooldownMs) {
    return true;
  }
  
  userCooldowns.set(userId, now);
  return false;
}

// Function to traverse channel history and increment points for image attachments
async function backfillChannelPoints(channel, interaction) {
  let lastId = null;
  let processed = 0;
  let pointsAwarded = 0;
  
  // IMPROVEMENT 7: Batch processing for better performance
  const batchSize = 50; // Reduced from 100 for better memory usage
  
  while (true) {
    const options = { limit: batchSize };
    if (lastId) options.before = lastId;
    
    const batch = await channel.messages.fetch(options);
    if (!batch.size) break;
    
    // IMPROVEMENT 8: Process messages in parallel with concurrency limit
    const messagePromises = [];
    const concurrencyLimit = 5; // Process max 5 messages at once
    
    for (const msg of batch.values()) {
      if (msg.author.bot) continue;
      
      // Check for image attachments
      const hasImages = msg.attachments.some(att => att.contentType?.startsWith('image/'));
      
      if (hasImages) {
        messagePromises.push(
          addUserPoints(msg.author.id, 1).then(() => {
            pointsAwarded++;
          }).catch(error => {
            console.error(`Failed to add points for user ${msg.author.id}:`, error);
          })
        );
        
        // Process in batches to avoid overwhelming the database
        if (messagePromises.length >= concurrencyLimit) {
          await Promise.allSettled(messagePromises.splice(0, concurrencyLimit));
        }
      }
    }
    
    // Process remaining promises
    if (messagePromises.length > 0) {
      await Promise.allSettled(messagePromises);
    }
    
    processed += batch.size;
    lastId = batch.last().id;
    
    // Update user with progress every 500 messages
    if (processed % 500 === 0) {
      try {
        await interaction.editReply(`Processing... ${processed} messages checked, ${pointsAwarded} points awarded`);
      } catch (error) {
        // Ignore interaction errors during progress updates
      }
    }
    
    // IMPROVEMENT 9: Shorter rate limiting for better responsiveness
    await new Promise(r => setTimeout(r, 200));
  }
  
  return { processed, pointsAwarded };
}

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
    const commands = [
      setpointsCommand.toJSON(),
      checkpointsCommand.toJSON(),
      leaderboardCommand.toJSON(),
      backfillCommand.toJSON(),
      clearpointsCommand.toJSON(),
      redeemCommand.toJSON(),
      addpointsCommand.toJSON()
    ];
    
    try {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );
      console.log(`✅ Successfully registered ${commands.length} slash commands`);
    } catch (error) {
      console.error('❌ Failed to register slash commands:', error);
    }
  } else {
    console.warn('⚠️ Skipping slash command registration: CLIENT_ID or GUILD_ID undefined.');
  }
  
  // Initialize points database if it doesn't exist
  const existing = await db.get('points');
  if (!existing) {
    await db.set('points', {});
    console.log('📊 Initialized points database');
  }
  
  // Rotate playing status
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
  
  console.log(`🚀 Logged in as ${client.user.tag}!`);
  console.log(`📍 Points channel: ${TARGET_CHANNEL_ID || 'Not configured'}`);
  console.log(`🎯 VIP Role ID: ${VIP_ROLE_ID}`);
  console.log(`🎭 Auto Role ID: ${AUTO_ROLE_ID}`);
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  
  // Only process messages in the specified channel
  if (!TARGET_CHANNEL_ID || message.channel.id !== TARGET_CHANNEL_ID) return;

  // IMPROVEMENT 10: Rate limiting for message processing
  if (isUserOnCooldown(message.author.id, 2000)) { // 2 second cooldown
    return; // Silently ignore rapid-fire messages
  }

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

    try {
      // IMPROVEMENT 11: Parallel processing of points and role assignment
      const pointsPromise = addUserPoints(userId, 1);
      const memberPromise = message.guild.members.fetch(userId);
      
      const [newPoints, guildMember] = await Promise.all([pointsPromise, memberPromise]);
      
      // Check if user needs the auto role
      const autoRole = message.guild.roles.cache.get(AUTO_ROLE_ID);
      
      let roleMessage = '';
      if (autoRole && !guildMember.roles.cache.has(AUTO_ROLE_ID)) {
        try {
          // Don't await role assignment to avoid blocking the response
          guildMember.roles.add(autoRole).then(() => {
            console.log(`🎭 ${username} (${userId}) was given the ${autoRole.name} role`);
          }).catch(roleError => {
            console.error(`Failed to add auto role to ${username}:`, roleError);
          });
          
          roleMessage = ` You've been given the ${autoRole.name} role! 🎭`;
        } catch (roleError) {
          console.error(`Failed to add auto role to ${username}:`, roleError);
        }
      }

      // Send reply
      const pointWord = newPoints === 1 ? 'point' : 'points';
      await message.reply(`🎉 <@${userId}> earned 1 point. They now have **${newPoints}** ${pointWord} total.${roleMessage}`);
      
      console.log(`📈 ${username} (${userId}) earned 1 point. Total: ${newPoints}`);
    } catch (error) {
      console.error('[Points] Failed to process points:', error);
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // IMPROVEMENT 12: Rate limiting for interactions
  if (isUserOnCooldown(`interaction_${interaction.user.id}`, 1000)) {
    return interaction.reply({ 
      content: '⏰ Please wait a moment before using another command.', 
      flags: MessageFlags.Ephemeral 
    });
  }

  try {
    switch (interaction.commandName) {
      case 'setpoints': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ 
            content: '❌ You do not have permission to use this command.', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const targetUser = interaction.options.getUser('user');
        const points = interaction.options.getInteger('points');
        
        await setUserPoints(targetUser.id, points);
        
        await interaction.reply({ 
          content: `🔧 Set <@${targetUser.id}>'s points to **${points}**.`, 
          flags: MessageFlags.Ephemeral 
        });
        break;
      }

      case 'addpoints': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ 
            content: '❌ You do not have permission to use this command.', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const targetUser = interaction.options.getUser('user');
        const pointsToAdd = interaction.options.getInteger('points');
        
        const newPoints = await addUserPoints(targetUser.id, pointsToAdd);
        
        await interaction.reply({ 
          content: `➕ Added **${pointsToAdd}** points to <@${targetUser.id}>. They now have **${newPoints}** points.`, 
          flags: MessageFlags.Ephemeral 
        });
        break;
      }

      case 'checkpoints': {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        
        if (targetUser.id !== interaction.user.id && 
            !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ 
            content: '❌ You do not have permission to check others\' points.', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const points = await getUserPoints(targetUser.id);
        const plural = points === 1 ? 'point' : 'points';
        const mention = targetUser.id === interaction.user.id ? 'You have' : `<@${targetUser.id}> has`;
        
        await interaction.reply({ 
          content: `${mention} **${points}** ${plural}.`, 
          flags: MessageFlags.Ephemeral 
        });
        break;
      }

      case 'leaderboard': {
        const limit = interaction.options.getInteger('limit') || 10;
        const entries = await getLeaderboard(limit);
        
        if (entries.length === 0) {
          return interaction.reply({ 
            content: 'No points have been recorded yet.', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const lines = entries.map((entry, index) => {
          const word = entry.points === 1 ? 'point' : 'points';
          return `${index + 1}. <@${entry.userId}> — ${entry.points} ${word}`;
        });
        
        // Check if message is too long for Discord (2000 char limit)
        const message = lines.join('\n');
        if (message.length > 1800) {
          // Create a shorter message for large leaderboards
          const shortLines = entries.slice(0, 10).map((entry, index) => {
            const word = entry.points === 1 ? 'point' : 'points';
            return `${index + 1}. <@${entry.userId}> — ${entry.points} ${word}`;
          });
          let shortMessage = shortLines.join('\n');
          if (entries.length > 10) {
            shortMessage += `\n... and ${entries.length - 10} more users`;
          }
          await interaction.reply({ content: shortMessage, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        }
        break;
      }

      case 'backfill': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ 
            content: '❌ You do not have permission to use this command.', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        if (!TARGET_CHANNEL_ID) {
          return interaction.reply({ 
            content: '❌ TARGET_CHANNEL_ID not configured.', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        const channel = client.channels.cache.get(TARGET_CHANNEL_ID);
        if (!channel || !channel.isTextBased?.()) {
          return interaction.followUp({ 
            content: '❌ Target channel not found or unsupported.', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        // Check bot permissions in target channel
        const perms = channel.permissionsFor(client.user);
        if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.ReadMessageHistory)) {
          return interaction.followUp({ 
            content: "❌ I need View Channel and Read Message History permissions to backfill this channel.", 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const result = await backfillChannelPoints(channel, interaction);
        
        await interaction.followUp({ 
          content: `✅ Processed **${result.processed}** messages and awarded **${result.pointsAwarded}** points.`, 
          flags: MessageFlags.Ephemeral 
        });
        break;
      }

      case 'clearpoints': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ 
            content: '❌ You do not have permission to clear points.', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const targetUser = interaction.options.getUser('user');
        
        if (targetUser) {
          await setUserPoints(targetUser.id, 0);
          await interaction.reply({ 
            content: `✅ Cleared points for <@${targetUser.id}>.`, 
            flags: MessageFlags.Ephemeral 
          });
        } else {
          await clearAllPoints();
          await interaction.reply({ 
            content: '✅ Cleared points for all users.', 
            flags: MessageFlags.Ephemeral 
          });
        }
        break;
      }

      case 'redeem': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ 
            content: '❌ You do not have permission to use this command.', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const targetUser = interaction.options.getUser('user');
        const reward = interaction.options.getString('reward');
        const userId = targetUser.id;
        
        const currentPoints = await getUserPoints(userId);
        
        if (currentPoints < 10) {
          return interaction.reply({ 
            content: `❌ <@${userId}> needs at least 10 points to redeem.`, 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const newPoints = await setUserPoints(userId, currentPoints - 10);

        let replyMessage = `🎉 <@${userId}> redeemed **${reward}**! They now have **${newPoints}** points.`;
        
        if (reward === 'Perm Fee') {
          try {
            const guildMember = await interaction.guild.members.fetch(userId);
            const vipRole = interaction.guild.roles.cache.get(VIP_ROLE_ID);
            
            if (vipRole) {
              await guildMember.roles.add(vipRole);
              replyMessage += ' They have been granted the VIP role! 🎖️';
            } else {
              replyMessage += ' (VIP role not found - check configuration)';
            }
          } catch (error) {
            replyMessage += ` (Failed to add VIP role: ${error.message})`;
          }
        }
        
        await interaction.reply(replyMessage);
        break;
      }

      default:
        break;
    }
  } catch (error) {
    console.error(`Error handling ${interaction.commandName} command:`, error);
    
    const errorMessage = '❌ An error occurred while processing your command.';
    
    if (interaction.deferred) {
      await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
    }
  }
});

// IMPROVEMENT 13: Enhanced error handling
client.on('error', error => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// IMPROVEMENT 14: Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  
  // Wait for ongoing operations to complete
  const maxWait = 5000; // 5 seconds
  const startTime = Date.now();
  
  while (processingQueue.size > 0 && (Date.now() - startTime) < maxWait) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  if (processingQueue.size > 0) {
    console.warn(`⚠️ ${processingQueue.size} operations still pending during shutdown`);
  }
  
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);