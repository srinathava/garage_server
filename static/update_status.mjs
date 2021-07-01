const GATE_IDS = ['1', '2', '3', '4', '5','6', '7'];
const TOOL_SENSOR_IDS = ['tablesaw', 'jointer', 'bandsaw'];

class UpdateStatus {
    constructor() {
        this.idMap = {};

        $('#templates').hide();
        for (let gateid of GATE_IDS) {
            let gate = this.addStatus(gateid, 'gate');
            $('#OPEN, #CLOSE, #MIDDLE, #CALIBRATE', gate).click((event) => {
                this.sendGateCmd(gateid, event.target.id.toLowerCase());
            });
        }

        for (let toolid of TOOL_SENSOR_IDS) {
            this.addStatus(toolid, 'tool')
            let tool = $("#templates .tool").clone();
        }
    
        setInterval(() => this.updateStatus(), 3000);
    }

    addStatus(id, klass) {
        let status = $('#templates .' + klass).clone();
    
        $(status).data('id', id);
        $('#id', status).text(id);
        $('#main').append(status);
        $(status).hide();

        this.idMap[id] = status;
        return status;
    }

    sendGateCmd(gateid, gatecmd) {
        fetch('/gatecmd/' + gateid + '/' + gatecmd);
    }

    async updateStatus() {
        let response = await fetch("/status")
        let statusMap = await response.json()
        console.log(statusMap);
    
        for (const [id, statusDom] of Object.entries(this.idMap)) {
            let status = statusMap[id];

            $(statusDom).removeClass('unknown');
            $(statusDom).removeClass('alive');
            $(statusDom).removeClass('dead');
 
            if (status === undefined || !status.alive) {
                $(statusDom).hide();
                continue;
            } else {
                $(statusDom).show();
                $(statusDom).addClass('alive');
                $('button', statusDom).prop('disabled', false);
                $('#id', statusDom).html('' + id + '<br>' + status.status);
            }

        }
    }

}

$(function() {
    var updater = new UpdateStatus();
});
