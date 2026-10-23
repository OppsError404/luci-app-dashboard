-- collector.lua, does all the measuring for the dashboard
-- the daemon keeps a ubus connection open and calls collect() every 2s,
-- the result is written to /tmp/dashboard/data.json

module("luci.dashboard_pkg.collector", package.seeall)

-- localised globals
local io_open    = io.open
local os_time    = os.time
local tonumber   = tonumber
local tostring   = tostring
local math_floor = math.floor
local table_sort = table.sort
local pcall      = pcall

-- libraries
local nixio_ok, nixio = pcall(require, "nixio")
local nixio_fs        = nixio_ok and nixio.fs or nil

local has_jsonc, jsonc = pcall(require, "luci.jsonc")
local ubus = require "ubus"
local uci  = require "uci".cursor()

-- rpcd can change the settings from another process, so the cursor we
-- made at startup is too old. Open a new one every time we read a value.
local function setting(key)
  return require("uci").cursor():get("dashboard", "settings", key)
end

-- luci.sys.exec and luci.util.shellquote need luci-compat, so we make
-- our own versions here
local function shellquote(s)
  return "'" .. tostring(s):gsub("'", "'\"'\"'") .. "'"
end

local function exec(cmd)
  local p = io.popen(cmd .. " 2>/dev/null", "r")
  if not p then return "" end
  local out = p:read("*a")
  p:close()
  return out or ""
end

local sys  = { exec = exec }
local util = { shellquote = shellquote }

-- config
local REFRESH = {
  PING    = 2,
  TEMPS   = 5,
  CLIENTS = 20,
  UPTIME  = 10,
  VNSTAT  = 300,
  DEVICE  = 3600,
  NETWORK = 43200,
  BINARY  = 3600,
  -- the client monitor check is cheap now, so it can run more often
  CLIENT_MONITOR = 300,
}

-- the daemon stops after 60s of nobody looking at the page, so anything
-- with a longer ttl has to be written to PERSIST_FILE to survive the
-- restart. Only put keys with a ttl over 60s in here.
local PERSIST_FILE = "/tmp/dashboard/cache.json"
local PERSIST_TTL = {
  network        = REFRESH.NETWORK,
  vnstat_all     = REFRESH.VNSTAT,
  device         = REFRESH.DEVICE,
  vnstat_bin     = REFRESH.BINARY,
  client_monitor = REFRESH.CLIENT_MONITOR,
}

local PING_HOSTS = { "1.1.1.1", "9.9.9.9" }

-- state, lives as long as the daemon
local conn
local cache = {}
local HAS_WIFI

-- cache helper
-- defined further down, the file helpers have to be in scope first
local save_persistent_cache

local function cached(key, ttl, fn)
  local now = os_time()
  local entry = cache[key]
  if entry and (now - entry.ts) <= ttl then
    return entry.data
  end
  local data = fn()
  local new_entry = { ts = now, data = data }
  cache[key] = new_entry
  if PERSIST_TTL[key] then
    save_persistent_cache(key, new_entry)
  end
  return data
end

-- time with fractions, the browser needs it to work out the deltas
-- between two samples that are less than a second apart
local function wall_time()
  if nixio_ok and nixio.gettimeofday then
    local sec, usec = nixio.gettimeofday()
    if sec then return sec + (usec or 0) / 1000000 end
  end
  return os_time()
end

-- read helpers, no forks
local function sysfs_read(path)
  if nixio_fs and nixio_fs.readfile then
    local v = nixio_fs.readfile(path)
    return v and v:match("^%s*(.-)%s*$") or nil
  end
  local f = io_open(path, "r")
  if not f then return nil end
  local s = f:read("*l"); f:close()
  return s
end

local function sysfs_num(path)
  return tonumber(sysfs_read(path))
end

local function read_file(path, mode)
  local f = io_open(path, mode or "r")
  if not f then return nil end
  local data = f:read("*a")
  f:close()
  return data
end

local function file_exists(path)
  if not path then return false end
  if nixio_fs and nixio_fs.stat then return nixio_fs.stat(path) ~= nil end
  local f = io_open(path, "r")
  if not f then return false end
  f:close(); return true
end

-- cache on disk
-- write to a temp file and rename it over the real one, so a crash in
-- the middle cannot leave a broken cache behind
local function write_file_atomic(path, content)
  local tmp = path .. ".tmp"
  local f = io_open(tmp, "w")
  if not f then return false end
  f:write(content)
  f:close()
  return os.rename(tmp, path) ~= nil
end

local function read_persist_obj()
  local raw = read_file(PERSIST_FILE)
  if not raw or raw == "" then return {} end
  local obj = has_jsonc and jsonc.parse(raw)
  if type(obj) == "table" then return obj end
  return {}
end

local function load_persistent_cache()
  local obj = read_persist_obj()
  local now = os_time()
  for key, entry in pairs(obj) do
    if type(entry) == "table" and entry.ts and entry.data then
      local ttl = PERSIST_TTL[key]
      if ttl and (now - entry.ts) <= ttl then
        cache[key] = entry
      end
    end
  end
end

save_persistent_cache = function(key, entry)
  if not PERSIST_TTL[key] then return end
  local obj = read_persist_obj()
  obj[key] = entry
  local payload = has_jsonc and jsonc.stringify(obj) or nil
  if payload then write_file_atomic(PERSIST_FILE, payload) end
end

local function clear_persistent_key(key)
  cache[key] = nil
  if not PERSIST_TTL[key] then return end
  local obj = read_persist_obj()
  if obj[key] == nil then return end
  obj[key] = nil
  local payload = has_jsonc and jsonc.stringify(obj) or nil
  if payload then write_file_atomic(PERSIST_FILE, payload) end
end

local function list_dir(path, nofork)
  if not path then return {} end
  if nixio_fs and nixio_fs.dir then
    local ok, iter = pcall(nixio_fs.dir, path)
    if ok and iter then
      local out = {}
      for e in iter do
        if e ~= "." and e ~= ".." then out[#out+1] = e end
      end
      return out
    end
  end
  if nofork then return {} end
  local out, p = {}, io.popen("ls -1 " .. util.shellquote(path) .. " 2>/dev/null")
  if p then
    for line in p:lines() do out[#out+1] = line end
    p:close()
  end
  return out
end

local function hex_le_to_ip(hex)
  if not hex or #hex ~= 8 then return nil end
  local p1, p2, p3, p4 = hex:match("(%x%x)(%x%x)(%x%x)(%x%x)")
  if not p4 then return nil end
  return string.format("%d.%d.%d.%d",
    tonumber(p4, 16), tonumber(p3, 16), tonumber(p2, 16), tonumber(p1, 16))
end

local function read_proc_route()
  local gateway_ips, default_dev = {}, nil
  local f = io_open("/proc/net/route", "r")
  if not f then return gateway_ips, default_dev end
  for line in f:lines() do
    local iface, dest, gw = line:match("^%s*(%S+)%s+(%S+)%s+(%S+)")
    if iface and dest and gw and dest ~= "Destination" then
      if dest == "00000000" and gw ~= "00000000" then
        local ip = hex_le_to_ip(gw)
        if ip then gateway_ips[ip] = true end
        if not default_dev then default_dev = iface end
      end
    end
  end
  f:close()
  return gateway_ips, default_dev
end

-- find the bridge port that faces the gateway
-- in dumb ap mode the bridge master (br-lan for example) does not count
-- the traffic that just goes through it, so the wan numbers have to come
-- from the slave port. We look up the gateway ip, then its mac, then the
-- port it sits on.
local function _find_uplink_port(bridge_name)
  if not bridge_name or bridge_name == "" then return nil end
  local gateway_ips = read_proc_route()
  if not gateway_ips or not next(gateway_ips) then return nil end
  local gw_mac = nil
  local arp_f = io_open("/proc/net/arp", "r")
  if arp_f then
    for line in arp_f:lines() do
      local ip, flags, mac = line:match("^%s*(%S+)%s+%S+%s+(%S+)%s+(%x%x:%x%x:%x%x:%x%x:%x%x:%x%x)")
      if ip and mac and flags and gateway_ips[ip] then
        local fl = tonumber(flags, 16) or 0
        if fl ~= 0 then gw_mac = mac:lower(); break end
      end
    end
    arp_f:close()
  end
  if not gw_mac then return nil end
  local fdb = sys.exec("bridge fdb show br " .. bridge_name .. " 2>/dev/null") or ""
  for line in fdb:gmatch("[^\r\n]+") do
    local mac, dev = line:match("^(%x%x:%x%x:%x%x:%x%x:%x%x:%x%x)%s+dev%s+(%S+)")
    if mac and dev and mac:lower() == gw_mac then
      if file_exists("/sys/class/net/" .. bridge_name .. "/brif/" .. dev) then
        return dev
      end
    end
  end
  return nil
end

local function has_wireless()
  if HAS_WIFI ~= nil then return HAS_WIFI end
  if nixio_fs and nixio_fs.dir then
    local ok, iter = pcall(nixio_fs.dir, "/sys/class/net")
    if ok and iter then
      for entry in iter do
        if entry ~= "." and entry ~= ".." then
          if file_exists("/sys/class/net/" .. entry .. "/phy80211") then
            HAS_WIFI = true
            return true
          end
        end
      end
    end
  end
  if file_exists("/sys/class/ieee80211") then
    HAS_WIFI = true
    return true
  end
  HAS_WIFI = false
  return false
end

-- binary and big endian helpers
local function read_be_cells(path, cells)
  cells = tonumber(cells) or 1
  local data = read_file(path, "rb")
  if not data or #data < (cells * 4) then return nil end
  local n = 0
  for i = 0, cells - 1 do
    local p = (i * 4) + 1
    local b1, b2, b3, b4 = data:byte(p, p + 3)
    if not b4 then return nil end
    n = (n * 4294967296) + (((((b1 * 256) + b2) * 256 + b3) * 256) + b4)
  end
  return n
end

local function read_dt_cell(path, default)
  return read_be_cells(path, 1) or default
end

local function dt_root_path()
  if file_exists("/sys/firmware/devicetree/base/#address-cells") then
    return "/sys/firmware/devicetree/base"
  end
  if file_exists("/proc/device-tree/#address-cells") then
    return "/proc/device-tree"
  end
  return nil
end

local function parse_dt_reg_sizes(path, address_cells, size_cells)
  local data = read_file(path, "rb")
  local sizes = {}
  if not data then return sizes end
  local stride_cells = (address_cells or 1) + (size_cells or 1)
  local stride = stride_cells * 4
  if stride <= 0 then return sizes end
  for offset = 1, #data - stride + 1, stride do
    local size = 0
    local size_pos = offset + ((address_cells or 1) * 4)
    for i = 0, (size_cells or 1) - 1 do
      local p = size_pos + (i * 4)
      local b1, b2, b3, b4 = data:byte(p, p + 3)
      if not b4 then size = nil; break end
      size = (size * 4294967296) + (((((b1 * 256) + b2) * 256 + b3) * 256) + b4)
    end
    if size and size > 0 then sizes[#sizes+1] = size end
  end
  return sizes
end

local function get_dt_memory_info()
  local root = dt_root_path()
  if not root then return 0, 0 end
  local address_cells = read_dt_cell(root .. "/#address-cells", 1)
  local size_cells    = read_dt_cell(root .. "/#size-cells", 1)
  local total, reserved = 0, 0
  for _, node in ipairs(list_dir(root, true)) do
    if node:match("^memory") then
      for _, size in ipairs(parse_dt_reg_sizes(root .. "/" .. node .. "/reg", address_cells, size_cells)) do
        total = total + size
      end
    end
  end
  if total == 0 then
    for _, size in ipairs(parse_dt_reg_sizes(root .. "/memory/reg", address_cells, size_cells)) do
      total = total + size
    end
    for _, size in ipairs(parse_dt_reg_sizes(root .. "/memory@0/reg", address_cells, size_cells)) do
      total = total + size
    end
  end
  local reserved_root = root .. "/reserved-memory"
  if file_exists(reserved_root) then
    local ra = read_dt_cell(reserved_root .. "/#address-cells", address_cells)
    local rs = read_dt_cell(reserved_root .. "/#size-cells", size_cells)
    for _, node in ipairs(list_dir(reserved_root, true)) do
      for _, size in ipairs(parse_dt_reg_sizes(reserved_root .. "/" .. node .. "/reg", ra, rs)) do
        reserved = reserved + size
      end
    end
  end
  return math_floor(total / 1024), math_floor(reserved / 1024)
end

local function parse_size_to_kb(s)
  if not s then return 0 end
  local n, unit = tostring(s):match("^%s*(%d+)%s*([kKmMgGtT]?)")
  n = tonumber(n)
  if not n then return 0 end
  unit = (unit or ""):lower()
  if unit == "t" then return n * 1073741824 end
  if unit == "g" then return n * 1048576 end
  if unit == "m" then return n * 1024 end
  return n
end

local function parse_num(s)
  if not s then return nil end
  s = tostring(s):match("^%s*(.-)%s*$")
  local hex = s:match("^0[xX](%x+)$")
  return hex and tonumber(hex, 16) or tonumber(s)
end

local function get_vcgencmd_memory_kb()
  local cmd = nil
  for _, path in ipairs({ "/usr/bin/vcgencmd", "/bin/vcgencmd", "/opt/vc/bin/vcgencmd" }) do
    if file_exists(path) then cmd = path; break end
  end
  if not cmd then return 0, 0 end
  local total_out = sys.exec(cmd .. " get_config total_mem 2>/dev/null") or ""
  local gpu_out   = sys.exec(cmd .. " get_mem gpu 2>/dev/null") or ""
  local total_mb  = tonumber(total_out:match("total_mem=(%d+)")) or tonumber(total_out:match("^(%d+)%s*$")) or 0
  local gpu_kb    = parse_size_to_kb(gpu_out:match("gpu=(%S+)"))
  return total_mb > 0 and (total_mb * 1024) or 0, gpu_kb
end

local function get_memmap_memory_kb()
  local root = "/sys/firmware/memmap"
  local total = 0
  for _, entry in ipairs(list_dir(root, true)) do
    local typ = sysfs_read(root .. "/" .. entry .. "/type") or ""
    typ = typ:lower()
    if typ == "usable" or typ == "conventional memory" or typ == "conventional" or typ == "system ram" then
      local start_s = sysfs_read(root .. "/" .. entry .. "/start")
      local end_s   = sysfs_read(root .. "/" .. entry .. "/end")
      local start_n = parse_num(start_s)
      local end_n   = parse_num(end_s)
      if start_n and end_n and end_n >= start_n then
        total = total + (end_n - start_n + 1)
      end
    end
  end
  return math_floor(total / 1024)
end

local function get_memory_info()
  local mem = {
    total = 0, avail = 0,
    cma_total = 0, cma_free = 0,
    reserved_gpu = 0, reserved_total = 0,
    physical_total = 0,
  }
  local mem_free, buffers, cached, sreclaimable, shmem = 0, 0, 0, 0, 0
  local mf = io_open("/proc/meminfo", "r")
  if mf then
    for line in mf:lines() do
      mem.total     = mem.total > 0 and mem.total or (tonumber(line:match("^MemTotal:%s+(%d+)")) or 0)
      mem.avail     = mem.avail > 0 and mem.avail or (tonumber(line:match("^MemAvailable:%s+(%d+)")) or 0)
      mem.cma_total = mem.cma_total > 0 and mem.cma_total or (tonumber(line:match("^CmaTotal:%s+(%d+)")) or 0)
      mem.cma_free  = mem.cma_free > 0 and mem.cma_free or (tonumber(line:match("^CmaFree:%s+(%d+)")) or 0)
      mem_free      = mem_free > 0 and mem_free or (tonumber(line:match("^MemFree:%s+(%d+)")) or 0)
      buffers       = buffers > 0 and buffers or (tonumber(line:match("^Buffers:%s+(%d+)")) or 0)
      cached        = cached > 0 and cached or (tonumber(line:match("^Cached:%s+(%d+)")) or 0)
      sreclaimable  = sreclaimable > 0 and sreclaimable or (tonumber(line:match("^SReclaimable:%s+(%d+)")) or 0)
      shmem         = shmem > 0 and shmem or (tonumber(line:match("^Shmem:%s+(%d+)")) or 0)
      if mem.total > 0 and mem.avail > 0 and mem_free > 0
         and buffers > 0 and cached > 0 and sreclaimable > 0 and shmem > 0 then
        break
      end
    end
    mf:close()
  end
  if mem.avail == 0 then
    mem.avail = mem_free + buffers + cached + sreclaimable - shmem
    if mem.avail < 0 then mem.avail = 0 end
  end
  mem.physical_total = mem.total
  local vc_total, vc_gpu = get_vcgencmd_memory_kb()
  if vc_gpu > 0 then mem.reserved_gpu = vc_gpu end
  if vc_total > mem.physical_total then mem.physical_total = vc_total end
  local dt_total, dt_reserved = get_dt_memory_info()
  if dt_reserved > 0 then mem.reserved_total = dt_reserved end
  if dt_total > mem.physical_total then mem.physical_total = dt_total end
  local map_total = get_memmap_memory_kb()
  if map_total > mem.physical_total then mem.physical_total = map_total end
  return mem
end

-- ping without forking
local NIXIO_PING_OK = nixio_ok and nixio.gettimeofday and nixio.bit and true or false
local NIXIO_PING_VERIFIED = false

local function nixio_ping(host, timeout_sec)
  if not NIXIO_PING_OK then return nil end
  local bit = nixio.bit

  local sock = nixio.socket("inet", "raw", "icmp")
  if not sock then
    NIXIO_PING_OK = false
    return nil
  end

  sock:setsockopt("socket", "rcvtimeo", timeout_sec or 2, 0)

  local id = (nixio.getpid and nixio.getpid()) or 1
  local seq = 1
  local payload = string.rep("x", 16)

  local pkt = string.char(8, 0, 0, 0)
    .. string.char(bit.band(bit.rshift(id, 8), 0xFF), bit.band(id, 0xFF))
    .. string.char(0, seq)
    .. payload

  local sum = 0
  for i = 1, #pkt - 1, 2 do
    sum = sum + pkt:byte(i) * 256 + pkt:byte(i + 1)
  end
  if #pkt % 2 == 1 then
    sum = sum + pkt:byte(#pkt) * 256
  end
  while bit.rshift(sum, 16) > 0 do
    sum = bit.band(sum, 0xFFFF) + bit.rshift(sum, 16)
  end
  local cksum = bit.band(bit.bnot(sum), 0xFFFF)

  pkt = string.char(8, 0,
      bit.band(bit.rshift(cksum, 8), 0xFF), bit.band(cksum, 0xFF))
    .. string.char(bit.band(bit.rshift(id, 8), 0xFF), bit.band(id, 0xFF))
    .. string.char(0, seq)
    .. payload

  local sec1, usec1 = nixio.gettimeofday()
  local sent = sock:sendto(pkt, host, 0)
  if not sent then
    sock:close()
    return nil
  end

  local resp = sock:recv(1024)
  local sec2, usec2 = nixio.gettimeofday()
  sock:close()

  if not resp or #resp < 28 then return nil end

  local ihl = bit.band(resp:byte(1), 0x0F) * 4
  if ihl < 20 or #resp < ihl + 8 then return nil end

  if resp:byte(ihl + 1) ~= 0 then return nil end

  local resp_id = resp:byte(ihl + 5) * 256 + resp:byte(ihl + 6)
  if resp_id ~= id then return nil end

  return ((sec2 - sec1) * 1000) + ((usec2 - usec1) / 1000)
end

-- ping, cached for 2s
local function get_ping_status(now, wan_iface, fast)
  -- fast mode, one host and a 1s timeout so we get an answer right away.
  -- not cached, the next full round pings both hosts the normal way.
  if fast then
    local result = { status = "offline", rtt_ms = nil }
    if NIXIO_PING_OK then
      local rtt = nixio_ping(PING_HOSTS[1], 1)
      if rtt then
        NIXIO_PING_VERIFIED = true
        result.status = "online"
        result.rtt_ms = tonumber(string.format("%.1f", rtt))
      end
    end
    return result
  end

  return cached("ping", REFRESH.PING, function()
    local result = { status = "offline", rtt_ms = nil }

    if NIXIO_PING_OK then
      for _, host in ipairs(PING_HOSTS) do
        local rtt = nixio_ping(host, 2)
        if rtt then
          NIXIO_PING_VERIFIED = true
          result.status = "online"
          result.rtt_ms = tonumber(string.format("%.1f", rtt))
          return result
        end
      end
      if NIXIO_PING_VERIFIED then
        return result
      end
    end

    local iface_flag = (wan_iface and wan_iface ~= "") and ("-I " .. wan_iface .. " ") or ""
    for _, host in ipairs(PING_HOSTS) do
      local out = sys.exec("ping " .. iface_flag .. "-c1 -W2 " .. host .. " 2>/dev/null") or ""
      local rtt = out:match("min/avg/max[^=]*=%s*[%d.]+/([%d.]+)/")
      if rtt then
        result.status = "online"
        result.rtt_ms = tonumber(rtt)
        break
      end
    end
    return result
  end)
end

-- uptimes and wan status, cached for 10s
local WAN_PROTOS = {
  pppoe=true, dhcp=true, static=true, pppoa=true,
  pptp=true, l2tp=true, wwan=true, qmi=true, mbim=true,
  dhcpv6=true,
}

local function _detect_wan_iface(c)
   local ok_objs, objs = pcall(c.objects, c)
   if ok_objs and objs then
     for _, obj in ipairs(objs) do
       local logical = obj:match("^network%.interface%.(.+)$")
       if logical then
         local lname = logical:lower()
         if lname ~= "loopback"
            and not lname:match("^lan")
            and not lname:match("^br")
            and not lname:match("^wg") then
           local ok, status = pcall(c.call, c, "network.interface." .. logical, "status", {})
           if ok and status then
             local proto = (type(status.proto) == "string") and status.proto:lower() or ""
             if WAN_PROTOS[proto] then
               local l3 = status.l3_device or status.device or ""
               local dev = status.device or status.l3_device or ""
               if l3 ~= "" and dev ~= "" then
                 return { logical = logical, l3_device = l3, device = dev, proto = proto }
               end
             end
           end
         end
       end
     end
   end
    -- try the object list again, it may have failed before
    do
    local ok_objs2, objs2 = pcall(c.objects, c)
    if ok_objs2 and objs2 then
      for _, obj in ipairs(objs2) do
        local logical = obj:match("^network%.interface%.(.+)$")
        if logical then
          local lname = logical:lower()
          if lname ~= "loopback"
             and not lname:match("^lan")
             and not lname:match("^br")
             and not lname:match("^wg") then
            local ok, status = pcall(c.call, c, "network.interface." .. logical, "status", {})
            if ok and status then
              local proto = (type(status.proto) == "string") and status.proto:lower() or ""
              if WAN_PROTOS[proto] then
                local l3 = status.l3_device or status.device or ""
                local dev = status.device or status.l3_device or ""
                if l3 ~= "" and dev ~= "" then
                  return { logical = logical, l3_device = l3, device = dev, proto = proto }
                end
              end
            end
          end
        end
      end
    end
    end -- fallback block
    -- last try, look at the default route in /proc/net/route
    do
      local _, default_dev = read_proc_route()
      if default_dev then
        local ok2, objs3 = pcall(c.objects, c)
        local ifaces = ok2 and objs3 or {}
        local route_logical = nil
        for _, obj in ipairs(ifaces) do
          local logical = obj:match("^network%.interface%.(.+)$")
          if logical then
            local ok, status = pcall(c.call, c, "network.interface." .. logical, "status", {})
            if ok and status and (status.device == default_dev or status.l3_device == default_dev) then
              route_logical = logical
              break
            end
          end
        end
        if route_logical then
          local ok, status = pcall(c.call, c, "network.interface." .. route_logical, "status", {})
          if ok and status then
            local proto = (type(status.proto) == "string") and status.proto:lower() or ""
            local l3 = status.l3_device or status.device or ""
            local dev = status.device or status.l3_device or ""
            return { logical = route_logical, l3_device = l3, device = dev, proto = proto }
          end
        end
      end
    end
   return nil
end

local function get_uptimes(now, c)
  return cached("uptimes", REFRESH.UPTIME, function()
    local system = 0
    local ok_si, sysinfo = pcall(c.call, c, "system", "info", {})
    if not ok_si then sysinfo = nil end
    if sysinfo and sysinfo.uptime then
      system = math_floor(tonumber(sysinfo.uptime) or 0)
    else
      local s = sysfs_read("/proc/uptime")
      system = math_floor(tonumber(s and s:match("^(%d+%.?%d*)")) or 0)
    end

    local wan_uptime    = 0
    local wan_status    = "down"
    local wan_type      = "unknown"
    local wan_l3_device = ""
    local wan_phys_device = ""

    local ok, wan = pcall(c.call, c, "network.interface.wan", "status", {})
    if not ok then wan = nil end

    if not wan then
      local detected = _detect_wan_iface(c)
      if detected then
        local ok_w, w = pcall(c.call, c, "network.interface." .. detected.logical, "status", {})
        wan = (ok_w and w) or nil
      end
    end

    if wan then
      if wan.up == true then
        wan_status = "up"
        wan_uptime = tonumber(wan.uptime) or 0
      end
      local proto = (type(wan.proto) == "string") and wan.proto:lower() or ""
      if     proto == "pppoe"  then wan_type = "pppoe"
      elseif proto == "dhcp" or proto == "dhcpv6" then wan_type = "dhcp"
      elseif proto == "static" then wan_type = "static"
      elseif proto ~= ""       then wan_type = proto
      end
      wan_l3_device   = wan.l3_device or ""
      wan_phys_device = wan.device or wan_l3_device
    end

    -- dumb ap fixup
    -- in dumb ap mode the wan device is a bridge port or the bridge
    -- itself, and the bridge does not count the traffic that just passes
    -- through it. so we read the counters from the uplink port.
    local bridge_name = nil
    if wan_phys_device ~= "" and file_exists("/sys/class/net/" .. wan_phys_device .. "/brport") then
      local bridge_link = (nixio_fs and nixio_fs.readlink)
        and nixio_fs.readlink("/sys/class/net/" .. wan_phys_device .. "/brport/bridge")
        or nil
      if bridge_link then
        local bn = bridge_link:match("([^/]+)$")
        if bn and bn ~= "" then bridge_name = bn end
      end
    elseif wan_phys_device ~= "" and file_exists("/sys/class/net/" .. wan_phys_device .. "/bridge") then
      bridge_name = wan_phys_device
    end
    if bridge_name then
      wan_phys_device = bridge_name
      local uplink = _find_uplink_port(bridge_name)
      if uplink then wan_phys_device = uplink end
    end

    return {
      system          = system,
      wan_uptime      = wan_uptime,
      wan_status      = wan_status,
      wan_type        = wan_type,
      wan_l3_device   = wan_l3_device,
      wan_phys_device = wan_phys_device,
    }
  end)
end

-- network counters, read live
local function get_net(c, wan_phys_device)
  local ok_d, dev = pcall(c.call, c, "network.device", "status", { name = wan_phys_device })
  if not ok_d then dev = nil end
  local is_bridge = dev and dev.type == "bridge"
  if dev and dev.statistics then
    local rx, tx = dev.statistics.rx_bytes or "N/A", dev.statistics.tx_bytes or "N/A"
    if is_bridge then rx, tx = tx, rx end
    return rx, tx
  end
  local rx = sysfs_num("/sys/class/net/" .. wan_phys_device .. "/statistics/rx_bytes")
  local tx = sysfs_num("/sys/class/net/" .. wan_phys_device .. "/statistics/tx_bytes")
  if not is_bridge then
    is_bridge = file_exists("/sys/class/net/" .. wan_phys_device .. "/bridge")
  end
  if is_bridge then rx, tx = tx, rx end
  return rx or "N/A", tx or "N/A"
end

-- temperatures, cached for 5s
local function get_temps(now)
  return cached("temps", REFRESH.TEMPS, function()
    local cpu_t = nil
    local cpu_raw = sysfs_num("/sys/class/thermal/thermal_zone0/temp")
    if cpu_raw then
      cpu_t = cpu_raw / 1000
    else
      for _, entry in ipairs(list_dir("/sys/class/hwmon")) do
        local base = "/sys/class/hwmon/" .. entry
        local name = sysfs_read(base .. "/name") or ""
        if name:match("coretemp") or name:match("cpu") then
          local v = sysfs_num(base .. "/temp1_input")
          if v then cpu_t = v / 1000; break end
        end
      end
    end

    local sum, count = 0, 0
    for _, entry in ipairs(list_dir("/sys/class/hwmon")) do
      local base = "/sys/class/hwmon/" .. entry
      local name = sysfs_read(base .. "/name") or ""
      if name ~= "" and not name:match("coretemp") and not name:match("cpu") then
        for _, fn in ipairs(list_dir(base)) do
          if fn:match("^temp%d+_input$") then
            local v = sysfs_num(base .. "/" .. fn)
            if v and v > 0 then sum = sum + v; count = count + 1 end
          end
        end
      end
    end
    local wifi_t = (count > 0) and (sum / count / 1000) or nil
    return { cpu = cpu_t, wifi = wifi_t }
  end)
end

-- wifi clients, lan ports and ram, cached for 20s
local function get_clients_and_mem(now, c)
  return cached("clients_mem", REFRESH.CLIENTS, function()
    -- wifi clients from hostapd
    local total_wifi, aps = 0, {}
    local ok_objs, objs = pcall(c.objects, c)
    if ok_objs and objs then
      for _, obj in ipairs(objs) do
        local iface = obj:match("^hostapd%.(.+)$")
        if iface and iface ~= "" then
          local ok_s, status = pcall(c.call, c, "hostapd." .. iface, "get_status", {})
          if ok_s and status and status.ssid and status.freq then
            local fmhz = tonumber(status.freq) or 0
            local band = "unknown"
            if     fmhz >= 2400 and fmhz < 2500 then band = "2.4_Ghz"
            elseif fmhz >= 5000 and fmhz < 6000 then band = "5_Ghz"
            elseif fmhz >= 6000               then band = "6_Ghz" end

            local count = 0
            local ok_c, res = pcall(c.call, c, "hostapd." .. iface, "get_clients", {})
            if ok_c and res and res.clients then
              for _ in pairs(res.clients) do count = count + 1 end
            end

            local quality = nil
            local ok_iw, iw = pcall(c.call, c, "iwinfo", "info", { device = iface })
            if ok_iw and iw and iw.quality_max and iw.quality_max > 0 and iw.quality then
              quality = math_floor((iw.quality / iw.quality_max) * 100)
            end

            aps[#aps+1] = { iface=iface, essid=status.ssid, freq=fmhz, band=band, count=count, quality=quality }
            total_wifi = total_wifi + count
          end
        end
      end
    end
    local wifi = { total = total_wifi, aps = aps }

    -- lan ports, look for a bridge or ap behind them
    local fdb_count = {}
    local fdb_first_mac = {}
    local fdb_raw = sys.exec("bridge fdb show br br-lan 2>/dev/null") or ""
    local port_sets = {}
    for line in fdb_raw:gmatch("[^\r\n]+") do
      if not line:find("permanent") and not line:find("self") then
        local mac, dev = line:match("^(%x%x:%x%x:%x%x:%x%x:%x%x:%x%x)%s+dev%s+(%S+)")
        if mac and dev then
          mac = mac:lower()
          if not port_sets[dev] then port_sets[dev] = {} end
          if not port_sets[dev][mac] then
            port_sets[dev][mac] = true
            if not fdb_first_mac[dev] then fdb_first_mac[dev] = mac end
          end
        end
      end
    end
    for port, macs in pairs(port_sets) do
      local n = 0; for _ in pairs(macs) do n = n + 1 end
      fdb_count[port] = n
    end

    local gateway_ips = read_proc_route()

    local arp_by_mac = {}
    local arp_f = io_open("/proc/net/arp", "r")
    if arp_f then
      for line in arp_f:lines() do
        local ip, flags, mac = line:match("^%s*(%S+)%s+%S+%s+(%S+)%s+(%x%x:%x%x:%x%x:%x%x:%x%x:%x%x)")
        if ip and mac and flags then
          local fl = tonumber(flags, 16) or 0
          if fl ~= 0 then
            local is_ll = ip:sub(1,4):lower():match("^fe[89ab]") ~= nil
            if not is_ll then
              arp_by_mac[mac:lower()] = ip
            end
          end
        end
      end
      arp_f:close()
    end

    local dhcp_by_mac = {}
    do
      local f = io_open("/tmp/dhcp.leases", "r")
      if f then
        for line in f:lines() do
          local parts = {}
          for tok in line:gmatch("%S+") do parts[#parts+1] = tok end
          if #parts >= 3 and parts[2] and parts[3] then
            dhcp_by_mac[parts[2]:lower()] = parts[3]
          end
        end
        f:close()
      end
    end

    local brif_path = "/sys/class/net/br-lan/brif"
    local ports, total_lan, total_physical = {}, 0, 0

    for _, iface in ipairs(list_dir(brif_path)) do
      if not (file_exists("/sys/class/net/" .. iface .. "/wireless")
           or file_exists("/sys/class/net/" .. iface .. "/phy80211")
           or iface:match("^wl") or iface:match("^wlan")) then
        total_physical = total_physical + 1
        local carrier = sysfs_read("/sys/class/net/" .. iface .. "/carrier")
        local oper    = sysfs_read("/sys/class/net/" .. iface .. "/operstate")
        local active  = (carrier == "1") or (oper and oper:match("^up") ~= nil)
        local spd_raw = sysfs_num("/sys/class/net/" .. iface .. "/speed")
        local speed   = (spd_raw and spd_raw > 0) and spd_raw or nil
        if active then total_lan = total_lan + 1 end

        local n_macs    = fdb_count[iface] or 0
        local first_mac = fdb_first_mac[iface]
        local port_ip   = (first_mac and (arp_by_mac[first_mac] or dhcp_by_mac[first_mac])) or ""

        local is_bridge    = false
        local signal_fired = nil

         if n_macs > 1 then
           is_bridge = true; signal_fired = 1
         elseif port_ip ~= "" and gateway_ips[port_ip] then
           is_bridge = true; signal_fired = 2
         elseif first_mac and port_ip == "" and n_macs >= 1 then
           is_bridge = true; signal_fired = 3
         end

        local ap_label = is_bridge and "Bridge" or nil
        local client_count = (is_bridge and n_macs > 1) and (n_macs - 1) or 0

        ports[#ports+1] = {
          name      = iface,
          active    = active,
          speed     = speed,
          mac_count = client_count,
          ap_label  = ap_label,
        }
      end
    end

    table_sort(ports, function(a, b) return a.name < b.name end)
    local lan = { total = total_lan, total_physical = total_physical, ports = ports }
    local mem = get_memory_info()

    return { wifi = wifi, lan = lan, mem = mem }
  end)
end

-- cpu stats, read from /proc/stat
local function get_cpu_and_cores(now)
  local s = ""
  local f = io_open("/proc/stat", "r")
  if f then s = f:read("*a"); f:close() end

  local agg, cores = {}, {}
  for line in s:gmatch("[^\r\n]+") do
    if line:match("^cpu%s+") then
      local u,n,su,i,io_w,irq,soft,steal =
        line:match("^cpu%s+(%d+)%s+(%d+)%s+(%d+)%s+(%d+)%s*(%d*)%s*(%d*)%s*(%d*)%s*(%d*)")
      agg = {
        usr=tonumber(u) or 0, nice=tonumber(n) or 0, sys=tonumber(su) or 0,
        idle=tonumber(i) or 0, iowait=tonumber(io_w) or 0,
        irq=tonumber(irq) or 0, softirq=tonumber(soft) or 0,
        steal=tonumber(steal) or 0, ts=now
      }
    else
      local id,u,n,su,i,io_w,irq,soft,steal =
        line:match("^cpu(%d+)%s+(%d+)%s+(%d+)%s+(%d+)%s+(%d+)%s*(%d*)%s*(%d*)%s*(%d*)%s*(%d*)")
      if id then
        cores[#cores+1] = {
          id=tonumber(id),
          usr=tonumber(u) or 0, nice=tonumber(n) or 0, sys=tonumber(su) or 0,
          idle=tonumber(i) or 0, iowait=tonumber(io_w) or 0,
          irq=tonumber(irq) or 0, softirq=tonumber(soft) or 0,
          steal=tonumber(steal) or 0, ts=now
        }
      end
    end
  end
  local multi_core = cached("uci_multi_core", 5, function()
    return setting("multi_core") ~= "0"
  end)
  local out_cores = multi_core and (#cores > 0 and cores or nil) or nil
  return { agg=agg, cores=out_cores, multi_core=multi_core }
end

-- vnstat, cached for 5 min
local function fmt_bytes(n)
  n = tonumber(n) or 0
  if     n >= 1099511627776 then return string.format("%.2f TB", n / 1099511627776)
  elseif n >= 1073741824    then return string.format("%.2f GB", n / 1073741824)
  elseif n >= 1048576       then return string.format("%.2f MB", n / 1048576)
  elseif n >= 1024          then return string.format("%.2f KB", n / 1024)
  else                           return string.format("%d B",    n) end
end

local function normalize_units(str)
  if not str or type(str) ~= "string" then return str end
  for k, v in pairs({ KiB="KB", MiB="MB", GiB="GB", TiB="TB",
                      kib="KB", mib="MB", gib="GB", tib="TB" }) do
    str = str:gsub(k, v)
  end
  return str:gsub("(%d[%d%.]*)%s*([KMGT]?B)", "%1 %2")
end

local function get_iface_labels(c)
  local labels = {}
  if not c then return labels end
  local ok, dump = pcall(c.call, c, "network", "interface_dump", {})
  if not ok or not dump or type(dump.interface) ~= "table" then return labels end
  for _, entry in ipairs(dump.interface) do
    local logical = type(entry.interface) == "string" and entry.interface or ""
    local device  = type(entry.device)    == "string" and entry.device    or ""
    local l3dev   = type(entry.l3_device) == "string" and entry.l3_device or ""
    if logical ~= "" and logical ~= "loopback" then
      local lbl = logical:upper()
      if device ~= "" and not labels[device] then
        labels[device] = lbl .. " \xc2\xb7 " .. device
      end
      if l3dev ~= "" and l3dev ~= device and not labels[l3dev] then
        labels[l3dev] = lbl .. " \xc2\xb7 " .. l3dev
      end
    end
  end
  return labels
end

local function pick_current(entries, is_monthly, use_id)
  if type(entries) ~= "table" or #entries == 0 then return nil end
  if use_id then
    for _, e in ipairs(entries) do
      if e.id == 1 then return e end
    end
    return nil
  end
  local t = os.date("*t")
  for i = #entries, 1, -1 do
    local e = entries[i]
    if type(e.date) == "table" then
      if is_monthly then
        if e.date.year == t.year and e.date.month == t.month then return e end
      else
        if e.date.year == t.year and e.date.month == t.month and e.date.day == t.day then return e end
      end
    end
  end
  return entries[#entries]
end

local function rxb(v)
  if type(v) == "number" then return v end
  if type(v) == "table"  then return tonumber(v.bytes) or 0 end
  return tonumber(v) or 0
end

local function get_vnstat_installed(now)
  return cached("vnstat_bin", REFRESH.BINARY, function()
    return file_exists("/usr/bin/vnstat") or file_exists("/usr/bin/vnstatd")
  end)
end

local function get_all_vnstat_data(now, preferred_iface, c)
  return cached("vnstat_all", REFRESH.VNSTAT, function()
    local iface_labels = get_iface_labels(c)
    local result = { ifaces = {}, data = {} }

    local json_out = sys.exec("vnstat --json 2>/dev/null") or ""
    local parsed   = (json_out ~= "") and (has_jsonc and jsonc.parse(json_out)) or nil

    if parsed and type(parsed.interfaces) == "table" and #parsed.interfaces > 0 then
      local use_id = (tostring(parsed.jsonversion or "2") == "1")

      local ordered, seen = {}, {}
      if preferred_iface and preferred_iface ~= "" then
        for _, idata in ipairs(parsed.interfaces) do
          if idata.name == preferred_iface then
            ordered[#ordered+1] = idata
            seen[preferred_iface] = true
            break
          end
        end
      end
      for _, idata in ipairs(parsed.interfaces) do
        if not seen[idata.name] then
          ordered[#ordered+1] = idata
          seen[idata.name] = true
        end
      end

      for _, idata in ipairs(ordered) do
        local name = type(idata.name) == "string" and idata.name or ""
        if name ~= "" then
          local tr = (type(idata.traffic) == "table") and idata.traffic or {}
          local day_arr = tr.day   or tr.days
          local mon_arr = tr.month or tr.months

          local day_e = pick_current(day_arr, false, use_id)
          local d_rx  = day_e and rxb(day_e.rx) or 0
          local d_tx  = day_e and rxb(day_e.tx) or 0

          local mon_e = pick_current(mon_arr, true, use_id)
          local m_rx  = mon_e and rxb(mon_e.rx) or 0
          local m_tx  = mon_e and rxb(mon_e.tx) or 0

          result.ifaces[#result.ifaces+1] = {
            name  = name,
            label = iface_labels[name] or name,
          }
          result.data[name] = {
            daily   = { rx=fmt_bytes(d_rx), tx=fmt_bytes(d_tx), total=fmt_bytes(d_rx+d_tx) },
            monthly = { rx=fmt_bytes(m_rx), tx=fmt_bytes(m_tx), total=fmt_bytes(m_rx+m_tx) },
          }
        end
      end
    else
      -- vnstat 1.x uses --oneline
      local seen2, candidates = {}, {}
      if preferred_iface and preferred_iface ~= "" then
        local test = sys.exec("vnstat --oneline -i " .. preferred_iface .. " 2>/dev/null") or ""
        if test ~= "" and not test:match("^Error") then
          candidates[#candidates+1] = preferred_iface
          seen2[preferred_iface] = true
        end
      end
      local db_out = sys.exec("vnstat --dbiflist 2>/dev/null") or ""
      for iface in db_out:gmatch("%S+") do
        if not seen2[iface] then
          candidates[#candidates+1] = iface
          seen2[iface] = true
        end
      end

      for _, iface in ipairs(candidates) do
        local out = sys.exec("vnstat --oneline -i " .. iface .. " 2>/dev/null") or ""
        local daily   = { rx="N/A", tx="N/A", total="N/A" }
        local monthly = { rx="N/A", tx="N/A", total="N/A" }

        if out ~= "" and not out:match("^Error") then
          local parts = {}
          for field in out:gmatch("[^;]+") do parts[#parts+1] = field end
          if #parts >= 6 then
            daily = {
              rx    = normalize_units(parts[4] or "N/A"),
              tx    = normalize_units(parts[5] or "N/A"),
              total = normalize_units(parts[6] or "N/A"),
            }
          end
          if #parts >= 10 then
            monthly = {
              rx    = normalize_units(parts[8]  or "N/A"),
              tx    = normalize_units(parts[9]  or "N/A"),
              total = normalize_units(parts[10] or "N/A"),
            }
          end
        end

        result.ifaces[#result.ifaces+1] = {
          name  = iface,
          label = iface_labels[iface] or iface,
        }
        result.data[iface] = { daily = daily, monthly = monthly }
      end
    end

    return result
  end)
end

-- public ip, isp and asn, cached for 12h
local _last_net_status = nil

local function get_network_info(now, inet_status)
  -- drop the cache when the connection comes back, otherwise we would
  -- keep showing "-" for the next 12 hours.
  -- only when the status really changed, on a fresh start the status is
  -- still nil and we do not want to throw the saved cache away.
  if _last_net_status ~= nil and _last_net_status ~= inet_status then
    clear_persistent_key("network")
  end
  _last_net_status = inet_status

  -- offline, just return the placeholder and do not save it
  if inet_status ~= "online" then
    return { public_ipv4="-", public_ipv6="-", isp_name="-", isp_asn="" }
  end

  local result = cached("network", REFRESH.NETWORK, function()
    local ip, isp, asn, ipv6 = "-", "-", "", "-"

    -- uclient-fetch is on the router already, it has no --interface flag
    -- so the request just goes out the default route.
    -- -4 to force ipv4, otherwise ifconfig.co gives back the v6 address
    local fetch = "uclient-fetch -4 -q -T 8 -O- --no-check-certificate "

    local out = sys.exec(fetch .. "'https://ifconfig.co/json' 2>/dev/null") or ""
    if out ~= "" then
      local obj = has_jsonc and jsonc.parse(out)
      if obj then
        ip  = obj.ip      or "-"
        asn = obj.asn     or ""
        isp = obj.asn_org or "-"
      end
    end

    if ip == "-" then
      local out2 = sys.exec(fetch .. "'https://api.ipify.org?format=json' 2>/dev/null") or ""
      local obj = out2 ~= "" and has_jsonc and jsonc.parse(out2)
      if obj then ip = obj.ip or "-" end
    end

    if isp == "-" or asn == "" then
      local out3 = sys.exec(fetch .. "'https://ipinfo.io/json' 2>/dev/null") or ""
      local obj = out3 ~= "" and has_jsonc and jsonc.parse(out3)
      if obj and obj.org and obj.org ~= "" then
        asn = obj.org:match("^(%S+)") or ""
        isp = obj.org:match("^%S+%s+(.+)$") or "-"
      end
    end

    local out4 = sys.exec("uclient-fetch -6 -q -T 8 -O- --no-check-certificate 'https://api64.ipify.org' 2>/dev/null") or ""
    ipv6 = (out4 ~= "") and out4:match("^%S+") or "-"

    local data = { public_ipv4=ip, public_ipv6=ipv6, isp_name=isp, isp_asn=asn }
    return data
  end)

  -- do not keep a failed lookup, clear it so we try again next round
  if result.public_ipv4 == "-" then
    clear_persistent_key("network")
  end

  return result
end

-- device info, the router model, cached for 1h
local function get_device_info(c)
  return cached("device", REFRESH.DEVICE, function()
    local model = ""

    -- the board object has the marketing name of the device
    if c then
      local ok_b, board = pcall(c.call, c, "system", "board", {})
      if ok_b and type(board) == "table" and type(board.model) == "string" then
        model = board.model
      end
    end

    -- fallback for the odd build without the board object
    if model == "" then
      local raw = read_file("/tmp/sysinfo/model")
      if raw then model = (raw:gsub("%s+$", "")) end
    end

    if model == "" and c then
      local ok_s, sysinfo = pcall(c.call, c, "system", "info", {})
      if ok_s and type(sysinfo) == "table" and type(sysinfo.model) == "string" then
        model = sysinfo.model
      end
    end

    if model == "" then
      model = "Unknown"
    end

    return { model = model }
  end)
end

-- the client monitor package is optional and it moved its files around
-- between the releases, so we look it up in the package database first.
-- Reading the database is a single file read without a fork, so it is
-- cheap enough to do every few minutes. The file paths are only the
-- fallback for installs that are not in the database, a manual copy for
-- example.

local CM_PKG_NAME = "luci-app-client-monitor"

-- apk (openwrt 25.12 and newer) and opkg (24.10 and older) both keep
-- the installed packages in a plain text file
local CM_PKG_DBS = {
  { path = "/lib/apk/db/installed", prefix = "P:" },
  { path = "/usr/lib/opkg/status",   prefix = "Package: " },
}

-- files of the package, the old layout first. r1 and older shipped lua
-- views plus a lua controller, r2 and newer use ucode templates
local CM_FILES = {
  "/etc/init.d/client_monitor",
  "/usr/lib/lua/luci/client_monitor_pkg/controller/client_monitor.lua",
  "/usr/lib/lua/luci/client_monitor_pkg/view/client_monitor.htm",
  "/usr/lib/lua/luci/client_monitor_pkg/collector.lua",
  "/usr/lib/lua/luci/client_monitor_pkg/util.lua",
  "/usr/share/ucode/luci/template/client_monitor/client_monitor.ut",
  "/www/luci-static/resources/view/client_monitor/client_monitor.js",
  "/www/luci-static/resources/view/client_monitor/client_monitor.js.gz",
  "/usr/share/luci/menu.d/luci-app-client-monitor.json",
  "/usr/libexec/rpcd/client_monitor",
}

-- the files that make the luci page work
local CM_PAGE_FILES = {
  "/usr/share/ucode/luci/template/client_monitor/client_monitor.ut",
  "/usr/lib/lua/luci/view/client_monitor/client_monitor.htm",
  "/usr/share/luci/menu.d/luci-app-client-monitor.json",
}

-- looks for a package in the installed packages database, no fork
local function pkg_installed(name)
  for _, db in ipairs(CM_PKG_DBS) do
    local f = io_open(db.path, "r")
    if f then
      local found = false
      for line in f:lines() do
        if line == db.prefix .. name then
          found = true
          break
        end
      end
      f:close()
      if found then return true end
    end
  end
  return false
end

-- client monitor, the package is optional
local function get_client_monitor(now)
  return cached("client_monitor", REFRESH.CLIENT_MONITOR, function()
    local installed = pkg_installed(CM_PKG_NAME)

    if not installed then
      -- not in the database, look at the files. this catches the older
      -- layouts and a manual install
      for _, path in ipairs(CM_FILES) do
        if file_exists(path) then
          installed = true
          break
        end
      end
    end

    -- can the page be opened
    local available = false
    if installed then
      for _, path in ipairs(CM_PAGE_FILES) do
        if file_exists(path) then
          available = true
          break
        end
      end
    end

    -- does it start at boot
    local enabled = false
    if installed then
      for _, f in ipairs(list_dir("/etc/rc.d", true)) do
        if f:match("^S%d+client_monitor$") then
          enabled = true
          break
        end
      end
    end

    return { installed = installed, enabled = enabled, available = available }
  end)
end

-- downtime files, written by the monitor service
local WAN_DOWN_FILE  = "/tmp/dashboard/wan_down_time"
local INET_DOWN_FILE  = "/tmp/dashboard/internet_down_time"

local function read_downtime_seconds(path, now)
  local ts = tonumber(sysfs_read(path))
  if ts and ts > 0 then
    return now - ts
  end
  return nil
end

-- public api

-- open the ubus connection
function init()
  if conn then return true end
  conn = ubus.connect()
  if conn then load_persistent_cache() end
  return conn ~= nil
end

-- close the ubus connection
function close()
  if conn then
    pcall(function() conn:close() end)
    conn = nil
  end
end

-- drop all the cached values
function clear_cache()
  cache = {}
  os.remove(PERSIST_FILE)
end

-- get all the numbers and return them
-- the daemon calls this every 2s and the table is what the frontend gets.
-- with fast set we leave out the slow stuff (ping, isp lookup, vnstat) and
-- put placeholders in, so the first file is written right away
function collect(fast)
  local now = os_time()

  if not conn then init() end
  if not conn then
    return { error = "ubus daemon unavailable" }
  end

  -- uptimes and wan status, this has to run first
  local ok_u, uptimes = pcall(get_uptimes, now, conn)
  if not ok_u then
    uptimes = { system=0, wan_uptime=0, wan_status="down", wan_type="unknown",
                wan_l3_device="", wan_phys_device="" }
  end

  local wan_l3_device   = uptimes.wan_l3_device or ""
  local wan_phys_device = uptimes.wan_phys_device or ""

  -- ping, in fast mode it is one host with a 1s timeout
  local ok_p, ping = pcall(get_ping_status, now, wan_l3_device, fast)
  if not ok_p then ping = { status="offline", rtt_ms=nil } end
  local inet_status = ping.status or "offline"

  -- ip, isp and asn, skipped in fast mode
  local netinfo
  if fast then
    netinfo = { public_ipv4="-", public_ipv6="-", isp_name="-", isp_asn="" }
  else
    local ok_n, ni = pcall(get_network_info, now, inet_status)
    if not ok_n then
      ni = { public_ipv4="-", public_ipv6="-", isp_name="-", isp_asn="" }
    end
    netinfo = ni
  end

  -- wifi clients, lan and ram
  local ok_c, clients_mem = pcall(get_clients_and_mem, now, conn)
  if not ok_c then
    clients_mem = {
      wifi = { total = 0, aps = {} },
      lan  = { total = 0, total_physical = 0, ports = {} },
      mem  = { total = 0, avail = 0, cma_total = 0, cma_free = 0,
               reserved_gpu = 0, reserved_total = 0, physical_total = 0 },
    }
  end

  -- temperatures
  local ok_t, temps = pcall(get_temps, now)
  if not ok_t then temps = { cpu = nil, wifi = nil } end

  -- cpu
  local ok_cpu, cpu_stats = pcall(get_cpu_and_cores, now)
  if not ok_cpu then
    cpu_stats = { agg = {}, multi_core = false }
  end

  -- vnstat
  local show_vnstat = cached("uci_vnstat", 5, function()
    return setting("vnstat") ~= "0"
  end)
  local vnstat_installed = false
  local vn_all = { ifaces = {}, data = {} }
  if show_vnstat then
    -- checking if vnstat is installed is cheap, always do it so the
    -- frontend does not say "not installed" when it is
    local ok_vi, vi = pcall(get_vnstat_installed, now)
    vnstat_installed = ok_vi and vi or false
    if vnstat_installed and not fast then
      local ok_v, vd = pcall(get_all_vnstat_data, now, wan_phys_device, conn)
      if ok_v then vn_all = vd end
    end
  end

  -- client monitor
  local ok_cm, client_monitor = pcall(get_client_monitor, now)
  if not ok_cm then
    client_monitor = { installed = false, enabled = false, available = false }
  end

  -- device info, the router model
  local ok_dv, device = pcall(get_device_info, conn)
  if not ok_dv or not device then
    device = { model = "Unknown" }
  end

  -- network counters
  local rx, tx = "N/A", "N/A"
  if wan_phys_device and wan_phys_device ~= "" then
    local ok_rx, r, t = pcall(get_net, conn, wan_phys_device)
    if ok_rx then rx, tx = r, t end
  end

  -- put it all together
  local out = {
    ts             = wall_time(),
    cpu            = cpu_stats.agg,
    cpu_temp       = temps.cpu,
    cpu_multi_core = cpu_stats.multi_core,
    has_wifi       = has_wireless(),
    wifi_temp      = temps.wifi,
    mem            = clients_mem.mem,
    wifi           = clients_mem.wifi,
    lan            = clients_mem.lan,
    vnstat         = show_vnstat
                     and { installed = vnstat_installed, ifaces = vn_all.ifaces, data = vn_all.data }
                     or  { disabled = true },
    device         = device,
    client_monitor = client_monitor,
    network        = {
      status             = inet_status,
      ping_rtt_ms        = ping.rtt_ms,
      public_ipv4        = netinfo.public_ipv4,
      public_ipv6        = netinfo.public_ipv6,
      isp_name           = netinfo.isp_name,
      isp_asn            = netinfo.isp_asn,
      wan_type           = uptimes.wan_type,
      wan_status         = uptimes.wan_status,
      wan_uptime_seconds = uptimes.wan_uptime,
    },
    system_uptime_seconds = uptimes.system,
    net            = { iface = wan_l3_device, rx = rx, tx = tx },
    tmpfs_ok       = true,
  }

  if cpu_stats.cores then out.cpu_cores = cpu_stats.cores end

  -- downtime, the monitor service writes the timestamps to files
  local wan_down_secs = read_downtime_seconds(WAN_DOWN_FILE, now)
  if wan_down_secs and wan_down_secs > 0 then
    out.network.wan_downtime_seconds = wan_down_secs
  end
  local inet_down_secs = read_downtime_seconds(INET_DOWN_FILE, now)
  if inet_down_secs and inet_down_secs > 0 then
    out.network.downtime_seconds = inet_down_secs
  end

  return out
end
