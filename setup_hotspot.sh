#!/bin/sh

# Delete any existing Hotspot connection
nmcli con delete Hotspot

# Create the hotspot with basic settings
nmcli device wifi hotspot ifname wlan1 \
	ssid GaragePiNetwork \
	password MapleOakWood \
	con-name Hotspot \
	band bg channel 1

# Customize IP and enable autoconnect
nmcli con mod Hotspot \
    ipv4.method shared \
    ipv4.addresses 192.168.4.1/24 \
    autoconnect yes

# Activate the connection
nmcli con up Hotspot