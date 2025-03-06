from flask import Flask, Response
from flask import redirect
import paho.mqtt.client as mqtt
from datetime import datetime, timedelta
from flask_apscheduler import APScheduler
import json
from json import JSONEncoder
import time
import threading

app = Flask(__name__, static_folder="static")

scheduler = APScheduler()
scheduler.api_enabled = True
scheduler.init_app(app)
scheduler.start()

TOOL_SENSOR_IDS = ['tablesaw', 'jointer', 'bandsaw', 'sander']
GATE_MAX_KEEPALIVE = timedelta(minutes=1)

GATES_FOR_TOOLS = {
    'tablesaw': ['6'],
    'jointer': ['5', '1'],
    'bandsaw': ['5', '4'],
    'sander': ['5', '7']
}
GATE_FOR_MANUAL = '10'

class Status:
    def __init__(self, id):
        self.id = id
        self.alive = False
        self.lastTickTime = datetime.min
        self.status = '?'

class GateStatus(Status):
    def __init__(self, id):
        super().__init__(id)

class ToolSensorStatus(Status):
    def __init__(self, id):
        super().__init__(id)

class MqttClient:
    def __init__(self):
        self.client = mqtt.Client()
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message

        self.pendingFuture = None

        self.idToStatusMap = {'0': Status('0')}
        for id in TOOL_SENSOR_IDS:
            tool = ToolSensorStatus(id)
            tool.status = 'off'
            self.idToStatusMap[id] = tool

        self.client.connect("127.0.0.1", 1883, 60)
        self.client.loop_start()

    def on_connect(self, *_):
        print("Connected to MQTT broker")
        self.client.subscribe("/gateack/#")
        self.client.subscribe("/gatecmd/#")
        self.client.subscribe("/heartbeat/#")
        self.client.subscribe("/tool_sensor/#")
        self.client.subscribe("/coordinator_keypress/#")

    def gateid(self, topic):
        # All our topics to gates are of the form "/gatecmd/1". Hence we split
        # once from the right on / and return the second token.
        return topic.rsplit('/', 1)[1]

    def onHeartbeat(self, msg):
        gateid = msg.topic.rsplit("/", 1)[1]
        payload = msg.payload.decode('utf-8')
        # print(f"Processing heartbeat message from {gateid}: {payload}")

        status = self.idToStatusMap.get(gateid)
        if status is None:
            status = GateStatus(gateid)
            self.idToStatusMap[gateid] = status

        status.alive = True
        status.lastTickTime = datetime.now()

        try:
            msgJson = json.loads(payload)
        except json.decoder.JSONDecodeError:
            return

        if gateid == '0':
            return

        if gateid not in TOOL_SENSOR_IDS:
            status.status = msgJson['gatePos']
            
    def updateStatuses(self):
        # print("Updating gate status")
        now = datetime.now()
        for (_, status) in self.idToStatusMap.items():
            if now - status.lastTickTime > GATE_MAX_KEEPALIVE:
                status.alive = False

    def onStatusUpdate(self, msg) -> Status:
        id = msg.topic.rsplit("/", 1)[1]
        status = self.idToStatusMap[id]

        payload = msg.payload.decode('utf-8')
        status.status = payload
        return status

    def isSwitchedToTool(self, toolid):
        gateids = GATES_FOR_TOOLS[toolid]

        for (gateid, gate) in self.idToStatusMap.items():
            if not gate.alive or not self.isGate(gateid):
                continue

            shouldOpen = gateid in gateids
            isOpen = gate.status == "open"
            isClosed = gate.status == "close"

            if shouldOpen and not isOpen:
                print(f"{gateid} should be open but its not")
                return False
            
            if not shouldOpen and not isClosed:
                print(f"{gateid} should be closed but its not")
                return False

        return True

    def isGate(self, id):
        return id != '0' and id not in TOOL_SENSOR_IDS

    def switchToTool(self, toolid):
        gateids = GATES_FOR_TOOLS[toolid]
        for (gateid, gate) in self.idToStatusMap.items():
            gate = self.idToStatusMap[gateid]
            if not gate.alive or not self.isGate(gateid):
                continue

            if gateid in gateids:
                self.gatecmd(gateid, "open")
            else:
                self.gatecmd(gateid, "close")

        # Horrible busy loop kind of way of doing it. Unfortunately, it looks 
        # like incorporating async/await with paho-mqtt is a very non-trivial 
        # undertaking :( 
        n = 0
        while not self.isSwitchedToTool(toolid):
            time.sleep(0.1)
            n += 1
            if n > 20:
                return

        print("Telling coordinator to turn on DC")
        time.sleep(0.2)
        self.client.publish("/coordinator/0", "dc_on")

    def onToolSensor(self, msg):
        print("Getting tool sensor message")
        status = self.onStatusUpdate(msg)
        print(f"Tool {status.id} was switched {status.status}")
        if status.status == "on":
            # We need to do this on a separate thread otherwise the MQTT thread
            # which processes incoming messages is blocked and we do not receive
            # the /gateack messages
            t = threading.Thread(target=self.switchToTool, args=(status.id,))
            t.start()
        else:
            print("Telling coordinator to turn off DC")
            self.client.publish("/coordinator/0", "dc_off")

    def onCoordinatorKeyPress(self, msg):
        key = msg.payload.decode('utf-8')
        print(f"onCoordinatorKeyPress: key = {key}")
        if key == 'E':
            for (gateid, status) in self.idToStatusMap.items():
                if not status.alive:
                    continue
                if gateid == GATE_FOR_MANUAL:
                    self.gatecmd(gateid, "open")
                else:
                    self.gatecmd(gateid, "close")

    def on_message(self, client, userdata, msg):
        if msg.topic.startswith("/heartbeat"):
            self.onHeartbeat(msg)
        elif msg.topic.startswith("/tool_sensor"):
            self.onToolSensor(msg)
        elif msg.topic.startswith("/gateack"):
            print("Processing gate acknowledgement")
            status = self.onStatusUpdate(msg)
            print(f"Gate {status.id} is {status.status}")
        elif msg.topic.startswith("/coordinator_keypress"):
            self.onCoordinatorKeyPress(msg)

    def gatecmd(self, gateid, gatecmd):
        print(f"Publishing message /gatecmd/{gateid} {gatecmd}")
        self.client.publish("/gatecmd/" + gateid, gatecmd)

mqtt_client = MqttClient()

@scheduler.task('interval', seconds=10)
def updateStatuses():
    mqtt_client.updateStatuses()

@app.route("/")
def index():
    return redirect("static/status.html")

class MyEncoder(JSONEncoder):
    def default(self, o):
        if isinstance(o, datetime):
            return str(o)
        return o.__dict__

@app.route("/status")
def gate_status():
    str = json.dumps(mqtt_client.idToStatusMap, cls=MyEncoder)
    return Response(str, mimetype='application/json')

@app.route("/gatecmd/<gateid>/<gatecmd>")
def gatecmd(gateid, gatecmd):
    mqtt_client.gatecmd(gateid, gatecmd)
    return "ok"

if __name__ == '__main__':
    app.run()
