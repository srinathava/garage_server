## First time setup

Run the installation script to set up the necessary components:

```bash
./install.sh
```

This script performs the following actions:

1.  **Sets up a Wi-Fi hotspot:** Executes `./setup_hotspot.sh` to configure the Raspberry Pi as a wireless access point (requires `sudo`).
2.  **Installs and configures Mosquitto MQTT broker:**
    *   Installs the `mosquitto` and `mosquitto-clients` packages using `apt` (requires `sudo`).
    *   Copies the provided `mosquitto.conf` to `/etc/mosquitto/conf.d/user.conf` (requires `sudo`).
    *   Enables and starts the `mosquitto` systemd service (requires `sudo`).
3.  **Sets up a Python virtual environment:**
    *   Creates a virtual environment in the `.venv` directory using `python -m venv`.
    *   Installs the required Python packages listed in `requirements.txt` into the virtual environment using `pip`.
4.  **Installs and starts the Garage Server service:**
    *   Copies the `garage-server.service` file to `/etc/systemd/system` (requires `sudo`).
    *   Reloads the systemd daemon to recognize the new service (requires `sudo`).
    *   Enables the `garage-server.service` to start automatically on boot (requires `sudo`).
    *   Starts the `garage-server.service` immediately (requires `sudo`).

After running the script, the garage server application and its dependencies should be installed and running.