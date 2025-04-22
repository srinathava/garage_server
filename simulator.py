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
        # Additional gate properties matching real controller
        if type == "gate":
            self.open_pos = 110  # Default from real controller
            self.close_pos = 20  # Default from real controller
            self.moving_until = None  # Timestamp when gate will finish moving

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
        # Subscribe to position setting commands
        self.client.subscribe("/setclosepos/#")
        self.client.subscribe("/setopenpos/#")
        # Subscribe to coordinator commands
        self.client.subscribe("/coordinator/0")

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        payload = msg.payload.decode('utf-8')
        
        if topic.startswith("/gatecmd/"):
            gate_id = topic.rsplit('/', 1)[1]
            if gate_id in self.gates:
                gate = self.gates[gate_id]
                self.client.publish(f'/gatelog/{gate_id}', f'Processing move command: {payload}')
                
                if payload in ("open", "close", "middle"):
                    # Check if already in position
                    if gate.status == payload:
                        self.client.publish(f'/gatelog/{gate_id}', f'Already at position {payload}')
                    else:
                        # Calculate target position
                        if payload == "open":
                            target_pos = gate.open_pos
                        elif payload == "close":
                            target_pos = gate.close_pos
                        else:  # middle
                            target_pos = (gate.open_pos + gate.close_pos) // 2
                            
                        # Set movement completion time (1 second from now)
                        gate.moving_until = datetime.now().timestamp() + 1.0
                        gate.status = payload
                        print(f"Gate {gate_id} moving to {payload} (pos: {target_pos})")
                    
                    # Send acknowledgment
                    self.client.publish(f"/gateack/{gate_id}", payload)
                else:
                    self.client.publish(f'/gatelog/{gate_id}', f'Unknown position {payload}')
        
        elif topic.startswith("/setclosepos/"):
            gate_id = topic.rsplit('/', 1)[1]
            if gate_id in self.gates:
                try:
                    pos = int(payload)
                    self.gates[gate_id].close_pos = pos
                    self.client.publish(f'/gatelog/{gate_id}', f'Setting close position to {pos}')
                except ValueError:
                    self.client.publish(f'/gatelog/{gate_id}', f'Invalid position value: {payload}')
        
        elif topic.startswith("/setopenpos/"):
            gate_id = topic.rsplit('/', 1)[1]
            if gate_id in self.gates:
                try:
                    pos = int(payload)
                    self.gates[gate_id].open_pos = pos
                    self.client.publish(f'/gatelog/{gate_id}', f'Setting open position to {pos}')
                except ValueError:
                    self.client.publish(f'/gatelog/{gate_id}', f'Invalid position value: {payload}')
        
        elif topic == "/coordinator/0":
            self.coordinator.status = payload
            print(f"Coordinator received command: {payload}")

    def send_heartbeats(self):
        while True:
            current_time = datetime.now().timestamp()
            
            for gate_id, gate in self.gates.items():
                # Check if gate has finished moving
                if gate.moving_until and current_time >= gate.moving_until:
                    gate.moving_until = None
                    self.client.publish(f'/gatelog/{gate_id}', f'Finished moving to {gate.status}')
                
                # Send enhanced heartbeat with position data
                heartbeat = {
                    "gatePos": gate.status,
                    "openPos": gate.open_pos,
                    "closePos": gate.close_pos
                }
                self.client.publish(f"/heartbeat/{gate_id}", json.dumps(heartbeat))
            
            time.sleep(3)  # Send heartbeat every 3 seconds like real controller

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