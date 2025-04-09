export class MqttHandler {
    constructor(logElementId = 'gate-logs-content') {
        this.mqttClient = null;
        this.currentGateId = null;
        this.logElementId = logElementId; // ID of the element to display logs
        this.logElement = document.getElementById(this.logElementId); // Cache the element
    }

    isConnected() {
        return this.mqttClient && this.mqttClient.isConnected();
    }

    // Appends or sets text in the log element and scrolls to bottom
    _updateLog(text, replace = false) {
        if (!this.logElement) {
            // Try to find the element again if it wasn't found initially
            this.logElement = document.getElementById(this.logElementId);
            if (!this.logElement) {
                console.error(`Log element with ID '${this.logElementId}' not found.`);
                return;
            }
        }
        const currentContent = this.logElement.textContent;
        if (replace || currentContent === 'Loading logs...' || currentContent === 'Connected to log stream...') {
            this.logElement.textContent = text;
        } else {
            // Append with newline
            this.logElement.textContent += '\n' + text;
        }
        // Auto-scroll to bottom
        this.logElement.scrollTop = this.logElement.scrollHeight;
    }

    // Connects to MQTT broker and subscribes to logs for a specific gate
    connect(gateId) {
        this.disconnect(); // Disconnect any existing connection
        this.currentGateId = gateId; // Ensure currentGateId is set

        try {
            const clientId = "garage_mqtt_" + Math.random().toString(16).substr(2, 8);
            this.mqttClient = new Paho.MQTT.Client(
                window.location.hostname, // Same host as the web server
                9001, // MQTT websocket port
                clientId
            );

            // Set callback handlers
            this.mqttClient.onConnectionLost = this._onConnectionLost.bind(this);
            this.mqttClient.onMessageArrived = this._onMessageArrived.bind(this);

            // Connect the client
            this.mqttClient.connect({
                onSuccess: () => {
                    console.log(`MQTT Connected for gate ${gateId}`);
                    // Subscribe to the gate log topic
                    const topic = `/gatelog/${gateId}`;
                    this.mqttClient.subscribe(topic);
                    this._updateLog('Connected to log stream...', true); // Replace loading message
                },
                onFailure: (e) => {
                    console.error("MQTT Connection failed: ", e);
                    this._updateLog('Failed to connect to log stream.');
                }
            });
        } catch (error) {
            console.error("MQTT setup error:", error);
            this._updateLog('Error setting up log connection.');
        }
    }

    // Disconnects from MQTT broker
    disconnect() {
        if (this.mqttClient && this.mqttClient.isConnected()) {
            try {
                if (this.currentGateId) {
                    const topic = `/gatelog/${this.currentGateId}`;
                    this.mqttClient.unsubscribe(topic);
                    console.log(`Unsubscribed from ${topic}`);
                }
                this.mqttClient.disconnect();
                console.log("MQTT Disconnected");
            } catch (error) {
                console.error("MQTT disconnect error:", error);
            }
        }
        this.mqttClient = null;
        this.currentGateId = null; // Clear gate ID on disconnect
    }

    // Handles MQTT connection loss
    _onConnectionLost(responseObject) {
        if (responseObject.errorCode !== 0) {
            console.log("MQTT Connection Lost: " + responseObject.errorMessage);
            this._updateLog('Connection to log stream lost.');
        }
        // Attempt to reconnect? Maybe add later if needed.
        this.mqttClient = null; // Ensure client state is updated
        this.currentGateId = null;
    }

    // Handles incoming MQTT messages (logs)
    _onMessageArrived(message) {
        const logMessage = message.payloadString;
        this._updateLog(logMessage); // Append the log message
    }

    // Sends a command via MQTT
    sendCommand(topic, payload = "") {
        if (!this.isConnected()) {
            console.error("MQTT client not connected. Cannot send command.");
            this._updateLog('Error: MQTT client not connected.');
            return false; // Indicate failure
        }

        try {
            const message = new Paho.MQTT.Message(payload.toString());
            message.destinationName = topic;
            this.mqttClient.send(message);
            console.log(`Sent MQTT command: ${topic} = ${payload}`);
            // Optionally log the sent command itself
            // this._updateLog(`Sent command: ${topic} = ${payload}`);
            return true; // Indicate success
        } catch (error) {
            console.error(`Error sending MQTT command to ${topic}:`, error);
            this._updateLog(`Error sending command to ${topic}: ${error.message}`);
            return false; // Indicate failure
        }
    }
}