module("luci.dashboard_pkg.util", package.seeall)

local io_open = io.open

function vnstat_backup_cron()
  local active = false
  local interval = nil
  local cf = io_open("/etc/crontabs/root", "r")
  if cf then
    for line in cf:lines() do
      if line:match("dashboard_vnstat_db_backup") and not line:match("^%s*#") then
        active = true
        local h = line:match("^%S+%s+(%S+)")
        local m = line:match("^(%S+)")
        local every_h = h and h:match("^%*/(%d+)$")
        if every_h then
          interval = "every " .. every_h .. "h"
        elseif h and tonumber(h) then
          interval = "daily at " .. string.format("%02d:%02d", tonumber(h), tonumber(m) or 0)
        end
        break
      end
    end
    cf:close()
  end
  return { active = active, interval = interval }
end
