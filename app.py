from flask import Flask, Response
from flask import redirect, request
import paho.mqtt.client as mqtt
from datetime import datetime, timedelta
from flask_apscheduler import APScheduler
import json
from json import JSONEncoder
import time
import threading
import os
import sys
import pandas as pd
from datetime import datetime
import re

# Setup logging
import logging

# Create a custom logger for app.py
logger = logging.getLogger('app.py')
logger.setLevel(logging.INFO)
# Prevent logger from propagating messages to parent loggers (like Flask's root logger)
logger.propagate = False

# Create handler and set its properties
handler = logging.StreamHandler()
handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)

# Add handler to logger
logger.addHandler(handler)

# Disable excessive logging from Flask and Werkzeug
logging.getLogger('werkzeug').setLevel(logging.ERROR)

def logMsg(message, level=logging.INFO):
    """Centralized logging function for consistent log formatting"""
    logger.log(level, message)

# Setup influxdb client for data storage
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

# InfluxDB configuration
INFLUX_URL = "http://localhost:8086"  # Host-side access
INFLUX_TOKEN = "AirQualityToken"  # Token for authentication
INFLUX_ORG = "Workshop"
AIR_QUALITY_BUCKET = "AirQuality"
TOOL_SENSOR_BUCKET = "ToolSensor"

# Initialize InfluxDB client
client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
write_api = client.write_api(write_options=SYNCHRONOUS)
query_api = client.query_api()

# Setup for GPIO control of dust collector remote
import RPi.GPIO as GPIO

DC_ON_PIN = 23
DC_OFF_PIN = 24
GPIO.setmode(GPIO.BCM) # Broadcom pin-numbering scheme
GPIO.setup(DC_ON_PIN, GPIO.OUT)
GPIO.setup(DC_OFF_PIN, GPIO.OUT)

# Importing the SPS30 library
script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(script_dir, 'sps30'))
from sps30 import SPS30

pm_sensor = SPS30()
logMsg(f"Firmware version: {pm_sensor.firmware_version()}")
logMsg(f"Product type: {pm_sensor.product_type()}")
logMsg(f"Serial number: {pm_sensor.serial_number()}")
logMsg(f"Status register: {pm_sensor.read_status_register()}")
logMsg(
    f"Auto cleaning interval: {pm_sensor.read_auto_cleaning_interval()}s")
pm_sensor.start_measurement()

app = Flask(__name__, static_folder="static")

scheduler = APScheduler()
scheduler.api_enabled = True
scheduler.init_app(app)
scheduler.start()

TOOL_SENSOR_IDS = ['tablesaw', 'jointer', 'bandsaw', 'sander', 'drillpress']
GATE_MAX_KEEPALIVE = timedelta(seconds=15)

GATES_FOR_TOOLS = {
    'tablesaw': ['6'],
    'jointer': ['5', '1'],
    'bandsaw': ['5', '4'],
    'sander': ['5', '7'],
    'drillpress': ['5', '7'],
    'router': ['10'],
}
GATE_FOR_MANUAL = '10'
PAT_GATE = re.compile(r'^[0-9]+$')

class Status:
    def __init__(self, id):
        self.id = id
        self.alive = False
        self.lastTickTime = datetime.min
        self.status = '?'
        self.json = None

class MqttClient:
    def __init__(self):
        self.client = mqtt.Client()
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message

        self.pendingFuture = None

        self.idToStatusMap = {}

        # History for sensor data using Pandas DataFrame
        self.sensor_history_df = pd.DataFrame()
        self.last_measurement = None
        self.MAX_HISTORY_RECORDS = 3600 # 1 hour at 1 second intervals (60*60)

        self.client.connect("127.0.0.1", 1883, 60)
        self.client.loop_start()

    def on_connect(self, *_):
        logMsg("Connected to MQTT broker")
        self.client.subscribe("/gateack/#")
        self.client.subscribe("/gatecmd/#")
        self.client.subscribe("/heartbeat/#")
        self.client.subscribe("/tool_sensor/#")

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
            status = Status(gateid)
            self.idToStatusMap[gateid] = status

        status.alive = True
        status.lastTickTime = datetime.now()

        try:
            msgJson = json.loads(payload)
        except json.decoder.JSONDecodeError:
            return

        status.json = msgJson
        if self.isGate(gateid):
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
                logMsg(f"{gateid} should be open but its not")
                return False
            
            if not shouldOpen and not isClosed:
                logMsg(f"{gateid} should be closed but its not")
                return False

        return True

    def isGate(self, id):
        return PAT_GATE.match(id) is not None

    def turnOnDustCollector(self):
        logMsg("Turning on dust collector")
        GPIO.output(DC_ON_PIN, GPIO.HIGH)
        time.sleep(0.7)
        GPIO.output(DC_ON_PIN, GPIO.LOW)

    def turnOffDustCollector(self):
        logMsg("Turning off dust collector")
        GPIO.output(DC_OFF_PIN, GPIO.HIGH)
        time.sleep(0.7)
        GPIO.output(DC_OFF_PIN, GPIO.LOW)

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

        logMsg("Telling coordinator to turn on DC")
        time.sleep(0.2)
        self.turnOnDustCollector()

    def openManualGate(self):
        for (gateid, status) in self.idToStatusMap.items():
            if not status.alive or not self.isGate(gateid):
                continue
            if gateid == GATE_FOR_MANUAL:
                self.gatecmd(gateid, "open")
            else:
                self.gatecmd(gateid, "close")

    def onToolSensor(self, msg):
        logMsg("Getting tool sensor message")
        status = self.onStatusUpdate(msg)
        logMsg(f"Tool {status.id} was switched {status.status}")
        if status.status == "on":
            record = (Point("tool_status")
                .field("current_tool", status.id)
                .time(datetime.utcnow(), WritePrecision.NS))
            write_api.write(bucket=TOOL_SENSOR_BUCKET, 
                            record=record)
            # We need to do this on a separate thread otherwise the MQTT thread
            # which processes incoming messages is blocked and we do not receive
            # the /gateack messages
            t = threading.Thread(target=self.switchToTool, args=(status.id,))
            t.start()
        else:
            record = (Point("tool_status")
                .field("current_tool", "")
                .time(datetime.utcnow(), WritePrecision.NS))
            write_api.write(bucket=TOOL_SENSOR_BUCKET, 
                            record=record)
            logMsg("Telling coordinator to turn off DC")
            self.turnOffDustCollector()
            
    def on_message(self, client, userdata, msg):
        if msg.topic.startswith("/heartbeat"):
            self.onHeartbeat(msg)
        elif msg.topic.startswith("/tool_sensor"):
            self.onToolSensor(msg)
        elif msg.topic.startswith("/gateack"):
            logMsg("Processing gate acknowledgement")
            status = self.onStatusUpdate(msg)
            logMsg(f"Gate {status.id} is {status.status}")
        elif msg.topic.startswith("/coordinator_keypress"):
            self.onCoordinatorKeyPress(msg)

    def update_sensor_history(self):
        """Reads sensor, records data into DataFrame, and prunes old entries."""
        # 1. Read Sensor
        measurement = pm_sensor.get_measurement()
        if not measurement:
            logMsg("Failed to get sensor measurement.")
            return # Exit if no measurement

        self.last_measurement = measurement

        # 2. Record Data (No broad try/except)
        timestamp_unix = measurement['timestamp']
        timestamp_dt = datetime.fromtimestamp(timestamp_unix)
        sensor_data = measurement['sensor_data']

        # Flatten the nested dictionary
        flat_data = {}
        for category, metrics in sensor_data.items():
            if isinstance(metrics, dict):
                for metric_name, value in metrics.items():
                    flat_data[f"{category}.{metric_name}"] = value
            elif isinstance(metrics, (int, float)):
                flat_data[category] = metrics
            # Ignoring unit fields

        if not flat_data:
            logMsg("No metrics extracted from sensor data.")
            return # Exit if no data extracted

        # Write to InfluxDB
        point = Point("sensor_data").tag("sensor", "sps30").time(datetime.utcnow(), WritePrecision.NS)
        for key, value in flat_data.items():
            point.field(key, value)

        write_api.write(bucket=AIR_QUALITY_BUCKET, record=point)
        logMsg(f"Wrote to InfluxDB: {point.to_line_protocol()}", level=logging.DEBUG)

        # Create a single-row DataFrame with timestamp index
        new_row_df = pd.DataFrame(flat_data, index=[timestamp_dt])

        # Concatenate with the main history DataFrame
        self.sensor_history_df = pd.concat([self.sensor_history_df, new_row_df])

        # 3. Prune History (Keep fixed number of records)
        if len(self.sensor_history_df) > self.MAX_HISTORY_RECORDS:
            # Drop the oldest record(s) to maintain size
            self.sensor_history_df = self.sensor_history_df.iloc[1:]


    def gatecmd(self, gateid, gatecmd):
        logMsg(f"Publishing message /gatecmd/{gateid} {gatecmd}")
        self.client.publish("/gatecmd/" + gateid, gatecmd)

mqtt_client = MqttClient()

@scheduler.task('interval', seconds=1)
def updateStatuses():
    mqtt_client.updateStatuses()

@scheduler.task('interval', seconds=5, id='record_sensor_data_job')
def record_and_prune_sensor_data():
    """Scheduled task to read sensor, record data, and prune history."""
    mqtt_client.update_sensor_history()


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

@app.route("/sps30")
def sps30():
    return mqtt_client.last_measurement

@app.route("/gatecmd/<gateid>/<gatecmd>")
def gatecmd(gateid, gatecmd):
    mqtt_client.gatecmd(gateid, gatecmd)
    return "ok"

@app.route("/open-manual-gate")
def open_manual_gate():
    """Opens the manual gate and closes all others."""
    logMsg("Opening manual gate")
    mqtt_client.openManualGate()
    return "ok"

@app.route("/dust-collector/<action>")
def dust_collector(action):
    """Controls the dust collector."""
    if action == "on":
        mqtt_client.turnOnDustCollector()
    elif action == "off":
        mqtt_client.turnOffDustCollector()
    else:
        return "Invalid action", 400
    return "ok"

# Route to handle blah.html and redirect to port 5000
@app.route('/sensor_history_grafana')
def redirect_to_blah():
    URL = 'http://{HOSTNAME}:3000/public-dashboards/88a9ddfee8e54b3e8a13901e2cb5d5cb?refresh=5s&orgId=1'
    host = request.host.split(':')[0]
    redirect_url = URL.format(HOSTNAME=host)
    # Perform the redirect
    return redirect(redirect_url, code=302)

@app.route("/sensor_history")
def sensor_history():
    """Returns the 1-hour sensor data history as JSON."""
    if mqtt_client.sensor_history_df.empty:
        return Response("[]", mimetype='application/json') # Return empty list if no data

    # Convert DataFrame to JSON, handling timestamps
    # 'records' orientation gives a list of dicts, 'iso' format for dates
    json_data = mqtt_client.sensor_history_df.reset_index().rename(columns={'index': 'timestamp'}).to_json(orient='records', date_format='iso')
    return Response(json_data, mimetype='application/json')

if __name__ == '__main__':
    app.run(debug=False)
