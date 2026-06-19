# luci-app-dashboard

[![OpenWrt](https://img.shields.io/badge/OpenWrt-24.10%2B-blue?style=flat-square)](https://openwrt.org)
[![LuCI](https://img.shields.io/badge/LuCI-Compatible-green?style=flat-square)](https://github.com/openwrt/luci)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

A modern, real-time system monitoring dashboard for OpenWrt LuCI with integrated vnStat database backup management.

## Features

- **Real-time System Metrics** — CPU load, temperature, memory usage, and network counters with configurable cache TTLs
- **Network Monitoring** — WAN status, PPPoE uptime, public IP/ISP info, ping RTT with history chart
- **Wi-Fi Client Tracking** — Connected Wi-Fi clients, LAN port status, and RAM usage
- **vnStat Integration** — Daily/monthly traffic statistics with per-interface breakdown
- **Adblock Status** — Live adblock service monitoring and statistics
- **vnStat DB Backup** — Automated 12-hour scheduled backups of vnStat database to persistent flash storage
- **Responsive UI** — Modern dashboard interface with toggleable cards, accessible design, and mobile-friendly layout
- **CLI Commands** — Global `vnstat_backup` and `vnstat_restore` commands accessible from SSH or cron

## Screenshots

> *Dashboard main view showing real-time system and network metrics*

## Requirements

### Runtime Dependencies

| Package | Required | Notes |
|---------|----------|-------|
| `luci-base` | Yes | LuCI framework |
| `lua` | Yes | Lua runtime |
| `luci-compat` | Yes | Compatibility layer |
| `curl` | Yes | HTTP client for IP/ISP lookups |
| `vnstat2` | No | Enables traffic statistics |
| `adblock` | No | Enables adblock status card |

### Build Requirements

- OpenWrt SDK with LuCI support
- `luac` (bundled with SDK)

## Installation

### From Source (OpenWrt SDK)

```bash
git clone https://github.com/yourusername/luci-app-dashboard.git
cp -r luci-app-dashboard /path/to/openwrt-sdk/package/
cd /path/to/openwrt-sdk
make package/luci-app-dashboard/compile
```

The compiled `.ipk` or `.apk` will be in `bin/packages/`.

### On Device

```bash
opkg install luci-app-dashboard_1.0.0-1_all.ipk
```

The service auto-enables and starts on install.

## Configuration

Edit `/etc/config/dashboard`:

```
config dashboard 'settings'
    option vnstat   '1'     # Show vnStat traffic card (0/1)
    option adblock  '1'     # Show Adblock status card (0/1)
    option vnstat_db '0'    # Enable automatic vnStat DB backups (0/1)
```

Apply changes:

```bash
/etc/init.d/dashboard restart
```

## Usage

### Web Interface

Navigate to **Services → Dashboard** in the LuCI menu.

### Service Commands

```bash
/etc/init.d/dashboard status                  # Show full service status
/etc/init.d/dashboard vnstat_enable           # Enable vnStat card
/etc/init.d/dashboard vnstat_disable          # Disable vnStat card
/etc/init.d/dashboard adblock_enable          # Enable Adblock card
/etc init.d/dashboard adblock_disable         # Disable Adblock card
/etc/init.d/dashboard vnstat_backup_enable    # Enable scheduled 12h DB backup
/etc/init.d/dashboard vnstat_backup_disable   # Final backup then disable
/etc/init.d/dashboard vnstat_backup_fix       # Repair missing cron job
/etc/init.d/dashboard vnstat_backup           # Immediate backup
/etc/init.d/dashboard vnstat_restore          # Immediate restore
```

### Global CLI Shims

```bash
vnstat_backup   # Same as /etc/init.d/dashboard vnstat_backup
vnstat_restore  # Same as /etc/init.d/dashboard vnstat_restore
```

## Architecture

```
src/
├── controller/admin/
│   ├── dashboard.lua          # Main dashboard API controller
│   └── vnstat_backup.lua      # Backup/restore API controller
├── view/dashboard/
│   ├── dashboard.htm          # Main dashboard UI template
│   ├── vnstat_backup.htm      # Backup management UI template
│   ├── dashboard.css          # Dashboard styles
│   └── vnstat_backup.css      # Backup page styles
├── etc/
│   ├── config/dashboard       # UCI configuration
│   └── init.d/dashboard       # procd service script
└── usr/sbin/
    ├── vnstat_backup          # Global backup command shim
    └── vnstat_restore         # Global restore command shim
```

### Data Flow

1. **Controllers** (`src/controller/admin/`) expose JSON API endpoints via LuCI's `entry()` routing
2. **Views** (`src/view/dashboard/`) render the HTML interface and make fetch calls to controllers
3. **Service** (`src/etc/init.d/dashboard`) manages symlinks, cron scheduling, and vnStat backup/restore operations
4. **CLI shims** (`src/usr/sbin/`) provide global command access without knowing init.d paths

### Caching Strategy

| Data | TTL | Method |
|------|-----|--------|
| Ping status | 2s | ICMP via `ping` |
| CPU/GPU temps | 5s | sysfs `/sys/class/thermal/` |
| Wi-Fi clients + RAM | 20s | ubus `hostapd` + `/proc/meminfo` |
| System/WAN uptime | 10s | ubus `system.info` + `network.interface.wan` |
| vnStat traffic | 300s | vnStat CLI |
| Adblock status | 300s | ubus |
| Public IP/ISP | 12h | curl to ipinfo.io |
| Binary presence | 1h | `which` check |

## File Permissions

| Path | Mode | Purpose |
|------|------|---------|
| `src/etc/init.d/dashboard` | 755 | Service script |
| `src/usr/sbin/vnstat_backup` | 755 | CLI shim |
| `src/usr/sbin/vnstat_restore` | 755 | CLI shim |
| `src/etc/config/dashboard` | 644 | UCI config |
| `src/controller/admin/*.lua` | 644 | Controllers |
| `src/view/dashboard/*.htm` | 644 | Templates |

## Development

### Adding a New Controller

1. Create `src/controller/admin/<name>.lua` with `index()` function using `entry()` calls
2. Create corresponding view in `src/view/dashboard/<name>.htm`
3. Rebuild: `make package/luci-app-dashboard/compile`

### Adding a New Service Command

1. Add function to `src/etc/init.d/dashboard`
2. Append command name to `EXTRA_COMMANDS`
3. Add help text to `EXTRA_HELP`

## Uninstall

```bash
opkg remove luci-app-dashboard
```

The `prerm` script automatically:
- Runs a final vnStat DB backup
- Removes LuCI symlinks
- Clears caches
- Disables the service

## License

MIT License — see [LICENSE](LICENSE) for details.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Acknowledgments

- [OpenWrt](https://openwrt.org) project
- [LuCI](https://github.com/openwrt/luci) framework
- [vnStat](https://humdi.net/vnstat/) traffic monitor
