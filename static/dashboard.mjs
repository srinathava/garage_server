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
        let toolDiv = statusDiv.querySelector(`#${tool}`);
        if (!toolDiv) {
            toolDiv = document.createElement('div');
            toolDiv.id = tool;
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

document.addEventListener('DOMContentLoaded', () => {
    checkHeartbeat(); // Initial check on load
    setInterval(checkHeartbeat, 1000); // Check every 1 second

    const manualGateButton = document.getElementById('open-manual-gate');
    manualGateButton.addEventListener('click', () => {        
        fetch(`/open-manual-gate`);
    });
});