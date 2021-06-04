const GATE_IDS = ['5','6','7'];

class UpdateStatus {
    constructor() {
        this.gateIdMap = {};

        $('#templates').hide();
        for (let gateid of GATE_IDS) {
            let gate = $('#templates .gate').clone();
    
            $(gate).data('gate_id', gateid);
            $('#id', gate).text(gateid);
            $('#main').append(gate);

            this.gateIdMap[gateid] = gate;
            $('#OPEN, #CLOSE', gate).click((event) => {
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
 
            $('button', gate).prop('disabled', true);
            
            if (gstatus === undefined) {
                $(gate).addClass('unknown');
                continue;
            } else if (gstatus.alive) {
                $(gate).addClass('alive');
            } else {
                $(gate).addClass('dead');
                continue;
            }

           if (gstatus.gatePosition == 'open') {
                $('#CLOSE', gate).prop('disabled', false);
            } else if (gstatus.gatePosition == 'close') {
                $('#OPEN', gate).prop('disabled', false);
            } else {
                // can be middle, in which case we enable both buttons
                $('button', gate).prop('disabled', false);
            }

        }
    }
}

$(function() {
    var updater = new UpdateStatus();
});