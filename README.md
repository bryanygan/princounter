# Enhanced Princounter Bot

A comprehensive Discord.js bot that tracks and manages user points based on image posts in a designated channel, with advanced administration features and reward redemption system.

---

## Table of Contents
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
  - [Slash Commands](#slash-commands)
- [Permissions](#permissions)
- [Advanced Features](#advanced-features)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Core Functionality
- **📈 Point Tracking**: Automatically awards 1 point when a user posts an image in the target channel
- **💾 Persistent Storage**: Uses `quick.db` for reliable data storage and retrieval
- **🔄 Backfill Support**: Traverse message history to retroactively award points for past image posts
- **🎯 Smart Responses**: All sensitive command replies are ephemeral (hidden from other users)
- **🎭 Dynamic Status**: Rotating activity status with custom messages

### Advanced Points Management
- **👑 Administrative Override**: Set, add, or clear points for any user
- **🏆 Leaderboard System**: View top point earners with customizable limits
- **🎁 Reward Redemption**: Redeem points for rewards with automatic role assignment
- **📊 Comprehensive Statistics**: Track points across all users with detailed reporting
- **⚡ Bulk Operations**: Clear points for individual users or everyone at once

### Enhanced User Experience
- **🔍 Point Checking**: Users can check their own points, admins can check anyone's
- **📱 Real-time Updates**: Immediate point notifications when images are posted
- **🛡️ Permission-based Access**: Different command access levels for security
- **📈 Progress Tracking**: Visual progress updates during long operations

## Prerequisites
- **Node.js** v16.9.0 or higher
- **npm** (comes with Node.js)
- A Discord bot application with:
  - **Bot Token**
  - **Application (slash) commands** enabled
  - **Server administrator** permissions for setup

## Installation

### Quick Setup
```bash
# Clone this repository
git clone https://github.com/yourusername/enhanced-princounter.git
cd enhanced-princounter

# Install dependencies
npm install
```

### Manual Installation
If you prefer to set up manually:

```bash
# Create project directory
mkdir enhanced-princounter
cd enhanced-princounter

# Initialize npm project
npm init -y

# Install all required packages
npm install discord.js@^14.19.3 dotenv@^16.5.0 quick.db@^9.1.7 better-sqlite3@^11.9.1
```

### Troubleshooting Installation

**Windows users experiencing `better-sqlite3` errors:**
```bash
npm install --global windows-build-tools
npm install better-sqlite3
```

**macOS users:**
```bash
xcode-select --install
npm install better-sqlite3
```

**Linux (Ubuntu/Debian) users:**
```bash
sudo apt-get install build-essential
npm install better-sqlite3
```

## Configuration

Create a `.env` file in the project root with the following variables:

```bash
# Discord application and guild identifiers
CLIENT_ID=your_bot_application_id
GUILD_ID=your_test_or_production_guild_id

# The channel where images are tracked for points
CHANNEL_ID=target_discord_channel_id

# Your bot token
DISCORD_TOKEN=your_bot_token

# Optional: VIP role for reward redemption (defaults to hardcoded value)
VIP_ROLE_ID=1371247728646033550
```

### Environment Variables Explained

| Variable | Required | Description |
|----------|----------|-------------|
| `CLIENT_ID` | Yes* | Your Discord application ID (for command registration) |
| `GUILD_ID` | Yes* | Guild/server ID where commands will be registered |
| `CHANNEL_ID` | Yes | Channel ID where image posts earn points |
| `DISCORD_TOKEN` | Yes | Your bot's secret token |
| `VIP_ROLE_ID` | No | Role ID for "Perm Fee" reward (has default) |

*Required for automatic slash command registration. Bot will work without these but commands won't auto-register.

## Usage

### Starting the Bot
```bash
node princounter.js
```

**Expected startup output:**
```
✅ Successfully registered 7 slash commands
📊 Initialized points database
🚀 Logged in as YourBot#1234!
📍 Points channel: 1234567890123456789
🎯 VIP Role ID: 1371247728646033550
```

### How Points Are Earned
1. **📸 Post an image** in the configured channel
2. **🎉 Get instant notification** of points earned
3. **📈 Points accumulate** over time automatically

### Slash Commands

| Command | Permission Level | Description |
|---------|------------------|-------------|
| `/checkpoints` | Everyone | Show your current points (or others' with permission) |
| `/setpoints` | Administrator | Set a user's points to a specific value |
| `/addpoints` | Administrator | Add points to a user's current total |
| `/leaderboard` | Manage Guild | Display the top N users by points |
| `/backfill` | Manage Guild | Scan historical messages and award points |
| `/clearpoints` | Administrator | Reset points for a user or all users |
| `/redeem` | Administrator | Redeem points for rewards |

#### Detailed Command Usage

**Check Points:**
```bash
/checkpoints                    # Check your own points
/checkpoints user:@SomeUser     # Check another user's points (requires Manage Guild)
```

**Administrative Commands:**
```bash
/setpoints user:@User points:50         # Set user to exactly 50 points
/addpoints user:@User points:10         # Add 10 points to user's current total
/clearpoints user:@User                 # Clear specific user's points
/clearpoints                            # Clear ALL users' points
```

**Leaderboard:**
```bash
/leaderboard                    # Show top 10 users
/leaderboard limit:25           # Show top 25 users
```

**Backfill Historical Points:**
```bash
/backfill                       # Award points for all historical images
```

**Reward Redemption:**
```bash
/redeem user:@User reward:Free Order    # Redeem "Free Order" for user
/redeem user:@User reward:Perm Fee      # Redeem "Perm Fee" + assign VIP role
```

## Permissions

### Bot Permissions Required
The bot requires these permissions in your Discord server:

- **View Channel** - To see messages and channels
- **Read Message History** - For backfill functionality
- **Send Messages** - To send point notifications and responses
- **Use Slash Commands** - To register and respond to commands
- **Manage Roles** - To assign VIP role during "Perm Fee" redemption

### User Permission Levels

**Everyone:**
- Check their own points with `/checkpoints`
- Earn points by posting images

**Manage Guild Permission:**
- Check anyone's points
- View leaderboard
- Use backfill command

**Administrator Permission:**
- All Manage Guild permissions
- Set/add/clear points for users
- Redeem rewards for users

## Advanced Features

### Automatic Backfill with Progress
The `/backfill` command processes message history intelligently:
- **Progress Updates**: Shows progress every 500 messages
- **Detailed Results**: Reports both messages processed and points awarded
- **Rate Limiting**: Built-in delays to respect Discord's API limits
- **Permission Checking**: Verifies bot permissions before starting

### Reward System
Current rewards available:
- **Free Order** (10 points) - Deducts points only
- **Perm Fee** (10 points) - Deducts points + assigns VIP role

### Smart Leaderboard
- **Length Handling**: Automatically truncates long leaderboards
- **Flexible Limits**: Choose how many users to display
- **Proper Formatting**: Clean, readable output with user mentions

### Enhanced Error Handling
- **Graceful Failures**: Commands continue working even if subfeatures fail
- **Detailed Logging**: Console logs for debugging and monitoring
- **User-Friendly Messages**: Clear error messages for users

## Troubleshooting

### Common Issues

**Commands not appearing:**
- Verify `CLIENT_ID` and `GUILD_ID` are correct in `.env`
- Allow up to 1 hour for global commands, or use guild commands for instant sync
- Check bot has "applications.commands" scope

**No points awarded for images:**
- Verify `CHANNEL_ID` matches the channel where you post images
- Ensure bot has View Channel and Send Messages permissions
- Check that files are actual images (MIME type starts with `image/`)

**Backfill hangs or errors:**
- Verify bot has View Channel and Read Message History permissions
- Large channels may take time - progress updates show it's working
- Rate limits are respected automatically

**VIP role not assigned during redemption:**
- Check `VIP_ROLE_ID` in `.env` is correct
- Ensure bot has Manage Roles permission
- Verify the role exists and bot's role is higher in hierarchy

**Permission errors:**
- Bot role must be higher than roles it manages
- Check channel-specific permissions override server permissions
- Ensure bot was invited with correct permissions

### Database Issues

**Points not saving:**
- Check write permissions in bot directory
- Ensure `json.sqlite` file isn't corrupted
- Restart bot to reinitialize database

**Database corruption:**
- Delete `json.sqlite` file (⚠️ **this will lose all points data**)
- Restart bot to create fresh database
- Use backfill to restore points from message history

### Performance Optimization

**For large servers:**
- Use backfill during low-activity periods
- Consider limiting leaderboard size
- Monitor console for performance issues

**Memory usage:**
- Restart bot periodically for long-running instances
- Monitor console output for memory warnings
- Keep Node.js updated

## File Structure

```
enhanced-princounter/
├── princounter.js         # Main bot file
├── package.json          # Dependencies and scripts
├── package-lock.json     # Dependency lock file
├── .env                  # Environment variables (create this)
├── README.md            # This documentation
├── node_modules/        # Installed packages (auto-created)
└── json.sqlite         # Points database (auto-created)
```

## Migration from Old Princounter

If you're upgrading from a previous version:

1. **Backup your data:**
   ```bash
   cp json.sqlite json.sqlite.backup
   ```

2. **Update code:** Replace `princounter.js` with the enhanced version

3. **Install new dependencies:** Run `npm install`

4. **Update environment:** Add any new variables to `.env`

5. **Test functionality:** Start bot and verify commands work

## Contributing

We welcome contributions! Here's how to help:

### Development Setup
```bash
git clone https://github.com/yourusername/enhanced-princounter.git
cd enhanced-princounter
npm install
cp .env.example .env  # Create and configure your .env file
```

### Contribution Process
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/YourFeature`
3. Make your changes with clear commit messages
4. Test thoroughly with a development bot
5. Submit a Pull Request with detailed description

### Code Style
- Use consistent indentation (2 spaces)
- Add comments for complex logic
- Follow existing error handling patterns
- Update README for new features

## License

Licensed under the **MIT License**.

---

## Support

**Need help?**
- 📖 Check this README thoroughly
- 🐛 Search existing GitHub issues
- 💡 Create a new issue with detailed information
- 🤝 Join our Discord community for real-time help

**When reporting issues, include:**
- Node.js version (`node --version`)
- Bot startup logs
- Error messages (full stack trace)
- Steps to reproduce the problem
