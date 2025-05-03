from influxdb_client import InfluxDBClient
from influxdb_client.client.query_api import QueryOptions
from influxdb_client.client.write_api import SYNCHRONOUS
from datetime import datetime, timedelta
from influxdb_client import Point, WritePrecision
import random
# InfluxDB configuration
INFLUX_URL = "http://localhost:8086"  # Host-side access
INFLUX_TOKEN = "AirQualityToken"  # Token for authentication
INFLUX_ORG = "Workshop"
INFLUX_BUCKET = "ToolSensor_Test"

# Initialize InfluxDB client
client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)

client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
write_api = client.write_api(write_options=SYNCHRONOUS)
query_api = client.query_api()

# Delete all data in the bucket
delete_api = client.delete_api()
delete_api.delete(
    start=datetime(1970, 1, 1),
    stop=datetime.now(),
    predicate='',
    bucket=INFLUX_BUCKET,
    org=INFLUX_ORG
)

# Generate some synthetic data
# The data is simulating some tools being turned on and off over
# a six-hour period yesterday
tools = ["TableSaw", "DrillPress", "BandSaw"]
time_start = datetime.utcnow() - timedelta(hours=4)
for i in range(20):
    tool = random.choice(tools)
    time_start = time_start + timedelta(minutes=random.randint(5, 15))
    time_end = time_start + timedelta(minutes=random.randint(1, 5))

    write_api.write(
        bucket=INFLUX_BUCKET,
        record=Point("ToolStatus")
        .field("current_tool", tool)
        .time(time_start, WritePrecision.NS)
    )
    write_api.write(
        bucket=INFLUX_BUCKET,
        record=Point("ToolStatus")
        .field("current_tool", "")
        .time(time_end, WritePrecision.NS)
    )
    time_start = time_end
    
# Flux query to get all data in the bucket
query = f'''
from(bucket: "{INFLUX_BUCKET}")
    |> range(start: -30d)
    |> filter(fn: (r) => r._measurement =~ /.*/)
'''
# Execute query
tables = query_api.query(query)

# Process results
for table in tables:
    print(f"Measurement: {table.records[0]['_measurement']}")
    for record in table.records:
        print(f"  Time: {record['_time']}, Field: {record['_field']}, Value: {record['_value']}, Tags: {record.values.get('sensor', 'N/A')}")
