const TOOL_SENSOR_IDS = ['tablesaw', 'jointer', 'bandsaw', 'sander', 'drillpress'];

// Calibration slider configuration
const CALIBRATION_MIN = 0;
const CALIBRATION_MAX = 180;
const CALIBRATION_DEFAULT_CLOSE = 20;
const CALIBRATION_DEFAULT_OPEN = 110;

class UpdateStatus {
    constructor() {
        this.idMap = {};
        this.mqttClient = null;
        this.currentGateId = null;

        $('#templates').hide();
        
        // Create sections for organization
        $('#main').append('<div id="coordinator-section"></div>');
        $('#main').append('<div id="tools-section"><h2>Tools</h2></div>');
        $('#main').append('<div id="gates-section"><h2>Gates</h2></div>');

        this.setupModal();
        this.addStatus('0', 'coordinator', '#coordinator-section')

        for (let toolid of TOOL_SENSOR_IDS.sort()) {
            this.addStatus(toolid, 'tool', '#tools-section')
        }
    
        setInterval(() => this.updateStatus(), 3000);
    }

    setupModal() {
        // Close modal when clicking the X or outside the modal
        $('.close, .modal').click((e) => {
            if (e.target === e.currentTarget) {
                $('#gate-modal').hide();
                this.disconnectMqtt();
            }
        });

        // Prevent modal content clicks from closing the modal
        $('.modal-content').click((e) => e.stopPropagation());
        
        // Setup calibration sliders
        this.setupCalibrationControls();
    }
    
    setupCalibrationControls() {
        // Handle slider changes for close position
        $('#close-position').on('input', () => {
            const closeVal = parseInt($('#close-position').val());
            $('#close-position-value').text(closeVal);
            
            // Send calibration command immediately
            if (this.currentGateId) {
                this.sendCalibrationCmd(this.currentGateId, 'close', closeVal);
            }
        });
        
        // Handle slider changes for open position
        $('#open-position').on('input', () => {
            const openVal = parseInt($('#open-position').val());
            $('#open-position-value').text(openVal);
            
            // Send calibration command immediately
            if (this.currentGateId) {
                this.sendCalibrationCmd(this.currentGateId, 'open', openVal);
            }
        });
        
        // Handle +/- button clicks
        $('.adjust-btn').on('click', (event) => {
            const button = $(event.currentTarget);
            const targetId = button.data('target');
            const isPlus = button.hasClass('plus');
            const slider = $(`#${targetId}`);
            
            // Get current value
            let currentVal = parseInt(slider.val());
            
            // Adjust value
            if (isPlus) {
                currentVal = Math.min(currentVal + 1, CALIBRATION_MAX);
            } else {
                currentVal = Math.max(currentVal - 1, CALIBRATION_MIN);
            }
            
            // Update slider and display
            slider.val(currentVal);
            $(`#${targetId}-value`).text(currentVal);
            
            // Send calibration command
            if (this.currentGateId) {
                const type = targetId === 'close-position' ? 'close' : 'open';
                this.sendCalibrationCmd(this.currentGateId, type, currentVal);
            }
        });
    }

    showGateModal(gateId) {
        const modal = $('#gate-modal');
        modal.data('gateId', gateId);
        this.currentGateId = gateId;
        
        // Set up gate control buttons
        $('.gate-controls button').off('click').on('click', (event) => {
            this.sendGateCmd(gateId, event.target.id.toLowerCase());
        });
        
        // Set up flash button
        $('#flash-button').off('click').on('click', () => {
            this.sendFlashCmd(gateId);
        });
        
        // Configure sliders with min, max, and default values
        const closeSlider = $('#close-position');
        const openSlider = $('#open-position');
        
        // Set min and max attributes
        closeSlider.attr('min', CALIBRATION_MIN);
        closeSlider.attr('max', CALIBRATION_MAX);
        openSlider.attr('min', CALIBRATION_MIN);
        openSlider.attr('max', CALIBRATION_MAX);
        
        // Set default values
        closeSlider.val(CALIBRATION_DEFAULT_CLOSE);
        $('#close-position-value').text(CALIBRATION_DEFAULT_CLOSE);
        openSlider.val(CALIBRATION_DEFAULT_OPEN);
        $('#open-position-value').text(CALIBRATION_DEFAULT_OPEN);
        
        modal.show();
        
        // Clear previous logs
        $('#gate-logs-content').text('Loading logs...');
        
        // Connect to MQTT and subscribe to gate logs
        this.connectMqtt(gateId);
    }
    
    sendCalibrationCmd(gateId, type, position) {
        if (!this.mqttClient || !this.mqttClient.isConnected()) {
            console.error("MQTT client not connected");
            return;
        }
        
        try {
            const topic = type === 'open' ? `/setopenpos/${gateId}` : `/setclosepos/${gateId}`;
            const message = new Paho.MQTT.Message(position.toString());
            message.destinationName = topic;
            this.mqttClient.send(message);
        } catch (error) {
            console.error("Error sending calibration command:", error);
            $('#gate-logs-content').append('\nError sending calibration command: ' + error.message);
        }
    }
    
    sendFlashCmd(gateId) {
        if (!this.mqttClient || !this.mqttClient.isConnected()) {
            console.error("MQTT client not connected");
            return;
        }
        
        try {
            const topic = `/flash/${gateId}`;
            const message = new Paho.MQTT.Message("");
            message.destinationName = topic;
            this.mqttClient.send(message);
            
            // Add feedback to logs
            const logMessage = `Sent flash command to gate ${gateId}`;
            $('#gate-logs-content').append('\n' + logMessage);
            
            // Auto-scroll to bottom
            const preElement = document.getElementById('gate-logs-content');
            preElement.scrollTop = preElement.scrollHeight;
        } catch (error) {
            console.error("Error sending flash command:", error);
            $('#gate-logs-content').append('\nError sending flash command: ' + error.message);
        }
    }
    
    connectMqtt(gateId) {
        this.disconnectMqtt(); // Disconnect any existing connection
        this.currentGateId = gateId;
        
        try {
            // Create a client instance
            const clientId = "garage_status_" + Math.random().toString(16).substr(2, 8);
            this.mqttClient = new Paho.MQTT.Client(
                window.location.hostname, // Same host as the web server
                9001, // MQTT websocket port
                clientId
            );
            
            // Set callback handlers
            this.mqttClient.onConnectionLost = this.onMqttConnectionLost.bind(this);
            this.mqttClient.onMessageArrived = this.onMqttMessageArrived.bind(this);
            
            // Connect the client
            this.mqttClient.connect({
                onSuccess: () => {
                    console.log("MQTT Connected");
                    // Subscribe to the gate log topic
                    const topic = `/gatelog/${gateId}`;
                    this.mqttClient.subscribe(topic);
                    $('#gate-logs-content').text('Connected to log stream...');
                },
                onFailure: (e) => {
                    console.error("MQTT Connection failed: ", e);
                    $('#gate-logs-content').text('Failed to connect to log stream.');
                }
            });
        } catch (error) {
            console.error("MQTT setup error:", error);
            $('#gate-logs-content').text('Error setting up log connection.');
        }
    }
    
    disconnectMqtt() {
        if (this.mqttClient && this.mqttClient.isConnected()) {
            try {
                if (this.currentGateId) {
                    const topic = `/gatelog/${this.currentGateId}`;
                    this.mqttClient.unsubscribe(topic);
                }
                this.mqttClient.disconnect();
                console.log("MQTT Disconnected");
            } catch (error) {
                console.error("MQTT disconnect error:", error);
            }
        }
        this.mqttClient = null;
        this.currentGateId = null;
    }
    
    onMqttConnectionLost(responseObject) {
        if (responseObject.errorCode !== 0) {
            console.log("MQTT Connection Lost: " + responseObject.errorMessage);
            $('#gate-logs-content').append('\nConnection to log stream lost.');
        }
    }
    
    onMqttMessageArrived(message) {
        const logMessage = message.payloadString;
        const currentContent = $('#gate-logs-content').text();
        
        // If it's the loading message, replace it, otherwise append
        if (currentContent === 'Loading logs...' || currentContent === 'Connected to log stream...') {
            $('#gate-logs-content').text(logMessage);
        } else {
            // Append new log message with a newline
            $('#gate-logs-content').append('\n' + logMessage);
            
            // Auto-scroll to bottom
            const preElement = document.getElementById('gate-logs-content');
            preElement.scrollTop = preElement.scrollHeight;
        }
    }

    addStatus(id, klass, section) {
        let status = $('#templates .' + klass).clone();
    
        $(status).data('id', id);
        $('#id', status).text(id);
        
        if (klass === 'gate') {
            // For gates, insert in numeric order
            let inserted = false;
            $('#gates-section .gate').each(function() {
                const existingId = $(this).data('id');
                if (parseInt(id) < parseInt(existingId)) {
                    $(this).before(status);
                    inserted = true;
                    return false; // break the loop
                }
            });
            if (!inserted) {
                $(section).append(status);
            }

            // Add click handler for the control button
            $('.control-btn', status).click(() => this.showGateModal(id));
        } else {
            $(section).append(status);
        }
        
        $(status).hide();

        this.idMap[id] = status;
        return status;
    }

    sendGateCmd(gateid, gatecmd) {
        fetch('/gatecmd/' + gateid + '/' + gatecmd);
    }

    async updateStatus() {
        let response = await fetch("/status")
        let statusMap = await response.json()
        console.log(statusMap);
    
        // Sort entries, handling numeric gate IDs properly
        const entries = Object.entries(statusMap);
        const sortedEntries = entries.sort((a, b) => {
            // Skip sorting for coordinator and tools
            if (a[0] === '0' || b[0] === '0') return 0;
            if (TOOL_SENSOR_IDS.includes(a[0]) || TOOL_SENSOR_IDS.includes(b[0])) return 0;
            // Numeric sort for gates
            return parseInt(a[0]) - parseInt(b[0]);
        });

        for (const [id, status] of sortedEntries) {
            let statusDom = this.idMap[id];

            if (statusDom === undefined) {
                statusDom = this.addStatus(id, 'gate', '#gates-section');
            }

            $(statusDom).removeClass('unknown');
            $(statusDom).removeClass('alive');
            $(statusDom).removeClass('dead');
 
            if (status.alive) {
                $(statusDom).show();
                $(statusDom).addClass('alive');
                $('button', statusDom).prop('disabled', false);
                $('#id', statusDom).html('' + id + ' (' + status.status + ')');
            } else {
                $(statusDom).show();
                $(statusDom).addClass('dead');
                $('button', statusDom).prop('disabled', true);
                $('#id', statusDom).html('' + id);
            }
        }
    }
}

$(function() {
    var updater = new UpdateStatus();
});
