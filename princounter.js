require('dotenv').config();
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TARGET_CHANNEL_ID = process.env.CHANNEL_ID;
const VIP_ROLE_ID = process.env.VIP_ROLE_ID || '1371247728646033550';
const AUTO_ROLE_ID = '1350935336435449969'; // Role to give when posting images
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActivityType } = require('discord.js');
const crypto = require('crypto');

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
        { name: 'Free Fee Order', value: 'Free Fee Order' },
        { name: '$2 Fee Order', value: '$2 Fee Order' },
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

// Define slash command for image statistics
const imagestatsCommand = new SlashCommandBuilder()
  .setName('imagestats')
  .setDescription('Show statistics about posted images')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// Define slash command for scanning duplicates without adding points
const scandupesCommand = new SlashCommandBuilder()
  .setName('scandupes')
  .setDescription('Scan channel for duplicate images without affecting points')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// Define slash command for checking duplicates in recent messages
const checkdupesCommand = new SlashCommandBuilder()
  .setName('checkdupes')
  .setDescription('Check for duplicate images in recent messages')
  .addIntegerOption(option =>
    option.setName('limit')
      .setDescription('Number of messages to check (default 100, max 1000)')
      .setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// Define slash command for resetting duplicate tracking database
const resetdupesCommand = new SlashCommandBuilder()
  .setName('resetdupes')
  .setDescription('Reset the duplicate image tracking database')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// Initialize QuickDB
const { QuickDB } = require('quick.db');
const db = new QuickDB();

// Rate limiting and queue management
const userCooldowns = new Map();
const processingQueue = new Map();

// ==================== DUPLICATE DETECTION FUNCTIONS ====================

// Metadata-based hash (faster but less accurate)
function getImageMetadataHash(attachment) {
  const metadataString = `${attachment.size}-${attachment.width}x${attachment.height}-${attachment.name}`;
  return crypto.createHash('md5').update(metadataString).digest('hex');
}

// Database helper for duplicate detection
async function hasImageBeenVouched(imageHash) {
  const vouchedImages = (await db.get('vouchedImages')) || {};
  return vouchedImages[imageHash];
}

async function markImageAsVouched(imageHash, userId, messageId, imageUrl) {
  const vouchedImages = (await db.get('vouchedImages')) || {};
  vouchedImages[imageHash] = {
    userId,
    messageId,
    timestamp: Date.now(),
    firstPostUrl: imageUrl,
    postCount: (vouchedImages[imageHash]?.postCount || 0) + 1
  };
  await db.set('vouchedImages', vouchedImages);
}

// Function to scan channel and build duplicate database WITHOUT adding points
async function scanChannelForDuplicates(channel, interaction) {
  let lastId = null;
  let processed = 0;
  let uniqueImages = 0;
  let duplicatesFound = 0;
  let totalImages = 0;
  
  const batchSize = 50;
  
  // Temporary storage for this scan
  const tempImageDatabase = {};
  const duplicateUsers = new Set();
  
  while (true) {
    const options = { limit: batchSize };
    if (lastId) options.before = lastId;
    
    const batch = await channel.messages.fetch(options);
    if (!batch.size) break;
    
    for (const msg of batch.values()) {
      if (msg.author.bot) continue;
      
      const imageAttachments = msg.attachments.filter(att => att.contentType?.startsWith('image/'));
      
      if (imageAttachments.size > 0) {
        for (const [, attachment] of imageAttachments) {
          totalImages++;
          
          try {
            const imageHash = getImageMetadataHash(attachment);
            
            if (tempImageDatabase[imageHash]) {
              duplicatesFound++;
              duplicateUsers.add(msg.author.id);
              
              // Update post count
              tempImageDatabase[imageHash].postCount++;
              tempImageDatabase[imageHash].duplicatePosters.push({
                userId: msg.author.id,
                messageId: msg.id,
                timestamp: msg.createdTimestamp
              });
            } else {
              uniqueImages++;
              tempImageDatabase[imageHash] = {
                originalUserId: msg.author.id,
                originalMessageId: msg.id,
                firstPostTimestamp: msg.createdTimestamp,
                postCount: 1,
                duplicatePosters: []
              };
            }
          } catch (error) {
            console.error(`[ScanDupes] Error processing image hash:`, error);
          }
        }
      }
    }
    
    processed += batch.size;
    lastId = batch.last().id;
    
    // Update progress every 500 messages
    if (processed % 500 === 0) {
      try {
        await interaction.editReply(`Scanning... ${processed} messages checked, ${uniqueImages} unique images found, ${duplicatesFound} duplicates detected`);
      } catch (error) {
        // Ignore interaction errors during progress updates
      }
    }
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  // Now save the scan results to the database
  await db.set('vouchedImages', tempImageDatabase);
  
  return { 
    processed, 
    uniqueImages, 
    duplicatesFound, 
    totalImages,
    duplicateUsers: duplicateUsers.size,
    imageDatabase: tempImageDatabase
  };
}

// Function to check recent messages for duplicates
async function checkRecentDuplicates(channel, limit = 100) {
  const messages = await channel.messages.fetch({ limit: Math.min(limit, 1000) });
  const vouchedImages = (await db.get('vouchedImages')) || {};
  
  let duplicatesInRecent = [];
  let newImagesFound = 0;
  
  for (const msg of messages.values()) {
    if (msg.author.bot) continue;
    
    const imageAttachments = msg.attachments.filter(att => att.contentType?.startsWith('image/'));
    
    for (const [, attachment] of imageAttachments) {
      try {
        const imageHash = getImageMetadataHash(attachment);
        
        if (vouchedImages[imageHash]) {
          duplicatesInRecent.push({
            poster: msg.author.id,
            messageId: msg.id,
            originalPoster: vouchedImages[imageHash].originalUserId || vouchedImages[imageHash].userId,
            timestamp: msg.createdTimestamp
          });
        } else {
          newImagesFound++;
        }
      } catch (error) {
        console.error('Error checking image:', error);
      }
    }
  }
  
  return { duplicatesInRecent, newImagesFound, totalChecked: messages.size };
}

// ==================== ORIGINAL DATABASE FUNCTIONS ====================

async function getUserPoints(userId) {
  const allPoints = (await db.get('points')) || {};
  return allPoints[userId] || 0;
}

async function setUserPoints(userId, points) {
  const userKey = `points_${userId}`;
  
  while (processingQueue.has(userKey)) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  processingQueue.set(userKey, true);
  
  try {
    const allPoints = (await db.get('points')) || {};
    allPoints[userId] = Math.max(0, points);
    await db.set('points', allPoints);
    return allPoints[userId];
  } finally {
    processingQueue.delete(userKey);
  }
}

async function addUserPoints(userId, pointsToAdd) {
  const userKey = `points_${userId}`;
  
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
    return { previousPoints: currentPoints, newPoints: allPoints[userId] };
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

async function getTotalPoints() {
  const allPoints = (await db.get('points')) || {};
  return Object.values(allPoints).reduce((sum, points) => sum + points, 0);
}

async function clearAllPoints() {
  processingQueue.clear();
  await db.set('points', {});
}

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
  let duplicatesSkipped = 0;
  
  const batchSize = 50;
  
  while (true) {
    const options = { limit: batchSize };
    if (lastId) options.before = lastId;
    
    const batch = await channel.messages.fetch(options);
    if (!batch.size) break;
    
    const messagePromises = [];
    const concurrencyLimit = 5;
    
    for (const msg of batch.values()) {
      if (msg.author.bot) continue;
      
      // Check for image attachments with duplicate detection
      const imageAttachments = msg.attachments.filter(att => att.contentType?.startsWith('image/'));
      
      if (imageAttachments.size > 0) {
        // Check each image for duplicates BEFORE awarding points
        let newImagesCount = 0;
        
        for (const [, attachment] of imageAttachments) {
          try {
            const imageHash = getImageMetadataHash(attachment);
            const existingPost = await hasImageBeenVouched(imageHash);
            
            if (!existingPost) {
              // Mark as vouched immediately to prevent race conditions
              await markImageAsVouched(imageHash, msg.author.id, msg.id, attachment.url);
              newImagesCount++;
            } else {
              duplicatesSkipped++;
              console.log(`[Backfill] Skipped duplicate image from ${msg.author.username} (${msg.author.id})`);
            }
          } catch (error) {
            console.error(`[Backfill] Error processing image hash:`, error);
            // If we can't hash it, skip it to be safe
            duplicatesSkipped++;
          }
        }
        
        // Only add points if there were new images
        if (newImagesCount > 0) {
          messagePromises.push(
            addUserPoints(msg.author.id, newImagesCount).then(() => {
              pointsAwarded += newImagesCount;
            }).catch(error => {
              console.error(`[Backfill] Failed to add points for user ${msg.author.id}:`, error);
            })
          );
        }
        
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
        await interaction.editReply(`Processing... ${processed} messages checked, ${pointsAwarded} points awarded, ${duplicatesSkipped} duplicates skipped`);
      } catch (error) {
        // Ignore interaction errors during progress updates
      }
    }
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  return { processed, pointsAwarded, duplicatesSkipped };
}

// ==================== CLIENT SETUP ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

async function updateBotStatus() {
  try {
    const totalVouches = await getTotalPoints();
    
    const statuses = [
      { name: `70-80% off food!`, type: ActivityType.Playing },
      { name: `discord.gg/zreats`, type: ActivityType.Watching },
      { name: `Total Vouches: ${totalVouches}`, type: ActivityType.Watching }
    ];
    
    let statusIndex = 0;
    
    client.user.setPresence({
      activities: [statuses[statusIndex]],
      status: 'online'
    });
    
    setInterval(async () => {
      statusIndex = (statusIndex + 1) % statuses.length;
      
      if (statuses[statusIndex].name.startsWith('Total Vouches:')) {
        const currentTotal = await getTotalPoints();
        statuses[statusIndex].name = `Total Vouches: ${currentTotal}`;
      }
      
      client.user.setPresence({
        activities: [statuses[statusIndex]],
        status: 'online'
      });
    }, 15000);
    
  } catch (error) {
    console.error('Error updating bot status:', error);
  }
}

client.on('ready', async () => {
  if (CLIENT_ID && GUILD_ID) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const commands = [
      setpointsCommand.toJSON(),
      checkpointsCommand.toJSON(),
      leaderboardCommand.toJSON(),
      backfillCommand.toJSON(),
      clearpointsCommand.toJSON(),
      redeemCommand.toJSON(),
      addpointsCommand.toJSON(),
      imagestatsCommand.toJSON(),
      scandupesCommand.toJSON(),
      checkdupesCommand.toJSON(),
      resetdupesCommand.toJSON()
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
  
  const existing = await db.get('points');
  if (!existing) {
    await db.set('points', {});
    console.log('📊 Initialized points database');
  }
  
  const vouchedImages = await db.get('vouchedImages');
  if (!vouchedImages) {
    await db.set('vouchedImages', {});
    console.log('🖼️ Initialized image tracking database');
  }
  
  await updateBotStatus();
  
  console.log(`🚀 Logged in as ${client.user.tag}!`);
  console.log(`📍 Points channel: ${TARGET_CHANNEL_ID || 'Not configured'}`);
  console.log(`🎯 VIP Role ID: ${VIP_ROLE_ID}`);
  console.log(`🎭 Auto Role ID: ${AUTO_ROLE_ID}`);
  
  const totalVouches = await getTotalPoints();
  const totalImages = Object.keys((await db.get('vouchedImages')) || {}).length;
  console.log(`📊 Current total vouches: ${totalVouches}`);
  console.log(`🖼️ Unique images tracked: ${totalImages}`);
});

// ==================== MESSAGE CREATE WITH DUPLICATE DETECTION ====================

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  
  if (!TARGET_CHANNEL_ID || message.channel.id !== TARGET_CHANNEL_ID) return;

  if (isUserOnCooldown(message.author.id, 2000)) {
    return;
  }

  const channelPerms = message.channel.permissionsFor(client.user);
  if (!channelPerms?.has(PermissionFlagsBits.SendMessages)) {
    console.error(`[Points] Missing SendMessages permission in channel ${message.channel.id}`);
    return;
  }

  const imageAttachments = message.attachments.filter(attachment =>
    attachment.contentType?.startsWith('image/')
  );

  if (imageAttachments.size > 0) {
    const userId = message.author.id;
    const username = message.author.username;
    
    let duplicateImages = [];
    let newImages = [];
    
    // Check each image for duplicates BEFORE awarding any points
    for (const [, attachment] of imageAttachments) {
      try {
        const imageHash = getImageMetadataHash(attachment);
        const existingPost = await hasImageBeenVouched(imageHash);
        
        if (existingPost) {
          duplicateImages.push({
            hash: imageHash,
            originalPoster: existingPost.originalUserId || existingPost.userId,
            originalMessageId: existingPost.originalMessageId || existingPost.messageId
          });
          console.log(`🚫 Duplicate image detected from ${username} (${userId}). Original poster: ${existingPost.originalUserId || existingPost.userId}`);
        } else {
          newImages.push({
            hash: imageHash,
            url: attachment.url,
            attachment: attachment
          });
        }
      } catch (error) {
        console.error('Error processing image for duplicate detection:', error);
        // If we can't hash it, treat it as new to avoid blocking users
        newImages.push({
          hash: `fallback-${Date.now()}-${Math.random()}`,
          url: attachment.url,
          attachment: attachment
        });
      }
    }
    
    // Only proceed if there are new images
    if (newImages.length > 0) {
      try {
        // Mark all new images as vouched BEFORE adding points
        for (const newImage of newImages) {
          await markImageAsVouched(newImage.hash, userId, message.id, newImage.url);
        }
        
        // Now add points
        const pointsResult = await addUserPoints(userId, newImages.length);
        const memberPromise = message.guild.members.fetch(userId);
        
        const [guildMember] = await Promise.all([memberPromise]);
        const { previousPoints, newPoints } = pointsResult;
        
        // Auto role assignment
        const autoRole = message.guild.roles.cache.get(AUTO_ROLE_ID);
        let roleMessage = '';
        
        if (autoRole && !guildMember.roles.cache.has(AUTO_ROLE_ID)) {
          try {
            await guildMember.roles.add(autoRole);
            roleMessage = ` You've been given the ${autoRole.name} role! 🎭`;
            console.log(`🎭 ${username} (${userId}) was given the ${autoRole.name} role`);
          } catch (roleError) {
            console.error(`Failed to add auto role to ${username}:`, roleError);
          }
        }

        // Redemption message
        let redemptionMessage = '';
        if (previousPoints < 10 && newPoints >= 10) {
          redemptionMessage = '\n\n🎁 You now have enough points to redeem a prize! Check out your options here: https://discord.com/channels/1350935336435449967/1350935336435449973/1369303402705846414';
        }

        // Build response message
        const pointWord = newImages.length === 1 ? 'point' : 'points';
        const totalPointWord = newPoints === 1 ? 'point' : 'points';
        
        let replyMessage = `🎉 <@${userId}> earned ${newImages.length} ${pointWord}. They now have **${newPoints}** ${totalPointWord} total.${roleMessage}${redemptionMessage}`;
        
        // Add duplicate warning if applicable
        if (duplicateImages.length > 0) {
          const duplicateWord = duplicateImages.length === 1 ? 'image has' : 'images have';
          replyMessage += `\n⚠️ ${duplicateImages.length} ${duplicateWord} already been posted and didn't earn points.`;
          
          if (duplicateImages.length === 1) {
            replyMessage += ` (Originally posted by <@${duplicateImages[0].originalPoster}>)`;
          }
        }

        await message.reply(replyMessage);
        console.log(`📈 ${username} (${userId}) earned ${newImages.length} points. Total: ${newPoints}`);
        
      } catch (error) {
        console.error('[Points] Failed to process points:', error);
        // If something went wrong, remove the vouch marks for the new images
        const vouchedImages = (await db.get('vouchedImages')) || {};
        for (const newImage of newImages) {
          delete vouchedImages[newImage.hash];
        }
        await db.set('vouchedImages', vouchedImages);
      }
    } else {
      // All images were duplicates
      let replyMessage = `⚠️ <@${userId}>, `;
      
      if (duplicateImages.length === 1) {
        replyMessage += `this image has already been posted by <@${duplicateImages[0].originalPoster}>. No points earned.`;
      } else {
        replyMessage += `all ${duplicateImages.length} images have already been posted. No points earned.`;
      }
      
      await message.reply(replyMessage);
    }
  }
});

// ==================== INTERACTION HANDLERS ====================

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

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
        
        const pointsResult = await addUserPoints(targetUser.id, pointsToAdd);
        const newPoints = pointsResult.newPoints;
        
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
        
        const message = lines.join('\n');
        if (message.length > 1800) {
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
        
        const perms = channel.permissionsFor(client.user);
        if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.ReadMessageHistory)) {
          return interaction.followUp({ 
            content: "❌ I need View Channel and Read Message History permissions to backfill this channel.", 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const result = await backfillChannelPoints(channel, interaction);
        
        await interaction.followUp({ 
          content: `✅ Backfill complete!\n📊 **${result.processed}** messages processed\n🎯 **${result.pointsAwarded}** points awarded\n🚫 **${result.duplicatesSkipped}** duplicate images skipped`, 
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

      case 'imagestats': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ 
            content: '❌ You do not have permission to use this command.', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const vouchedImages = (await db.get('vouchedImages')) || {};
        const totalUniqueImages = Object.keys(vouchedImages).length;
        
        let totalReposts = 0;
        for (const data of Object.values(vouchedImages)) {
          if (data.postCount > 1) {
            totalReposts += data.postCount - 1;
          }
        }
        
        const repostedImages = Object.entries(vouchedImages)
          .filter(([, data]) => data.postCount > 1)
          .sort(([, a], [, b]) => b.postCount - a.postCount)
          .slice(0, 5);
        
        let statsMessage = `📊 **Image Statistics**\n\n`;
        statsMessage += `Unique images posted: **${totalUniqueImages}**\n`;
        statsMessage += `Duplicate attempts blocked: **${totalReposts}**\n`;
        
        if (repostedImages.length > 0) {
          statsMessage += `\n**Most Reposted Images:**\n`;
          repostedImages.forEach(([hash, data], index) => {
            const originalPoster = data.originalUserId || data.userId;
            statsMessage += `${index + 1}. Posted ${data.postCount} times (first by <@${originalPoster}>)\n`;
          });
        }
        
        await interaction.reply({ 
          content: statsMessage, 
          flags: MessageFlags.Ephemeral 
        });
        break;
      }

      case 'scandupes': {
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
        
        const perms = channel.permissionsFor(client.user);
        if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.ReadMessageHistory)) {
          return interaction.followUp({ 
            content: "❌ I need View Channel and Read Message History permissions to scan this channel.", 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const result = await scanChannelForDuplicates(channel, interaction);
        
        // Find the most duplicated images
        const mostDuplicated = Object.entries(result.imageDatabase)
          .filter(([, data]) => data.postCount > 1)
          .sort(([, a], [, b]) => b.postCount - a.postCount)
          .slice(0, 5);
        
        let responseMessage = `✅ **Duplicate Scan Complete!**\n\n`;
        responseMessage += `📊 **Statistics:**\n`;
        responseMessage += `• Messages scanned: **${result.processed}**\n`;
        responseMessage += `• Total images found: **${result.totalImages}**\n`;
        responseMessage += `• Unique images: **${result.uniqueImages}**\n`;
        responseMessage += `• Duplicate images: **${result.duplicatesFound}**\n`;
        responseMessage += `• Users who posted duplicates: **${result.duplicateUsers}**\n`;
        
        if (mostDuplicated.length > 0) {
          responseMessage += `\n**Most Duplicated Images:**\n`;
          mostDuplicated.forEach(([hash, data], index) => {
            responseMessage += `${index + 1}. Posted **${data.postCount}** times (first by <@${data.originalUserId}>)\n`;
          });
        }
        
        responseMessage += `\n*Duplicate database has been updated. New posts will now be checked against this data.*`;
        
        await interaction.followUp({ 
          content: responseMessage, 
          flags: MessageFlags.Ephemeral 
        });
        break;
      }

      case 'checkdupes': {
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
        
        const limit = interaction.options.getInteger('limit') || 100;
        
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        const channel = client.channels.cache.get(TARGET_CHANNEL_ID);
        if (!channel || !channel.isTextBased?.()) {
          return interaction.followUp({ 
            content: '❌ Target channel not found or unsupported.', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const result = await checkRecentDuplicates(channel, limit);
        
        let responseMessage = `🔍 **Recent Duplicates Check**\n\n`;
        responseMessage += `Checked last **${result.totalChecked}** messages\n`;
        responseMessage += `Found **${result.duplicatesInRecent.length}** duplicate images\n`;
        responseMessage += `Found **${result.newImagesFound}** new images not in database\n\n`;
        
        if (result.duplicatesInRecent.length > 0) {
          responseMessage += `**Recent Duplicates:**\n`;
          const recentDupes = result.duplicatesInRecent.slice(0, 10);
          
          for (const dupe of recentDupes) {
            const timestamp = new Date(dupe.timestamp).toLocaleDateString();
            responseMessage += `• <@${dupe.poster}> posted duplicate on ${timestamp} (original by <@${dupe.originalPoster}>)\n`;
          }
          
          if (result.duplicatesInRecent.length > 10) {
            responseMessage += `*... and ${result.duplicatesInRecent.length - 10} more duplicates*\n`;
          }
        } else {
          responseMessage += `✅ No duplicates found in recent messages!\n`;
        }
        
        if (result.newImagesFound > 0) {
          responseMessage += `\n💡 *Run \`/scandupes\` to add the ${result.newImagesFound} new images to the duplicate checking database.*`;
        }
        
        await interaction.followUp({ 
          content: responseMessage, 
          flags: MessageFlags.Ephemeral 
        });
        break;
      }

      case 'resetdupes': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ 
            content: '❌ You do not have permission to use this command.', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        // Clear the vouched images database
        await db.set('vouchedImages', {});
        
        await interaction.reply({ 
          content: '🔄 **Duplicate tracking database has been reset!**\n\nAll image history has been cleared. Run `/scandupes` to rebuild the database from existing messages.', 
          flags: MessageFlags.Ephemeral 
        });
        
        console.log('🔄 Duplicate tracking database reset by', interaction.user.tag);
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

// Error handling
client.on('error', error => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  
  const maxWait = 5000;
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