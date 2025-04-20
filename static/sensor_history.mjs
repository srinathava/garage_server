import { MqttHandler } from './mqtt_handler.mjs';

const charts = {}; // Store chart instances
const chartConfigs = {}; // Store chart configurations
const latestValues = {}; // Store latest values for display
export const DISPLAY_MODE = {
    REGULAR: 'regular',
    COMPACT: 'compact'
};

// Define thresholds for different sensor types
const thresholds = {
    // Mass density thresholds (μg/m³)
    'mass_density.pm1.0': { green: 10, orange: 20, red: 35 },
    'mass_density.pm2.5': { green: 12, orange: 35, red: 55 },
    'mass_density.pm4.0': { green: 15, orange: 40, red: 70 },
    'mass_density.pm10': { green: 20, orange: 50, red: 150 },
    
    // Particle count thresholds (particles/cm³)
    'particle_count.pm0.5': { green: 50, orange: 100, red: 200 },
    'particle_count.pm1.0': { green: 30, orange: 75, red: 150 },
    'particle_count.pm2.5': { green: 20, orange: 50, red: 100 },
    'particle_count.pm4.0': { green: 10, orange: 25, red: 50 },
    'particle_count.pm10': { green: 5, orange: 15, red: 30 },
    
    // Default thresholds for any other sensor types
    'default': { green: 50, orange: 100, red: 150 }
};

// Function to get color based on value and thresholds
function getColorForValue(sensorKey, value) {
    const sensorThresholds = thresholds[sensorKey] || thresholds.default;
    
    if (value <= sensorThresholds.green) {
        return 'rgb(75, 192, 75)'; // Green
    } else if (value <= sensorThresholds.orange) {
        return 'rgb(255, 159, 64)'; // Orange
    } else {
        return 'rgb(255, 99, 132)'; // Red
    }
}

// Function to get status text based on value and thresholds
function getStatusText(sensorKey, value) {
    const sensorThresholds = thresholds[sensorKey] || thresholds.default;
    
    if (value <= sensorThresholds.green) {
        return 'Good';
    } else if (value <= sensorThresholds.orange) {
        return 'Moderate';
    } else {
        return 'Poor';
    }
}

// Function to create chart configuration
function createChartConfig(sensorKey, timestamps, values, pointColors, oneHourAgo, now, mode = DISPLAY_MODE.REGULAR) {
    const config = {
        type: 'line',
        data: {
            labels: timestamps,
            datasets: [{
                label: sensorKey,
                data: values,
                pointBackgroundColor: pointColors,
                tension: 0.1,
                segment: {
                    // Color line segments based on the value at each point
                    borderColor: (ctx) => {
                        const index = ctx.p0DataIndex;
                        if (index >= 0 && index < values.length) {
                            return getColorForValue(sensorKey, values[index]);
                        }
                        return 'rgb(75, 192, 192)';
                    }
                }
            }]
        },
        options: {
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'minute',
                        displayFormats: {
                            minute: 'HH:mm:ss'
                        }
                    },
                    min: oneHourAgo,
                    max: now
                },
                y: {
                    beginAtZero: true
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            animation: false,
            maintainAspectRatio: false
        }
    };
    
    // Apply mode-specific modifications
    if (mode === DISPLAY_MODE.COMPACT) {
        // Dataset specific modifications
        config.data.datasets[0].pointRadius = 0; // No points for compact view
        config.data.datasets[0].borderWidth = 1.5;
        
        // Time format modification
        config.options.scales.x.time.displayFormats.minute = 'HH:mm';
        
        // Hide grid, ticks, and titles for compact view
        config.options.scales.x.grid = { display: false };
        config.options.scales.x.ticks = { display: false };
        config.options.scales.x.title = { display: false };
        
        config.options.scales.y.grid = { display: false };
        config.options.scales.y.ticks = { display: false };
        config.options.scales.y.title = { display: false };
        
        // Add layout padding settings
        config.options.layout = {
            padding: {
                left: 0,
                right: 0,
                top: 0,
                bottom: 0
            }
        };
        
        // Add responsive setting
        config.options.resposive = false;
    } else {
        // Dataset specific modifications
        config.data.datasets[0].pointRadius = 1;
        
        // Add tooltip format
        config.options.scales.x.time.tooltipFormat = 'yyyy-MM-dd HH:mm:ss';
        
        // Add axis titles
        config.options.scales.x.title = {
            display: true,
            text: 'Timestamp'
        };
        
        config.options.scales.y.title = {
            display: true,
            text: 'Value'
        };
        
        // Add tooltip configuration
        config.options.plugins.tooltip = {
            mode: 'index',
            intersect: false,
            callbacks: {
                label: function(context) {
                    const value = context.raw;
                    const status = getStatusText(sensorKey, value);
                    return `${sensorKey}: ${value} (${status})`;
                }
            }
        };
        
        // Add threshold annotations
        config.options.plugins.annotation = {
            annotations: {
                greenLine: {
                    type: 'line',
                    yMin: (thresholds[sensorKey] || thresholds.default).green,
                    yMax: (thresholds[sensorKey] || thresholds.default).green,
                    borderColor: 'rgba(75, 192, 75, 0.5)',
                    borderWidth: 1,
                    borderDash: [5, 5]
                },
                orangeLine: {
                    type: 'line',
                    yMin: (thresholds[sensorKey] || thresholds.default).orange,
                    yMax: (thresholds[sensorKey] || thresholds.default).orange,
                    borderColor: 'rgba(255, 159, 64, 0.5)',
                    borderWidth: 1,
                    borderDash: [5, 5]
                },
                redLine: {
                    type: 'line',
                    yMin: (thresholds[sensorKey] || thresholds.default).red,
                    yMax: (thresholds[sensorKey] || thresholds.default).red,
                    borderColor: 'rgba(255, 99, 132, 0.5)',
                    borderWidth: 1,
                    borderDash: [5, 5]
                }
            }
        };
    }
    
    return config;
}

// Function to create or update a chart
function createOrUpdateChart(sensorKey, data, mode = DISPLAY_MODE.REGULAR) {
    // Use different element IDs based on mode
    const chartId = `chart-${sensorKey}`;
    
    const canvas = document.getElementById(chartId);
    if (!canvas) {
        console.error(`Canvas element with ID ${chartId} not found`);
        return;
    }
    
    const ctx = canvas.getContext('2d');
    
    // Create a 1-hour time window
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Filter data to only include points within the last hour
    const filteredData = data.filter(item => new Date(item.timestamp) >= oneHourAgo);
    
    const timestamps = filteredData.map(item => new Date(item.timestamp));
    const values = filteredData.map(item => item[sensorKey]);
    
    // Create point colors based on thresholds
    const pointColors = values.map(value => getColorForValue(sensorKey, value));
    
    // Store the latest value and update status
    if (values.length > 0) {
        const latestValue = values[values.length - 1];
        latestValues[sensorKey] = latestValue.toFixed(3);
        
        const latestValueElement = document.getElementById(`latest-${sensorKey}`);
        if (latestValueElement) {
            latestValueElement.textContent = latestValues[sensorKey];
        }
        
        // Update status text if element exists
        const statusElement = document.getElementById(`status-${sensorKey}`);
        if (statusElement) {
            const status = getStatusText(sensorKey, latestValue);
            statusElement.textContent = status;
            statusElement.className = `status-indicator ${status.toLowerCase()}`;
        }
    }

    // Create chart key that's unique for each mode
    const chartKey = `${mode}-${sensorKey}`;
    
    if (charts[chartKey]) {
        // Update existing chart
        charts[chartKey].data.labels = timestamps;
        charts[chartKey].data.datasets[0].data = values;
        charts[chartKey].data.datasets[0].pointBackgroundColor = pointColors;
        
        // Remove single borderColor and use segment colors instead
        delete charts[chartKey].data.datasets[0].borderColor;
        
        // Update the min/max time for the x-axis to always show 1 hour
        charts[chartKey].options.scales.x.min = oneHourAgo;
        charts[chartKey].options.scales.x.max = now;
        
        charts[chartKey].update();
    } else {
        // Create new chart with configuration based on mode
        const config = createChartConfig(sensorKey, timestamps, values, pointColors, oneHourAgo, now, mode);
        
        // Store config and chart with mode-specific key
        chartConfigs[chartKey] = config;
        charts[chartKey] = new Chart(ctx, config);
    }
}

// Function to fetch data and update charts
async function fetchDataAndUpdateCharts(mode = DISPLAY_MODE.REGULAR, compactContainerId = null) {
    const response = await fetch('/sensor_history');
    
    if (!response.ok) {
        console.error(`HTTP error! status: ${response.status}`);
        const chartsContainer = document.getElementById('charts-container');
        chartsContainer.innerHTML = `<p>Error loading sensor data: ${response.statusText} (${response.status})</p>`;
        return;
    }
    
    const data = await response.json();
    
    if (!data || data.length === 0) {
        console.log("No sensor data received.");
        return;
    }

    // Identify unique sensor keys (excluding timestamp)
    const sensorKeys = Object.keys(data[0]).filter(key => key !== 'timestamp');
    
    // Regular chart display
    const chartsContainer = document.getElementById('charts-container');
    if (!chartsContainer) {
        console.error("Charts container not found for regular mode");
        return;
    }
    
    sensorKeys.forEach(key => {
        // Check if chart container exists, create if not
        if (!key.includes('mass_density') && mode == DISPLAY_MODE.COMPACT) {
            console.log(`Skipping ${key} for compact mode`);
            return;
        }
        let chartDiv = document.getElementById(`chart-div-${key}`);
        if (!chartDiv) {
            chartDiv = document.createElement('div');
            chartDiv.id = `chart-div-${key}`;
            chartDiv.classList.add('chart-wrapper');

            const label = document.createElement('div');
            label.classList.add('sensor-label');
            label.textContent = key;

            const latestValueDisplay = document.createElement('div');
            latestValueDisplay.id = `latest-${key}`;
            latestValueDisplay.classList.add('latest-value');
            latestValueDisplay.innerHTML = `N/A`;

            const statusIndicator = document.createElement('div');
            statusIndicator.id = `status-${key}`;
            statusIndicator.classList.add('status-indicator');
            statusIndicator.innerHTML = 'N/A';

            const canvasContainer = document.createElement('div');
            canvasContainer.classList.add('canvas-container');
            const canvas = document.createElement('canvas');
            if (mode === DISPLAY_MODE.COMPACT) {
                canvas.height = 100;
                canvas.width = 300;
            }
            canvas.id = `chart-${key}`;
            canvasContainer.appendChild(canvas);

            chartDiv.appendChild(label);
            chartDiv.appendChild(canvasContainer);
            chartDiv.appendChild(latestValueDisplay);
            chartDiv.appendChild(statusIndicator);

            chartsContainer.appendChild(chartDiv);
        }

        // Create or update the chart for this sensor key
        createOrUpdateChart(key, data, mode);
    });
}

async function loadAnnotationPlugin() {
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@2.1.0/dist/chartjs-plugin-annotation.min.js';
        script.onload = () => resolve();
        document.head.appendChild(script);
    });
}

// Initialize the dashboard
export async function initDashboard(mode = DISPLAY_MODE.REGULAR) {
    // Wait for the annotation plugin to load
    await loadAnnotationPlugin();
    
    // Set up periodic refresh for compact charts
    setInterval(() => {
        fetchDataAndUpdateCharts(
            mode,
            'charts-container'
        );
    }, 1000);
}

