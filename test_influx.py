from influxdb_client import InfluxDBClient
from influxdb_client.client.query_api import QueryOptions
from influxdb_client.client.write_api import SYNCHRONOUS
from datetime import datetime
from influxdb_client import Point, WritePrecision

# InfluxDB configuration
INFLUX_URL = "http://localhost:8086"  # Host-side access
INFLUX_TOKEN = "AirQualityToken"  # Token for authentication
INFLUX_ORG = "Workshop"
INFLUX_BUCKET = "AirQuality"

# Initialize InfluxDB client
client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)

client = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
write_api = client.write_api(write_options=SYNCHRONOUS)
query_api = client.query_api()

# # Write some fake data to the InfluxDB bucket
# for i in range(10):
#     point = Point("sensor_data") \
#         .tag("sensor", f"sps30") \
#         .field("temperature", 20 + i) \
#         .field("humidity", 30 + i) \
#         .time(datetime.utcnow(), WritePrecision.NS)
    
#     write_api.write(bucket=INFLUX_BUCKET, record=point)

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
