#!/usr/bin/env bash

sudo ./setup_hotspot.sh

sudo apt install -y mosquitto mosquitto-clients
sudo cp mosquitto.conf /etc/mosquitto/conf.d/user.conf
sudo systemctl enable mosquitto
sudo systemctl start mosquitto

# system site-packages because RPi.GPIO on pypi
# seems to be older than the one in the Raspbian repo!
python -m venv --system-site-packages .venv
source ./.venv/bin/activate
pip install -r requirements.txt
deactivate

sudo cp garage-server.service /etc/systemd/system
sudo systemctl daemon-reload
sudo systemctl enable garage-server.service
sudo systemctl start garage-server.service
