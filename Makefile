include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-dashboard
PKG_VERSION:=2.0.0
PKG_RELEASE:=5
PKG_LICENSE:=MIT-License
PKG_MAINTAINER:=Mahid
PKG_URL:=https://github.com/OppsError404/luci-app-dashboard

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-dashboard
  SECTION:=luci
  CATEGORY:=LuCI
  TITLE:=Realtime Dashboard with vnStat Backup
  DEPENDS:=+luci-base +luci-lib-jsonc +lua +luci-lib-nixio +cgi-io +libubus-lua +libuci-lua
  PKGARCH:=all
  AUTHOR:=Mahid
endef

define Package/luci-app-dashboard/description
  A modern graphical dashboard for OpenWrt LuCI. 
endef

define Build/Prepare
	rm -rf $(PKG_BUILD_DIR)
	mkdir -p $(PKG_BUILD_DIR)/usr/share/ucode/luci/template/dashboard
	mkdir -p $(PKG_BUILD_DIR)/usr/lib/lua/luci/dashboard_pkg
	mkdir -p $(PKG_BUILD_DIR)/etc/init.d
	mkdir -p $(PKG_BUILD_DIR)/etc/config
	mkdir -p $(PKG_BUILD_DIR)/usr/sbin
	mkdir -p $(PKG_BUILD_DIR)/usr/libexec/rpcd
	mkdir -p $(PKG_BUILD_DIR)/usr/share/luci/menu.d
	mkdir -p $(PKG_BUILD_DIR)/usr/share/rpcd/acl.d
	mkdir -p $(PKG_BUILD_DIR)/www/luci-static/resources/view/dashboard
	mkdir -p $(PKG_BUILD_DIR)/www/luci-static/resources/icons
	$(CP) ./src/usr/share/ucode/luci/template/dashboard/*.ut \
	      $(PKG_BUILD_DIR)/usr/share/ucode/luci/template/dashboard/
	$(CP) ./src/usr/lib/lua/luci/dashboard_pkg/*.lua $(PKG_BUILD_DIR)/usr/lib/lua/luci/dashboard_pkg/
	$(CP) ./src/etc/init.d/dashboard     $(PKG_BUILD_DIR)/etc/init.d/
	$(CP) ./src/etc/config/dashboard     $(PKG_BUILD_DIR)/etc/config/
	$(CP) ./src/usr/sbin/vnstat_backup  $(PKG_BUILD_DIR)/usr/sbin/
	$(CP) ./src/usr/sbin/vnstat_restore $(PKG_BUILD_DIR)/usr/sbin/
	$(CP) ./src/usr/sbin/dashboard_monitor $(PKG_BUILD_DIR)/usr/sbin/
	$(CP) ./src/usr/sbin/dashboard_collect $(PKG_BUILD_DIR)/usr/sbin/
	$(CP) ./src/usr/libexec/rpcd/dashboard $(PKG_BUILD_DIR)/usr/libexec/rpcd/
	$(CP) ./src/usr/share/luci/menu.d/luci-app-dashboard.json \
	      $(PKG_BUILD_DIR)/usr/share/luci/menu.d/
	$(CP) ./src/usr/share/rpcd/acl.d/luci-app-dashboard.json \
	      $(PKG_BUILD_DIR)/usr/share/rpcd/acl.d/
	$(CP) ./src/www/luci-static/resources/view/dashboard/* \
	      $(PKG_BUILD_DIR)/www/luci-static/resources/view/dashboard/
	$(CP) ./src/www/luci-static/resources/icons/* \
	      $(PKG_BUILD_DIR)/www/luci-static/resources/icons/
endef

define Build/Compile
	chmod 0755 $(PKG_BUILD_DIR)/usr/sbin/dashboard_monitor
	chmod 0755 $(PKG_BUILD_DIR)/usr/sbin/dashboard_collect
	# Compress static assets for flash storage (decompressed to RAM at boot)
	find $(PKG_BUILD_DIR)/www/luci-static/resources/view/dashboard \
	     $(PKG_BUILD_DIR)/www/luci-static/resources/icons \
	     -type f ! -name '*.gz' -exec gzip -kf {} \;
endef

LUCI_TMPL_DIR:=/usr/share/ucode/luci/template/dashboard
PKG_STORE:=/usr/lib/lua/luci/dashboard_pkg
RPCD_DIR:=/usr/libexec/rpcd
DASH_VIEW_RES:=/www/luci-static/resources/view/dashboard
DASH_ICONS_RES:=/www/luci-static/resources/icons
LUCI_MENU_DIR:=/usr/share/luci/menu.d
RPCD_ACL_DIR:=/usr/share/rpcd/acl.d

define Package/luci-app-dashboard/install
	$(INSTALL_DIR) $(1)$(LUCI_TMPL_DIR)
	$(INSTALL_DIR) $(1)$(PKG_STORE)
	$(INSTALL_DIR) $(1)$(RPCD_DIR)
	$(INSTALL_DIR) $(1)$(DASH_VIEW_RES)
	$(INSTALL_DIR) $(1)$(DASH_ICONS_RES)
	$(INSTALL_DIR) $(1)$(LUCI_MENU_DIR)
	$(INSTALL_DIR) $(1)$(RPCD_ACL_DIR)

	$(INSTALL_DATA) $(PKG_BUILD_DIR)/usr/share/ucode/luci/template/dashboard/dashboard.ut \
	                $(1)$(LUCI_TMPL_DIR)/dashboard.ut
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/usr/share/ucode/luci/template/dashboard/vnstat_backup.ut \
	                $(1)$(LUCI_TMPL_DIR)/vnstat_backup.ut

	# Install compressed static assets (decompressed to RAM at boot by init.d)
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/www/luci-static/resources/view/dashboard/*.gz \
	                $(1)$(DASH_VIEW_RES)/
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/www/luci-static/resources/icons/*.gz \
	                $(1)$(DASH_ICONS_RES)/

	# Menu registration and ACL
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/usr/share/luci/menu.d/luci-app-dashboard.json \
	                $(1)$(LUCI_MENU_DIR)/luci-app-dashboard.json
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/usr/share/rpcd/acl.d/luci-app-dashboard.json \
	                $(1)$(RPCD_ACL_DIR)/luci-app-dashboard.json

	# rpcd ubus backend
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/usr/libexec/rpcd/dashboard \
	               $(1)$(RPCD_DIR)/dashboard

	$(INSTALL_DATA) $(PKG_BUILD_DIR)/usr/lib/lua/luci/dashboard_pkg/util.lua \
	                $(1)$(PKG_STORE)/util.lua
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/usr/lib/lua/luci/dashboard_pkg/collector.lua \
	                $(1)$(PKG_STORE)/collector.lua

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/etc/init.d/dashboard \
	               $(1)/etc/init.d/dashboard

	$(INSTALL_DIR)  $(1)/etc/config
	$(INSTALL_CONF) $(PKG_BUILD_DIR)/etc/config/dashboard \
	                $(1)/etc/config/dashboard

	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/usr/sbin/vnstat_backup \
	               $(1)/usr/sbin/vnstat_backup
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/usr/sbin/vnstat_restore \
	               $(1)/usr/sbin/vnstat_restore
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/usr/sbin/dashboard_monitor \
	               $(1)/usr/sbin/dashboard_monitor
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/usr/sbin/dashboard_collect \
	               $(1)/usr/sbin/dashboard_collect
endef

define Package/luci-app-dashboard/conffiles
/etc/config/dashboard
endef

define Package/luci-app-dashboard/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

rm -f /tmp/luci-indexcache /tmp/luci-modulecache /tmp/luci-*cache* 2>/dev/null || true

# a changed init script is only written as .apk-new by apk and as
# .opkg-new by opkg, both are the new file so we take it over
if [ -f /etc/init.d/dashboard.apk-new ]; then
	mv /etc/init.d/dashboard.apk-new /etc/init.d/dashboard
fi
if [ -f /etc/init.d/dashboard.opkg-new ]; then
	mv /etc/init.d/dashboard.opkg-new /etc/init.d/dashboard
fi

# during an upgrade we must not enable the service again, the user may
# have turned it off on purpose. default_postinst does the same.
if [ "$${PKG_UPGRADE}" != "1" ]; then
	/etc/init.d/dashboard enable 2>/dev/null || true
fi

# the static assets are unpacked to ram at start, so a restart is needed
# to pick up the new ones
/etc/init.d/dashboard restart 2>/dev/null || true

/etc/init.d/rpcd restart 2>/dev/null || true

exit 0
endef

define Package/luci-app-dashboard/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

# During upgrade, do nothing — postinst of the new version handles everything
[ "$${PKG_UPGRADE}" = "1" ] && exit 0

# Actual removal: stop service and clean up
/etc/init.d/dashboard stop 2>/dev/null || true

# Kill the on-demand collector daemon if running
if [ -f /tmp/dashboard/daemon.pid ]; then
    kill "$$(cat /tmp/dashboard/daemon.pid 2>/dev/null)" 2>/dev/null || true
    rm -f /tmp/dashboard/daemon.pid
fi

LOOP_PID="/tmp/vnstat_backup_loop.pid"
VNSTAT_DB_SRC="/tmp/lib/vnstat/vnstat.db"
VNSTAT_BACKUP_DIR="/etc/vnstat/backup"
VNSTAT_BACKUP_FILE="$${VNSTAT_BACKUP_DIR}/vnstat.db.gz"

if [ -f "$${LOOP_PID}" ]; then
    kill "$$(cat $${LOOP_PID} 2>/dev/null)" 2>/dev/null || true
    rm -f "$${LOOP_PID}"
fi

if command -v vnstatd > /dev/null 2>&1 && [ -s "$${VNSTAT_DB_SRC}" ]; then
    mkdir -p "$${VNSTAT_BACKUP_DIR}" 2>/dev/null
    tmp="$${VNSTAT_BACKUP_FILE}.tmp"
    if gzip -c "$${VNSTAT_DB_SRC}" > "$${tmp}" 2>/dev/null; then
        mv "$${tmp}" "$${VNSTAT_BACKUP_FILE}" 2>/dev/null \
            && logger -t dashboard "prerm: final backup OK" \
            || logger -t dashboard "prerm: final backup mv failed"
    else
        rm -f "$${tmp}"
        logger -t dashboard "prerm: final backup gzip failed"
    fi
fi

rm -f /tmp/luci-indexcache /tmp/luci-modulecache /tmp/luci-*cache* 2>/dev/null || true
rm -f /etc/rc.d/S65dashboard /etc/rc.d/K10dashboard 2>/dev/null || true
rm -rf /tmp/dashboard/downtime /tmp/dashboard/wan_down_time /tmp/dashboard/internet_down_time /tmp/dashboard/data.json /tmp/dashboard/heartbeat /tmp/dashboard/daemon.pid /tmp/dashboard/cache.json 2>/dev/null || true

exit 0
endef

define Package/luci-app-dashboard/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

# opkg/apk has already removed tracked files; clean up now-empty dirs.
rmdir /usr/share/ucode/luci/template/dashboard 2>/dev/null || true
rmdir /usr/lib/lua/luci/dashboard_pkg 2>/dev/null || true
rmdir /www/luci-static/resources/view/dashboard 2>/dev/null || true
rmdir /www/luci-static/resources/icons 2>/dev/null || true

rm -f /tmp/luci-indexcache /tmp/luci-modulecache /tmp/luci-*cache* 2>/dev/null || true

/etc/init.d/rpcd restart 2>/dev/null || true

exit 0
endef

$(eval $(call BuildPackage,luci-app-dashboard))
