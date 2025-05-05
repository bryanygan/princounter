require('dotenv').config();
const TARGET_CHANNEL_ID = process.env.CHANNEL_ID;
const { Client, GatewayIntentBits } = require('discord.js');
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

client.login(process.env.DISCORD_TOKEN);