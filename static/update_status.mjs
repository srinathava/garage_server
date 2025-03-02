const TOOL_SENSOR_IDS = ['tablesaw', 'jointer', 'bandsaw', 'sander'];

class UpdateStatus {
    constructor() {
        this.idMap = {};

        $('#templates').hide();
        
        // Create sections for organization
        $('#main').append('<div id="coordinator-section"></div>');
        $('#main').append('<div id="tools-section"><h2>Tools</h2></div>');
        $('#main').append('<div id="gates-section"><h2>Gates</h2></div>');

        this.setupModal();
        this.addStatus('0', 'coordinator', '#coordinator-section')

        for (let toolid of TOOL_SENSOR_IDS.sort()) {
            this.addStatus(toolid, 'tool', '#tools-section')
        }
    
        setInterval(() => this.updateStatus(), 3000);
    }

    setupModal() {
        // Close modal when clicking the X or outside the modal
        $('.close, .modal').click((e) => {
            if (e.target === e.currentTarget) {
                $('#gate-modal').hide();
            }
        });

        // Prevent modal content clicks from closing the modal
        $('.modal-content').click((e) => e.stopPropagation());
    }

    showGateModal(gateId) {
        const modal = $('#gate-modal');
        modal.data('gateId', gateId);
        $('.gate-controls button').off('click').on('click', (event) => {
            this.sendGateCmd(gateId, event.target.id.toLowerCase());
            modal.hide();
        });
        modal.show();
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
            $('.control-btn', status).click(() => this.showGateModal(id));
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
        let statusMap = await response.json()
        console.log(statusMap);
    
        // Sort entries, handling numeric gate IDs properly
        const entries = Object.entries(statusMap);
        const sortedEntries = entries.sort((a, b) => {
            // Skip sorting for coordinator and tools
            if (a[0] === '0' || b[0] === '0') return 0;
            if (TOOL_SENSOR_IDS.includes(a[0]) || TOOL_SENSOR_IDS.includes(b[0])) return 0;
            // Numeric sort for gates
            return parseInt(a[0]) - parseInt(b[0]);
        });

        for (const [id, status] of sortedEntries) {
            let statusDom = this.idMap[id];

            if (statusDom === undefined) {
                statusDom = this.addStatus(id, 'gate', '#gates-section');
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
