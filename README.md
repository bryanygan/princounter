# Counter Bot

A Discord.js bot that tracks and manages user points based on image posts in a designated channel.

---

## Table of Contents
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
  - [Slash Commands](#slash-commands)
- [Permissions](#permissions)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Features
- **Point Tracking**: Automatically awards 1 point when a user posts an image in the target channel.
- **Slash Commands**:
  - `/setpoints` – Administrator-only: override a user’s point total.
  - `/checkpoints` – View your current points, or check another user (with permission).
  - `/leaderboard` – View the top point earners in the server.
  - `/backfill` – Administrator-only: scan historical messages and award points for past image posts.
  - `/clearpoints` – Administrator-only: reset points for a user or all users.
- **Persistent Storage**: Uses `quick.db` for storing and retrieving point totals.
- **Backfill Support**: Traverse message history to retroactively award points.
- **Ephemeral Responses**: Sensitive command replies are hidden from other users.

## Prerequisites
- **Node.js** v16.9.0 or higher
- **npm** (comes with Node.js)
- A Discord bot application with:
  - **Bot Token**
  - **Application (slash) commands** enabled
  - **Server administrator** permissions for setup

## Installation
```bash
# Clone this repository
git clone https://github.com/bryanygan/princounter.git
cd princounter

# Install dependencies
npm install
```

## Configuration
Create a `.env` file in the project root with the following variables:
```bash
# Discord application and guild identifiers
CLIENT_ID=your_bot_application_id
GUILD_ID=your_test_or_production_guild_id

# The channel where images are tracked
CHANNEL_ID=target_discord_channel_id

# Your bot token
DISCORD_TOKEN=your_bot_token
```

Load environment variables at startup by requiring `dotenv`:
```js
require('dotenv').config();
```

## Usage
Run the bot:
```bash
node princounter.js
```

When the bot is online, it will:
1. Register the slash commands with Discord (if `CLIENT_ID` and `GUILD_ID` are set).
2. Listen for new messages in the configured `CHANNEL_ID` and award points for image attachments.
3. Respond to slash commands for point management and reporting.

### Slash Commands
| Command       | Description                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------- |
| `/setpoints`  | Override a user’s point total (requires Administrator permission).                           |
| `/checkpoints`| Show your points or another user’s (requires Manage Guild permission for others).            |
| `/leaderboard`| Display the top N users by points (default N=10, requires Manage Guild permission).         |
| `/backfill`   | Scan past messages for images and award points retroactively (requires Manage Guild).        |
| `/clearpoints`| Reset points for a specific user or all users (requires Administrator permission).           |

## Permissions
- The bot requires:
  - **View Channel**
  - **Read Message History**
  - **Send Messages**
  - **Manage Messages** (for slash command registration feedback)

Ensure the bot’s role has these permissions in your server and target channel.

## Troubleshooting
- **Commands not appearing**: Allow up to one hour for global slash commands, or register to a guild for immediate sync.
- **No points awarded**: Verify `CHANNEL_ID` matches the channel you post images in.
- **Backfill hangs or errors**: Check bot permissions (View Channel, Read Message History) and ensure rate limits are respected.

## Contributing
1. Fork the repo
2. Create a feature branch: `git checkout -b feature/YourFeature`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/YourFeature`
5. Open a Pull Request

## License
Licensed under the **MIT License**.
