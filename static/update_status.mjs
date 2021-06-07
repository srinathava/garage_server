const GATE_IDS = ['1', '2', '3', '4', '5','6', '7'];

class UpdateStatus {
    constructor() {
        this.gateIdMap = {};

        $('#templates').hide();
        for (let gateid of GATE_IDS) {
            let gate = $('#templates .gate').clone();
    
            $(gate).data('gate_id', gateid);
            $('#id', gate).text(gateid);
            $('#main').append(gate);
            $(gate).hide();

            this.gateIdMap[gateid] = gate;
            $('#OPEN, #CLOSE, #MIDDLE, #CALIBRATE', gate).click((event) => {
                this.sendGateCmd(gateid, event.target.id.toLowerCase());
            });
        }
    
        setInterval(() => this.updateStatus(), 3000);
    }

    sendGateCmd(gateid, gatecmd) {
        fetch('/gatecmd/' + gateid + '/' + gatecmd);
    }

    async updateStatus() {
        let response = await fetch("/status")
        let status = await response.json()
        console.log(status);
    
        for (var gateid of GATE_IDS) {
            let gate = this.gateIdMap[gateid];
            let gstatus = status[gateid];

            $(gate).removeClass('unknown');
            $(gate).removeClass('alive');
            $(gate).removeClass('dead');
 
            if (gstatus === undefined || !gstatus.alive) {
                $(gate).hide();
                continue;
            } else {
                $(gate).show();
                $(gate).addClass('alive');
                $('button', gate).prop('disabled', false);
                $('#id', gate).html('' + gateid + '<br>' + gstatus.gatePosition);
            }

        }
    }
}

$(function() {
    var updater = new UpdateStatus();
});
