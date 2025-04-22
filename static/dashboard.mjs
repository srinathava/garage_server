import { getColorForValue } from './sensor_history.mjs';

async function checkHeartbeat() {
    console.log("Checking heartbeat...");
    const response = await fetch('/status');
    const data = await response.json();

    let statusDiv = document.getElementById('heartbeat-status');
    let timeDiv = statusDiv.querySelector('.time');
    if (!timeDiv) {
        timeDiv = document.createElement('div');
        timeDiv.classList.add('time');
        statusDiv.appendChild(timeDiv);
    }
    const now = new Date();
    const formattedTime = now.toLocaleTimeString();
    timeDiv.innerText = `Last heartbeat: ${formattedTime}`;

    for (const tool in data) {
        let toolDiv = statusDiv.querySelector(`#tool-${tool}`);
        if (!toolDiv) {
            toolDiv = document.createElement('div');
            toolDiv.id = `tool-${tool}`;
            toolDiv.classList.add('tool');
            statusDiv.appendChild(toolDiv);
        }
        if (data[tool].alive === false) {
            toolDiv.classList.add('dead');
            toolDiv.innerText = tool;
        } else {
            toolDiv.classList.remove('dead');
            toolDiv.innerText = tool;
        }
    }
}


async function fetchSPS30Data() {
    try {
        const response = await fetch('/sps30');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error("Failed to fetch SPS30 data:", error);
        return null;
    }
}

function displaySPS30Data(data) {
    const sps30DataContainer = document.getElementById('sps30-data');
    if (!sps30DataContainer) {
        console.error("SPS30 data container not found");
        return;
    }

    if (!data || !data.sensor_data || !data.sensor_data.mass_density) {
        sps30DataContainer.innerHTML = "<p>No SPS30 data available.</p>";
        return;
    }

    const massDensityData = data.sensor_data.mass_density;

    let html = '';
    for (const [key, value] of Object.entries(massDensityData)) {
        const sensorKey = `mass_density.${key}`;
        const color = getColorForValue(sensorKey, value);

        html += `
            <div class="sensor-data-snapshot" style="background-color: ${color};">
                <div class="label">${key}</div>
                <div class="value">${value.toFixed(2)}</div>
            </div>
        `;
    }

    sps30DataContainer.innerHTML = html;
}

async function updateSPS30Dashboard() {
    const data = await fetchSPS30Data();
    if (data) {
        displaySPS30Data(data);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const cbFcn = () => {
        checkHeartbeat();
        updateSPS30Dashboard();
    }
    cbFcn();
    setInterval(cbFcn, 1000);
    const manualGateButton = document.getElementById('open-manual-gate');
    manualGateButton.addEventListener('click', () => {        
        fetch(`/open-manual-gate`);
    });
});
