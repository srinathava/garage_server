#!/usr/bin/env bash

# Need to run this as sudo
if [ $USER != "root" ]; then
    echo "Need to run install.sh as root."
    exit 1
fi
cp garage-server.service /etc/systemd/system
systemctl daemon-reload
systemctl enable garage-server.service
systemctl start garage-server.service
