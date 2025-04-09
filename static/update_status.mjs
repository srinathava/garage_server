import { Calibrator } from './calibrate.mjs';

class UpdateStatus {
    constructor() {
        this.idMap = {};
        this.statusMap = null;
        this.calibrator = new Calibrator(this); // Instantiate Calibrator

        $('#templates').hide();
        
        // Create sections for organization
        $('#main').append('<div id="coordinator-section"></div>');
        $('#main').append('<div id="tools-section"><h2>Tools</h2></div>');
        $('#main').append('<div id="gates-section"><h2>Gates</h2></div>');

        this.addStatus('0', 'coordinator', '#coordinator-section')
        setInterval(() => this.updateStatus(), 3000);
    }

    addStatus(id, klass, section) {
        let status = $('#templates .' + klass).clone();
    
        $(status).data('id', id);
        $('#id', status).text(id);
        
        if (klass === 'gate') {
            // For gates, insert in numeric order
            let inserted = false;
            $('#gates-section .gate').each(function() {
                const existingId = $(this).data('id');
                if (parseInt(id) < parseInt(existingId)) {
                    $(this).before(status);
                    inserted = true;
                    return false; // break the loop
                }
            });
            if (!inserted) {
                $(section).append(status);
            }

            // Add click handler for the control button
            $('.control-btn', status).click(() => this.calibrator.showGateModal(id)); // Use calibrator instance
        } else {
            $(section).append(status);
        }
        
        $(status).hide();

        this.idMap[id] = status;
        return status;
    }

    sendGateCmd(gateid, gatecmd) {
        fetch('/gatecmd/' + gateid + '/' + gatecmd);
    }

    async updateStatus() {
        let response = await fetch("/status")
        this.statusMap = await response.json()
        console.log(this.statusMap);
    
        // Sort entries, handling numeric gate IDs properly
        const entries = Object.entries(this.statusMap);
        // Sort entries: coordinator first, then numerically for gates, then alphabetically for tools
        const sortedEntries = entries.sort((a, b) => {
            const idA = a[0];
            const idB = b[0];
            const isNumericA = !isNaN(parseInt(idA));
            const isNumericB = !isNaN(parseInt(idB));

            if (idA === '0') return -1; // Coordinator always first
            if (idB === '0') return 1;

            if (isNumericA && isNumericB) {
                return parseInt(idA) - parseInt(idB); // Numeric sort for gates
            } else if (isNumericA != isNumericB) {
                return 1; // doesn't matter since tools and gates go into different sections
            } else {
                return idA.localeCompare(idB); // Alphabetical sort for tools
            }
        });

        for (const [id, status] of sortedEntries) {
            let statusDom = this.idMap[id];

            // Assuming 'statusDom = this.idMap[id];' happened just before this block.
            // This block executes only if the element wasn't found in the initial lookup.
            // Since the coordinator ('0') is always pre-added, this only applies to new gates/tools.
            if (statusDom === undefined) {
                // Add the new gate or tool.
                const isNumericId = !isNaN(parseInt(id));
                const section = isNumericId ? '#gates-section' : '#tools-section';
                const type = isNumericId ? 'gate' : 'tool';
                statusDom = this.addStatus(id, type, section);
            }

            $(statusDom).removeClass('unknown');
            $(statusDom).removeClass('alive');
            $(statusDom).removeClass('dead');
 
            if (status.alive) {
                $(statusDom).show();
                $(statusDom).addClass('alive');
                $('button', statusDom).prop('disabled', false);
                $('#id', statusDom).html('' + id + ' (' + status.status + ')');
            } else {
                $(statusDom).show();
                $(statusDom).addClass('dead');
                $('button', statusDom).prop('disabled', true);
                $('#id', statusDom).html('' + id);
            }
        }
    }
}

$(function() {
    var updater = new UpdateStatus();
});
