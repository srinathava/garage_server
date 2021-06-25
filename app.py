import os
from flask import Flask, Response
from flask import send_file
from flask import request
import paho.mqtt.client as mqtt
from datetime import datetime, timedelta
from flask_apscheduler import APScheduler
import json
import asyncio
from json import JSONEncoder

app = Flask(__name__, static_folder="static")

scheduler = APScheduler()
scheduler.api_enabled = True
scheduler.init_app(app)
scheduler.start()

GATE_IDS = ['0', '1', '2', '3', '4', '5', '6', '7']
TOOL_SENSOR_IDS = ['tablesaw']
GATE_MAX_KEEPALIVE = timedelta(minutes=1)

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

        self.idToStatusMap = {}
        for id in GATE_IDS:
            self.idToStatusMap[id] = GateStatus(id)
        for id in TOOL_SENSOR_IDS:
            self.idToStatusMap[id] = ToolSensorStatus(id)

        self.client.connect("192.168.1.3", 1883, 60)
        self.client.loop_start()

    def on_connect(self, client, userdata, flags, rc):
        print("Connected to MQTT broker")
        self.client.subscribe("/gateack/#")
        self.client.subscribe("/gatecmd/#")
        self.client.subscribe("/heartbeat/#")
        self.client.subscribe("/tool_sensor/#")
        self.client.subscribe("/wait")
        self.client.subscribe("/ack")

    def gateid(self, topic):
        # All our topics to gates are of the form "/gatecmd/1". 
        # Hence we split once from the right on / and return the 
        # second token.
        return topic.rsplit('/', 1)[1]

    def onHeartbeat(self, msg):
        gateid = msg.topic.rsplit("/", 1)[1]
        payload = msg.payload.decode('utf-8')
        # print(f"Processing heartbeat message from {gateid}: {payload}")

        status = self.idToStatusMap[gateid]
        status.alive = True
        status.lastTickTime = datetime.now()

        try:
            msgJson = json.loads(payload)
        except json.decoder.JSONDecodeError:
            return

        if gateid == '0':
            return

        if gateid in GATE_IDS:
            status.status = msgJson['gatePos']
            
    def updateStatuses(self):
        # print("Updating gate status")
        now = datetime.now()
        for (gateid, status) in self.idToStatusMap.items():
            if now - status.lastTickTime > GATE_MAX_KEEPALIVE:
                status.alive = False

    def onToolSensor(self, msg):
        toolid = msg.topic.rsplit("/", 1)[1]
        status = self.idToStatusMap[toolid]

        payload = msg.payload.decode('utf-8')
        status.status = payload

    def switchToTool(self, toolid):
        gateids = self.gatesForTool[toolid]
        for gateid in GATE_IDS:
            gate = self.idToStatusMap[gateid]
            if not gate.alive:
                continue
            if gateid in gateids:
                self.gatecmd(gateid, "open")
            else:
                self.gatecmd(gateid, "close")

    async def wait_for_ack(self):
        print("Starting wait for ack")
        self.pendingFuture = asyncio.Future()
        await self.pendingFuture
        print("Done with wait")

    def on_ack(self):
        if self.pendingFuture:
            print("processing ack")
            self.pendingFuture.set_result(True)

    def on_message(self, client, userdata, msg):
        if msg.topic.startswith("/heartbeat"):
            self.onHeartbeat(msg)
        elif msg.topic.startswith("/tool_sensor"):
            self.onToolSensor(msg)
        elif msg.topic.startswith("/wait"):
            print("Processing wait")
            asyncio.run_coroutine_threadsafe(self.wait_for_ack())
        elif msg.topic.startswith("/ack"):
            print("Processing ack")
            self.on_ack()

    def gatecmd(self, gateid, gatecmd):
        print(f"Publishing message /gatecmd/{gateid} {gatecmd}")
        self.client.publish("/gatecmd/" + gateid, gatecmd)

mqtt = MqttClient()

@scheduler.task('interval', seconds=10)
def updateStatuses():
    mqtt.updateStatuses()

@app.route("/")
def hello_world():
    return "<p>Hello, World!</p>"

class MyEncoder(JSONEncoder):
    def default(self, o):
        if isinstance(o, datetime):
            return str(o)
        return o.__dict__

@app.route("/status")
def gate_status():
    str = json.dumps(mqtt.idToStatusMap, cls=MyEncoder)
    return Response(str, mimetype='application/json')

@app.route("/update/<gateid>")
def update(gateid=''):
    print("Getting to update")
    md5HeaderName = 'X-Esp8266-Sketch-Md5'
    if not md5HeaderName in request.headers:
        return Response("Only for ESP8266", status=404)

    md5File = f'firmware/firmware.md5'
    binFile = f'firmware/firmware.bin'
    if not os.path.exists(md5File):
        return Response("No update found", status=304)

    md5 = open(md5File).read().split()[0]
    if md5 == request.headers[md5HeaderName]:
        return Response("No update found", status=304)
    else:
        print("Proving update")
        return send_file(binFile, mimetype="application/octet-stream")

@app.route("/gatecmd/<gateid>/<gatecmd>")
def gatecmd(gateid, gatecmd):
    mqtt.gatecmd(gateid, gatecmd)
    return "ok"

if __name__ == '__main__':
    app.run()
