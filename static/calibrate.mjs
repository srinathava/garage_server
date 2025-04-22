// Calibration constants
const CALIBRATION_MIN = 0;
const CALIBRATION_MAX = 180;

import { MqttHandler } from './mqtt_handler.mjs'; // Import the new handler

export class Calibrator {
    constructor(updateStatusInstance) {
        this.updateStatus = updateStatusInstance; // Reference to the main class instance
        // this.mqttClient = null; // Removed - Handled by MqttHandler
        this.mqttHandler = new MqttHandler(); // Instantiate MqttHandler
        this.currentGateId = null; // Keep track of the gate ID for the modal context, not MQTT state

        this.setupModal(); // Setup modal listeners and controls
    }

    // Helper to validate input values
    validateInput(val) {
        if (isNaN(val)) {
            val = CALIBRATION_MIN;
        } else {
            val = Math.max(CALIBRATION_MIN, Math.min(val, CALIBRATION_MAX));
        }
        return val;
    }

    // Sets up the modal behavior (close, clicks) and calibration controls
    setupModal() {
        // Close modal when clicking the X or outside the modal
        $('.close, .modal').click((e) => {
            if (e.target === e.currentTarget) {
                $('#gate-modal').hide();
                this.mqttHandler.disconnect(); // Use MqttHandler to disconnect
            }
        });

        // Prevent modal content clicks from closing the modal
        $('.modal-content').click((e) => e.stopPropagation());

        // Setup calibration input/button controls
        this.setupCalibrationControls();
    }


    // Sets up event handlers for calibration controls (inputs and buttons)
    setupCalibrationControls() {
        const handlePositionChange = (prefix) => {
            const inputElement = $(`#${prefix}-position`);
            const rawValue = inputElement.val();
            const validatedValue = this.validateInput(parseInt(rawValue));

            inputElement.val(validatedValue);
            $(`#${prefix}-position-value`).text(validatedValue);

            // Use this.currentGateId directly now
            // Use this.currentGateId for context, send command via MqttHandler
            if (this.currentGateId) {
                this.sendCalibrationCmd(this.currentGateId, prefix, validatedValue);
            }
        };

        // Attach event handlers for position inputs
        $('#close-position').on('change', () => handlePositionChange('close'));
        $('#open-position').on('change', () => handlePositionChange('open'));

        // Handle +/- button clicks
        $('.adjust-btn').on('click', (event) => {
            const button = $(event.currentTarget);
            const targetId = button.data('target');
            const isPlus = button.hasClass('plus');
            const input = $(`#${targetId}`);

            let currentVal = parseInt(input.val());
            if (isNaN(currentVal)) {
                currentVal = CALIBRATION_MIN;
            }

            if (isPlus) {
                currentVal = Math.min(currentVal + 1, CALIBRATION_MAX);
            } else {
                currentVal = Math.max(currentVal - 1, CALIBRATION_MIN);
            }

            input.val(currentVal);
            $(`#${targetId}-value`).text(currentVal);

            // Use this.currentGateId directly now
            // Use this.currentGateId for context, send command via MqttHandler
            if (this.currentGateId) {
                const type = targetId === 'close-position' ? 'close' : 'open';
                this.sendCalibrationCmd(this.currentGateId, type, currentVal);
            }
        });
    }

    // Shows the gate modal, sets up controls, and connects MQTT
    showGateModal(gateId) {
        // Access statusMap via updateStatus instance
        const status = this.updateStatus.statusMap[gateId];
        if (!status || status.json.openPos === undefined) {
            alert(`Status or calibration data not found for gate ${gateId}.`);
            return;
        }
        const modal = $('#gate-modal');
        modal.data('gateId', gateId);
        this.currentGateId = gateId; // Set currentGateId here

        // Set up gate control buttons (calls method on updateStatus instance)
        $('.gate-controls button').off('click').on('click', (event) => {
            this.updateStatus.sendGateCmd(gateId, event.target.id.toLowerCase());
        });

        // Set up flash button (calls method within this class)
        $('#flash-button').off('click').on('click', () => {
            this.sendFlashCmd(gateId);
        });

        // Set initial calibration values
        this.setInitialCalibrationValues(gateId);
        modal.show();

        // Clear previous logs
        $('#gate-logs-content').text('Loading logs...');

        // Connect MQTT using the handler
        this.mqttHandler.connect(gateId);
    }


    // Sets the initial values for calibration inputs in the modal
    setInitialCalibrationValues(gateId) {
        // Access statusMap via updateStatus instance
        const status = this.updateStatus.statusMap[gateId];

        const closeInput = $('#close-position');
        const openInput = $('#open-position');
        const closePos = status.json.closePos;
        const openPos = status.json.openPos;

        closeInput.val(closePos);
        $('#close-position-value').text(closePos);
        openInput.val(openPos);
        $('#open-position-value').text(openPos);
    }

    // Sends calibration commands via MQTT
    sendCalibrationCmd(gateId, type, position) {
        // Use MqttHandler to send command
        const topic = type === 'open' ? `/setopenpos/${gateId}` : `/setclosepos/${gateId}`;
        const success = this.mqttHandler.sendCommand(topic, position);

        if (success) {
            // Log success locally if needed, MqttHandler already logs errors/connection issues
            this.mqttHandler._updateLog(`[DEBUG] Sent ${type} position: ${position}`); // Use internal log update method
        }
    }
    // Removed try-catch block as sendCommand handles it

    // Sends flash command via MQTT
    sendFlashCmd(gateId) {
        // Use MqttHandler to send command
        const topic = `/flash/${gateId}`;
        const success = this.mqttHandler.sendCommand(topic, "");

        if (success) {
            // Log success locally
            const logMessage = `[DEBUG] Sent flash command to gate ${gateId}`;
            this.mqttHandler._updateLog(logMessage); // Use internal log update method
        }
    }
}