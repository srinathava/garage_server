from flask import Flask, jsonify, redirect
import paho.mqtt.client as mqtt
from datetime import datetime
import json
import threading
import time

app = Flask(__name__, static_folder="static")

# Configuration matching app.py
TOOL_SENSOR_IDS = ['tablesaw', 'jointer', 'bandsaw', 'sander']
GATES_FOR_TOOLS = {
    'tablesaw': ['6'],
    'jointer': ['5', '1'],
    'bandsaw': ['5', '4'],
    'sander': ['5', '7']
}

# Get unique gate IDs
GATE_IDS = sorted(list(set(sum(GATES_FOR_TOOLS.values(), []))))

class VirtualDevice:
    def __init__(self, id, type):
        self.id = id
        self.type = type
        self.status = "off" if type == "tool" else "close"
        self.last_heartbeat = datetime.now() if type == "gate" else None

class Simulator:
    def __init__(self):
        # Setup MQTT client
        self.client = mqtt.Client()
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        
        # Initialize virtual devices
        self.tools = {id: VirtualDevice(id, "tool") for id in TOOL_SENSOR_IDS}
        self.gates = {id: VirtualDevice(id, "gate") for id in GATE_IDS}
        self.coordinator = VirtualDevice("0", "coordinator")
        
        # Connect to MQTT broker
        self.client.connect("127.0.0.1", 1883, 60)
        self.client.loop_start()
        
        # Start heartbeat thread
        self.heartbeat_thread = threading.Thread(target=self.send_heartbeats, daemon=True)
        self.heartbeat_thread.start()

    def on_connect(self, client, userdata, flags, rc):
        print("Connected to MQTT broker")
        # Subscribe to gate commands
        self.client.subscribe("/gatecmd/#")
        # Subscribe to coordinator commands
        self.client.subscribe("/coordinator/0")

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        payload = msg.payload.decode('utf-8')
        
        if topic.startswith("/gatecmd/"):
            gate_id = topic.rsplit('/', 1)[1]
            if gate_id in self.gates:
                self.client.publish(f'/gatelog/{gate_id}', f'Processing move command {payload}')
                if payload in ("open", "close", "middle"):
                    # Send acknowledgment
                    self.client.publish(f"/gateack/{gate_id}", payload)
                    print(f"Gate {gate_id} changed to {payload}")
                    self.gates[gate_id].status = payload
                else:
                    self.client.publish(f'/gatelog/{gate_id}', f'Unknown position {payload}')
        
        elif topic == "/coordinator/0":
            self.coordinator.status = payload
            print(f"Coordinator received command: {payload}")

    def send_heartbeats(self):
        while True:
            for gate_id, gate in self.gates.items():
                heartbeat = {
                    "gatePos": gate.status
                }
                self.client.publish(f"/heartbeat/{gate_id}", json.dumps(heartbeat))
            time.sleep(30)  # Send heartbeat every 30 seconds

    def toggle_tool(self, tool_id):
        if tool_id in self.tools:
            tool = self.tools[tool_id]
            tool.status = "on" if tool.status == "off" else "off"
            self.client.publish(f"/tool_sensor/{tool_id}", tool.status)
            return {"status": "success", "new_state": tool.status}
        return {"status": "error", "message": "Tool not found"}

    def get_status(self):
        return {
            "tools": {id: vars(tool) for id, tool in self.tools.items()},
            "gates": {id: vars(gate) for id, gate in self.gates.items()},
            "coordinator": vars(self.coordinator)
        }

# Create simulator instance
simulator = Simulator()

@app.route('/')
def index():
    return redirect("/static/simulator.html")

@app.route('/simulator/status')
def status():
    return jsonify(simulator.get_status())

@app.route('/simulator/toggle/<tool_id>')
def toggle_tool(tool_id):
    return jsonify(simulator.toggle_tool(tool_id))

if __name__ == '__main__':
    app.run(port=5001)  # Run on different port than main app