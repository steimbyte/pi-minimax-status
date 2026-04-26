# pi-minimax-status

Live MiniMax usage status bar for [pi coding agent](https://github.com/mariozechner/pi-coding-agent).

## Features

- **Live status bar** bottom-right with Unicode progress bars
- **Daily + Weekly usage tracking** (not just the 5-hour window)
- **Configurable hex colors** (amber/orange defaults)
- **Smart refresh** - only updates when session is active

## Quick Start

```bash
# Create config directory
mkdir -p ~/.config/pi-minimax-status

# Install plugin (symlink or copy to extensions folder)
ln -s /path/to/pi-minimax-status ~/.pi/agent/extensions/minimax-status

# Create config
cat > ~/.config/pi-minimax-status/config.json << 'EOF'
{
  "apiKey": "your-minimax-coding-api-key",
  "groupId": "your-group-id",
  "colors": {
    "bar": "#FFA500",
    "barWarning": "#FF8C00",
    "barDanger": "#FF4500",
    "text": "#FFB347",
    "bg": "#1a1a1a"
  }
}
EOF
```

Restart pi and the status bar will appear.

## Config Options

| Option | Default | Description |
|--------|---------|-------------|
| `apiKey` | - | MiniMax Coding Plan API Key |
| `groupId` | - | MiniMax Group ID |
| `colors.bar` | `#FFA500` | Bar color (normal) |
| `colors.barWarning` | `#FF8C00` | Bar color (>60% usage) |
| `colors.barDanger` | `#FF4500` | Bar color (>85% usage) |
| `colors.text` | `#FFB347` | Text color |
| `colors.bg` | `#1a1a1a` | Background color |
| `thresholds.warning` | `60` | Warning threshold % |
| `thresholds.danger` | `85` | Danger threshold % |
| `barLength` | `10` | Unicode bar width |
| `refreshInterval` | `60000` | Refresh interval (ms) |

## Tools

### minimax_config
Configure the plugin dynamically:
```
minimax_config apiKey="xxx" groupId="yyy" colorBar="#00FF00"
```

### minimax_refresh
Manually refresh usage data:
```
minimax_refresh
```

## Status Bar

```
[D:████████░░80%][W:██████░░░░60%]
```

- `D:` = Daily usage bar
- `W:` = Weekly usage bar
- Unicode `█` (filled) and `░` (empty) bars
- Color changes based on thresholds

## How It Works

1. Fetches 5-hour window data from MiniMax API
2. Records snapshots locally with timestamps
3. Calculates daily (last 24h) and weekly (last 7 days) totals
4. Displays bars in bottom-right status bar

## Find Your API Key & Group ID

1. Go to [platform.minimax.io](https://platform.minimax.io)
2. User Center → API Keys
3. Copy Coding Plan API Key and Group ID

## License

MIT
