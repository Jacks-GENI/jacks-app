/*
#
# Copyright (c) 2014 University of Utah and the Flux Group.
# 
# {{{GENIPUBLIC-LICENSE
# 
# GENI Public License
# 
# Permission is hereby granted, free of charge, to any person obtaining
# a copy of this software and/or hardware specification (the "Work") to
# deal in the Work without restriction, including without limitation the
# rights to use, copy, modify, merge, publish, distribute, sublicense,
# and/or sell copies of the Work, and to permit persons to whom the Work
# is furnished to do so, subject to the following conditions:
# 
# The above copyright notice and this permission notice shall be
# included in all copies or substantial portions of the Work.
# 
# THE WORK IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
# OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
# MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
# NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
# HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
# WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE WORK OR THE USE OR OTHER DEALINGS
# IN THE WORK.
# }}}
#
*/
 
function JacksApp(jacks, status, statusHistory, buttons, sliceAms, allAms, sliceInfo,
		  userInfo, readyCallback) {
    // Map from client_id to am_id
    this.client2am = {};
    // Map from URN (and client_id) to client_id
    this.urn2clientId = {};
    this.input = null;
    this.output = null;
    // Commands going into Jacks.
    this.jacksInput = null;
    // Responses coming out of Jacks.
    this.jacksOutput = null;
    // How long to wait before polling status again in milliseconds
    this.statusPollDelayMillis = 5000;

    this.jacks = jacks;
    this.jacks_editor = null;
    this.jacks_editor_visible = false;

    this.status = status;
    this.statusHistory = statusHistory;

    this.buttons = buttons;
    this.sliceAms = sliceAms;
    this.allAms = allAms;

    this.verbose = false; // Print debug messages to console.log

    this.sliceInfo = sliceInfo;
    this.sliceId = sliceInfo.slice_id;
    this.sliceUrn = sliceInfo.slice_urn;
    this.sliceExpiration = sliceInfo.slice_expiration;
    this.sliceName = sliceInfo.slice_name;

    this.first_manifest_pending = false;

    this.loginInfo = {};

    this.userInfo = userInfo;
    this.username = userInfo.user_name;

    this.selectedNodes = [];
    this.selectedSites = [];
    this.selectedLinks = [];

    this.currentTopology = {};

    var aggregate_info = [];
    $.each(allAms, function(am_id, agg_details) {
	    var agg_id = agg_details.urn;
	    var agg_name = agg_details.name;
	    aggregate_info.push({id: agg_id, name: agg_name});
	});

    var that = this;
    var jacksInstance = new window.Jacks({
        mode: 'viewer',
        source: 'rspec',
        // This may not need to be hardcoded.
	// size: { x: 791, y: 350},
	// size: { x: 1400, y: 350},
	size: 'auto',
	canvasOptions : {aggregates: aggregate_info},
        show: {
            menu: false,
            rspec: false,
            version: false
        },
	multiSite: true,
        nodeSelect: true,
        root: jacks,
        readyCallback: function (input, output) {
            that.jacksReady(input, output);
            that.initButtons(that.buttons);
	    output.on('modified-topology', function (data) {
		    that.currentTopology = data;
		});
	    $(that.status).click(function () {
		    that.handleStatusClick();
		});
	    $(that.statusHistory).click(function() {
		    that.handleStatusHistoryClick();
		});
            // Finally, tell our client that we're ready
            readyCallback(that, that.input, that.output);
        }
    });
}

//----------------------------------------------------------------------
// Jacks App Constants
//----------------------------------------------------------------------

JacksApp.prototype.ADD_EVENT_TYPE = "ADD";
JacksApp.prototype.DELETE_EVENT_TYPE = "DELETE";
JacksApp.prototype.DETAILS_EVENT_TYPE = "DETAILS";
JacksApp.prototype.MANIFEST_EVENT_TYPE = "MANIFEST";
JacksApp.prototype.RENEW_EVENT_TYPE = "RENEW";
JacksApp.prototype.RESTART_EVENT_TYPE = "RESTART";
JacksApp.prototype.STATUS_EVENT_TYPE = "STATUS";


//----------------------------------------------------------------------
// Jacks App Methods
//----------------------------------------------------------------------

/**
 * Print to console.log if verbose is set
 */
JacksApp.prototype.debug = function(msg) {
    if(this.verbose)
	console.log(msg);
}

/** 
 * Hide the jacks app pane
 */ 
JacksApp.prototype.hide = function (msg) {
    $(this.jacks).hide();
    $(this.buttons).hide();
    $(this.status).hide();
    $(this.statusHistory).hide();
}

/** 
 * Show the jacks app pane
 */ 
JacksApp.prototype.show = function (msg) {
    $(this.jacks).show();
    $(this.buttons).show();
    $(this.status).show();
    //    $(this.statusHistory).show();
}

JacksApp.prototype.setJacksEditor = function(je) {
    this.jacks_editor = je;
    this.jacks_editor_visible = true;
}

/**
 * Called when Jacks is ready. 'input' and 'output' are the Jacks
 * input and output event channels.
 */
JacksApp.prototype.jacksReady = function(input, output) {
    // Once Jacks is ready, we can initialize the
    // JacksApp event channels because Backbone has
    // been loaded.
    this.initEvents();

    // Commands going into Jacks.
    this.jacksInput = input;
    // Responses coming out of Jacks.
    this.jacksOutput = output;

    // Set up the function that Jacks will call when a node
    // is clicked.
    this.jacksOutput.on('click-event', this.onClickEvent, this);
    this.jacksOutput.on('selection', this.onSelectionEvent, this)
;
    // Start with a blank topology.
    this.jacksInput.trigger('change-topology',
                            [{ rspec: '<rspec></rspec>' }]);

    // Start loading the manifests next, asynchronously.
    var that = this;
    setTimeout(function() {
        that.getSliceManifests();
    }, 0);
};

JacksApp.prototype.initEvents = function() {
    // Initialize input and output as Backbone.Events
    // See http://backbonejs.org
    this.input = new Object();
    this.output = new Object();
    _.extend(this.input, Backbone.Events);
    _.extend(this.output, Backbone.Events);

    // Debug the event channels
    this.input.on("all", function(eventName) {
        debug("EP -> JacksApp: " + eventName + " event");
    });
    this.input.on(this.MANIFEST_EVENT_TYPE, this.onEpManifest, this);
    this.input.on(this.STATUS_EVENT_TYPE, this.onEpStatus, this);
    this.input.on(this.DETAILS_EVENT_TYPE, this.onEpDetails, this);
    this.input.on(this.DELETE_EVENT_TYPE, this.onEpDelete, this);
    this.input.on(this.RENEW_EVENT_TYPE, this.onEpRenew, this);
    this.input.on(this.RESTART_EVENT_TYPE, this.onEpRestart, this);
};

JacksApp.prototype.updateStatus = function(statusText) {
    var statusHistoryPane = this.statusHistory;
    var statusPane = this.status;
    var html = '<p class="jacksStatusText">' + statusText + '</p>';
    $(statusPane).html(html);
    $(statusHistoryPane).prepend(html);
};

JacksApp.prototype.handleStatusClick = function() {
    debug("STATUS Click");
    $(this.statusHistory).show();
}

JacksApp.prototype.handleStatusHistoryClick = function() {
    debug("STATUS HISTORY Click");
    this.hideStatusHistory();
}


JacksApp.prototype.hideStatusHistory = function()
{
    $(this.statusHistory).hide();
}

JacksApp.prototype.initButtons = function(buttonSelector) {
    var that = this;

    /*
    var btn = $('<button type="button">Get Manifest</button>');
    btn.click(function(){ that.getSliceManifests();});
    $(buttonSelector).append(btn);
    */

    btn = $('<button type="button">Renew</button>');
    btn.click(function() {
        that.renewResources();
    });
    $(buttonSelector).append(btn);

    var dp = $('<input type="text" id="renew_datepicker">');
    $(buttonSelector).append(dp);
    $("#renew_datepicker").datepicker({ dateFormat: "yy-mm-dd" });
    $("#renew_datepicker").attr('placeholder', 'Renew Date');

    btn = $('<button type="button">Delete</button>');
    btn.click(function(){ 
	    that.deleteResources();
	});
    $(buttonSelector).append(btn);

    // GAP
    label = $('<label style="padding: 020px;" />');
    $(buttonSelector).append(label);

    btn = $('<button type="button">SSH</button>');
    btn.click(function(){ that.handleSSH();});
    $(buttonSelector).append(btn);

    btn = $('<button type="button">Restart</button>');
    btn.click(function(){ that.handleRestart();});
    $(buttonSelector).append(btn);

    //  GAP
    label = $('<label style="padding: 020px;" />');
    $(buttonSelector).append(label);

    btn = $('<button type="button">Details</button>');
    btn.click(function(){ that.handleDetails();});
    $(buttonSelector).append(btn);

    btn = $('<button type="button">Status</button>');
    btn.click(function(){ that.handleStatus();});
    $(buttonSelector).append(btn);

    // GAP
    label = $('<label style="padding: 020px;" />');
    $(buttonSelector).append(label);

    btn = $('<button type="button">Add Resources</button>');
    btn.click(function(){ that.addResources();});
    $(buttonSelector).append(btn);

    /*
    btn = $('<button type="button">EDITOR</BUTTON>');
    btn.click(function() {
	    //	    console.log("HIDE " + that.jacks_editor);
	    if(that.jacks_editor != null) {
		if (that.jacks_editor_visible) {
		    that.jacks_editor.hide();
		    that.jacks_editor_visible = false;
		} else {
		    that.jacks_editor.show();
		    that.jacks_editor_visible = true;
		}
	    }
	});
    $(buttonSelector).append(btn);
    */
};

/**
 * Determine whether the status is in a terminal state.
 *
 * Status can be terminal if it is 'ready' or 'failed'. Other states
 * are considered transient, not terminal.
 *
 * Returns a boolean, true if terminal status, false otherwise.
 */
JacksApp.prototype.isTerminalStatus = function(status) {
    var code = status['status_code'];
    /* Which is which? What is 2 and what is 3? */
    return code == 2 || code == 3;
};

JacksApp.prototype.amName = function(am_id) {
    return this.allAms[am_id].name;
};


//----------------------------------------------------------------------
// Jacks App Events to Embedding Page
//----------------------------------------------------------------------

JacksApp.prototype.getSliceManifests = function() {
    var sliceAms = this.sliceAms;

    if (sliceAms.length === 0) {
	if (this.jacks_editor != null) {
	    this.jacks_editor.show();
	    this.hide();
	}
	this.updateStatus("Jacks initialized: no resources");
	return;
    }

    // Make it so that the first manifst coming back replaces the current
    // manifests, but subsequent manfiests are added.
    this.first_manifest_pending=true;

    // Loop through each known AM and get the manifest.
    var that = this;
    $.each(sliceAms, function(i, am_id) {
        // Update the status bar.
        that.updateStatus('Gathering manifest from '
                          + that.amName(am_id) + '...');
        that.output.trigger(that.MANIFEST_EVENT_TYPE,
                            { name: that.MANIFEST_EVENT_TYPE,
                              am_id: am_id,
                              slice_id: that.sliceId,
                              callback: that.input,
                              client_data: {}
                            });
    });
};



/**
 * max_time is when to stop polling
 */
JacksApp.prototype.getManifest = function(am_id, maxTime) {
    this.updateStatus('Polling resource manifest from '
                      + this.amName(am_id) + '...');
    this.output.trigger(this.MANIFEST_EVENT_TYPE,
                        { name: this.MANIFEST_EVENT_TYPE,
                          am_id: am_id,
                          slice_id: this.sliceId,
                          callback: this.input,
                          client_data: { maxTime: maxTime }
                        });
};

/**
 * max_time is when to stop polling
 */
JacksApp.prototype.getStatus = function(am_id, maxTime) {
    this.updateStatus('Polling resource status from '
                      + this.amName(am_id) + '...');
    this.output.trigger(this.STATUS_EVENT_TYPE,
                        { name: this.STATUS_EVENT_TYPE,
                          am_id: am_id,
                          slice_id: this.sliceId,
                          callback: this.input,
                          client_data: { maxTime: maxTime }
                        });
};

/**
 * handle SSH call into given node
 */
JacksApp.prototype.handleSSH = function() {
    debug("SSH");
    debug("USER = " + this.username);
    if (this.selectedNodes.length ==  0) {
	alert("No compute node selected.");
	return;
    }

    var client_id = this.selectedNodes[0].name;
    if(this.username in this.loginInfo) {
	if (client_id in this.loginInfo[this.username]) {
	    var urls = this.loginInfo[this.username][client_id];
	    if (urls.length > 0) {
		url = urls[0];
		debug("LOGIN URL = " + url);
		window.location.replace(url);
	    }
	}
    }
};


/**
 * handle VM restart request
 */
JacksApp.prototype.handleRestart = function() {
    debug("Restart");
    var that = this;
    // Is anything selected? If so , only restart at that aggregate
    var restartAMs = this.sliceAms;
    var msg = "Restart at known slice resources?";

    if(this.selectedNodes.length > 0) {
	restartAMs = [];
	msg = "Restart resources at ";
	$.each(this.selectedNodes, function(i, selected_node) {
		var node_name = selected_node.name;
		var am_id = that.client2am[node_name];
		var am_name = that.allAms[am_id].name;
		if (i > 0) msg = msg + ", ";
		msg = msg + am_name;
		restartAMs.push(am_id);
	    });
    }

    if (confirm(msg)) {
	this.first_manifest_pending = true;
        $.each(restartAMs, function(i, am_id) {
            that.updateStatus('Restarting resources at ' + that.amName(am_id));
            that.output.trigger(that.RESTART_EVENT_TYPE,
                                { name: that.RESTART_EVENT_TYPE,
                                  am_id: am_id,
                                  slice_id: that.sliceId,
                                  callback: that.input,
                                  client_data: {}
                                });
        });
    }
 };


/**
 * delete all resources on given slice at given AM
 */
JacksApp.prototype.deleteResources = function() {
    var deleteAMs = this.sliceAms;
    var msg = "Delete known slice resources?";
    var that = this;

    // If any nodes selected, use only them
    if(this.selectedNodes.length > 0) {
	deleteAMs = []
	msg = "Delete slice resources at ";
	$.each(this.selectedNodes, function(i, selected_node) {
		var node_name = selected_node.name;
		var am_id = that.client2am[node_name];
		deleteAMs.push(am_id);
		if(i > 0) msg = msg + ", ";
		msg = msg + that.allAms[am_id].name;
	    });
	msg = msg + "?";
    }

    if (confirm(msg)) {
        $.each(deleteAMs, function(i, am_id) {
            that.updateStatus('Deleting resources at ' + that.amName(am_id));
            that.output.trigger(that.DELETE_EVENT_TYPE,
                                { name: that.DELETE_EVENT_TYPE,
                                  am_id: am_id,
                                  slice_id: that.sliceId,
                                  callback: that.input,
                                  client_data: {}
                                });
        });
    }
};

/**
 * Ask embedding page to add resources to current slice
 */
JacksApp.prototype.addResources = function() {
    if (this.jacks_editor != null) {
	this.jacks_editor.show();
    } else {
	this.output.trigger(this.ADD_EVENT_TYPE,
             { name: this.ADD_EVENT_TYPE,
               slice_id: this.sliceId,
                 client_data: {}
            });
    }
};

JacksApp.prototype.renewResources = function() {
    // Has a date been chosen? If not, help them choose a date
    var renewDate = $('#renew_datepicker').val();
    if (! renewDate) {
        alert("Please choose a renewal date.");
        return;
    }
    var that = this;
    var renewAMs = this.sliceAms;

    var msg = "Renew known slice resources until " + renewDate + "?";

    // If any nodss selected, use only them
    if(this.selectedNodes.length > 0) {
	renewAMs = []
	msg = "Renew slice resources at ";
	$.each(this.selectedNodes, function(i, selected_node) {
		var node_name = selected_node.name;
		var am_id = that.client2am[node_name];
		renewAMs.push(am_id);
		if(i > 0) msg = msg + ", ";
		msg = msg + that.allAms[am_id].name;
	    });
	msg = msg + " until " + renewDate + "?";
    }

    if (confirm(msg)) {
        $.each(renewAMs, function(i, am_id) {
            that.updateStatus('Renewing resources at ' + that.amName(am_id));
            that.output.trigger(that.RENEW_EVENT_TYPE,
                                { name: that.RENEW_EVENT_TYPE,
                                  am_id: am_id,
                                  slice_id: that.sliceId,
                                  expiration_time: renewDate,
                                  callback: that.input,
                                  client_data: {}
                                });
        });
    }
};

JacksApp.prototype.handleDetails = function() {
    var slice_id = this.sliceId;
    var that = this;
    var am_ids = this.sliceAms;
    if (this.selectedNodes.length > 0) {
	am_ids = [];
	$.each(this.selectedNodes, function(i, selected_node) {
		var node_name = selected_node.name;
		var am_id = that.client2am[node_name];
		am_ids.push(am_id);
	    });
    }
    ams_info = "";
    $.each(am_ids, function(i, am_id) {
	    ams_info = ams_info + "&am_id[]=" + am_id;
	});

    var details_url = "listresources.php?slice_id=" + slice_id + ams_info;
    window.location.replace(details_url);
}

JacksApp.prototype.handleStatus = function() {
    var slice_id = this.sliceId;
    var that = this;
    var am_ids = this.sliceAms;
    if (this.selectedNodes.length > 0) {
	am_ids = [];
	$.each(this.selectedNodes, function(i, selected_node) {
		var node_name = selected_node.name;
		var am_id = that.client2am[node_name];
		am_ids.push(am_id);
	    });
    }
    ams_info = "";
    $.each(am_ids, function(i, am_id) {
	    ams_info = ams_info + "&am_id[]=" + am_id;
	});

    var status_url = "sliverstatus.php?slice_id=" + slice_id + ams_info;
    window.location.replace(status_url);
}




//----------------------------------------------------------------------
// Jacks App Events from Jacks
//----------------------------------------------------------------------

JacksApp.prototype.onClickEvent = function(event) {
    // Jacks currently doens't allow multiple selection for outgoing
    // selections. Once Jacks supports this, the following code will need
    // to handle displaying information for multiple items.      

    //    $('.jacks #active').attr('id','');
    //    $('.jacks #'+event['type']+'-'+event['client_id']).parent().attr('id',
    //                                                                 'active');
    debug('Event ' + event.type + ': ' + event.client_id);
    //$('#jacksApp'+ji+' .expandedI').each(function() { $(this).removeClass('expandedI') });
    //$('#jacksApp'+ji+' #list-'+event['client_id']).parent().addClass('expandedI');
};

JacksApp.prototype.onSelectionEvent = function(event) {
    // Deselect objejcts
    this.selectObjects(this.selectedNodes, false);
    this.selectObjects(this.selectedSites, false);
    this.selectObjects(this.selectedLinks, false);

    // Clear out old selection info
    this.selectedNodes = [];
    this.selectedSites = [];
    this.selecedLinks = [];

    // Clear out old selection info
    if (event.type == "node") {
	// Node have key, name
	this.selectedNodes = event.items;
	this.selectObjects(this.selectedNodes, true);
    } else if (event.type == "site") {
	// Sites have key, id, urn
	this.selectedSites = event.items;
	this.selectObjects(this.selectedSites, true);
    } else if (event.type == "link") {
	// Links have key, name
	this.selectedLinks = event.items;
	this.selectObjects(this.selectedLinks, true);
    }
}

JacksApp.prototype.selectObjects = function(objs, select) {
    $.each(objs, function(i) {
	    var obj = objs[i];
	    var key = obj.key;
	    var nodebox = $("#"+key).find('.nodebox');
	    if (nodebox.length > 0) {
		if (select)
		    nodebox.attr('visible', 'true');
		else
		    nodebox.removeAttr('visible');
	    }
	    var checkbox = $("#"+key).find('.checkbox');
	    if (checkbox.length > 0) {
		if (select)
		    checkbox.attr('visible', 'true');
		else
		    checkbox.removeAttr('visible');
	    }
	    // console.log("Select: " + key +  " " + select);
	    //	    $('.nodekbox #' + key)[0].attr('style', 'visibility:visible');
	    //	    $('.nodebox #' + key)[0].attr('visible', 'visible');
	    //	    $('.nodebox #' + key)[0].attr('id', 'ready');

	    
	});
}

//----------------------------------------------------------------------
// Jacks App Events from Embedding Page
//----------------------------------------------------------------------

JacksApp.prototype.onEpManifest = function(event) {

    var that = this;

    if (event.code !== 0) {
        debug("Error retrieving manifest: " + event.output);
        return;
    }

   var rspecManifest = event.value;

    // If first manifest, replace current topology
    if (this.first_manifest_pending) {
	this.jacksInput.trigger('change-topology', [{ rspec: rspecManifest}]);
	this.first_manifest_pending = false;
    } else {
	// Otherwise add to current topology
	this.jacksInput.trigger('add-topology', [{ rspec: rspecManifest}]);
    }
    //

    // A map from sliver_id to client_id is needed by some aggregates
    // for the page to find the correct node class inside of Jacks.
    // Used to highlight nodes when they are ready.
    var jacksXml = $($.parseXML(rspecManifest));

    var that = this;
    var am_id = event.am_id;
    var nodes = jacksXml.find('node');

    // If there are no nodes at this AM, don't poll for status and
    // remove from list of sliceAms
    if (nodes.length === 0) {
	var am_index = this.sliceAms.indexOf(am_id);
	this.sliceAms.splice(am_index, 1);
	this.updateStatus("No resources found at " + this.amName(am_id));

	if(this.sliceAms.length == 0) {
	    if(this.jacks_editor != null) {
		this.jacks_editor.show();
		this.hide();
	    }
	}
	
	return;
    }

    jacksXml.find('node').each(function(i, v) {
        var client_id = $(this).attr('client_id');
        var sliver_id = $(this).attr('sliver_id');
        that.urn2clientId[sliver_id] = client_id;
        // This is needed because some AMs do return the client_id, so
        // the mapping needs to have both to avoid needing special cases.
        that.urn2clientId[client_id] = client_id;

        that.client2am[sliver_id] = am_id;
        // This is needed because some AMs do return the client_id, so
        // the mapping needs to have both to avoid needing special cases.
        that.client2am[client_id] = am_id;

        // Dig out login info
        $(this).find('login').each(function(il, vl) {
            var authn = $(this).attr('authentication');
            var hostname = $(this).attr('hostname');
            var port = $(this).attr('port');
            var username = $(this).attr('username');
	    var login_url = "ssh://" + username + "@" + hostname + ":" + port;
	    if (!(username in that.loginInfo)) {
		that.loginInfo[username] = [];
	    }
	    if (!(client_id in that.loginInfo[username])) {
		that.loginInfo[username][client_id] = [];
	    }
	    that.loginInfo[username][client_id].push(login_url);
            debug(authn + "://" + username + "@" + hostname + ":" + port);
        });
    });

    var maxPollTime = Date.now() + this.maxStatusPollSeconds * 1000;
    this.getStatus(am_id, maxPollTime);
};

JacksApp.prototype.onEpStatus = function(event) {
    debug("onEpStatus");
    if (event.code !== 0) {
        debug("Error retrieving status: " + event.output);
        return;
    }

    // re-poll as necessary up to event.client_data.maxPollTime

    var that = this;
    var agg_urn = that.allAms[event.am_id].urn;

    $.each(event.value, function(i, v) {

// SHOULD PROBABLY CHANGE
      // This only looks for READY and FAILED. There may be other cases to look for.
      // Probably shouldn't poll infinitely.
      if (! that.isTerminalStatus(v)) {
          that.updateStatus('Resources on ' + v['am_name'] + ' are '
                            + v['geni_status'] + '. Polling again in '
                            + that.statusPollDelayMillis/1000 + ' seconds.');
          // Poll again in a little while
          setTimeout(function() {
              that.getStatus(event.am_id, event.client_data.maxTime);
          }, that.statusPollDelayMillis);
      } else if (v['geni_status'] == 'ready') {
          that.updateStatus('Resources on '+v['am_name']+' are ready.');
      } else if (v['geni_status'] == 'failed') {
          that.updateStatus('Resources on '+v['am_name']+' have failed.');
      }

// SHOULD PROBABLY CHANGE
        // This section is for coloring the nodes that are ready.
        // At the moment there is no coloring for failed nodes, etc.
        if (v.hasOwnProperty('resources')) {
            $.each(v['resources'], function(ii, vi) {
                var resourceURN = vi.geni_urn;
		var clientId = that.urn2clientId[resourceURN];
		var jacksId = lookup_jacks_id_from_client_id(agg_urn, clientId,
							     that.currentTopology,
							     'nodes');
                if (vi['geni_status'] == 'ready') {
                    debug(clientId + " (" + resourceURN + ") is ready");
		    $('#' + jacksId).find('.checkbox').attr('id', 'ready');

                } else {
                    debug(clientId + " (" + resourceURN + ") is not ready");
		    $('#' + jacksId).find('.checkbox').removeAttr('id');
		}
            });
    }
    });
};

JacksApp.prototype.onEpDelete = function(event) {
    debug("onEpDelete");
    if (event.code !== 0) {
        debug("Error retrieving status: " + event.output);
        return;
    }

    this.updateStatus("Resources deleted");
    this.getSliceManifests();
};

JacksApp.prototype.onEpDetails = function(event) {
    debug("onEpDetails");
    if (event.code !== 0) {
        debug("Error retrieving status: " + event.output);
        return;
    }
};

JacksApp.prototype.onEpRenew = function(event) {
    debug("onEpRenew");
    if (event.code !== 0) {
        debug("Error renewing at " + this.amName(event.am_id)
                    + ": " + event.output);
        return;
    }
    this.updateStatus("Renewed resources at " + this.amName(event.am_id));
};

JacksApp.prototype.onEpRestart = function(event) {
    debug("onEpRestart");
    if (event.code !== 0) {
        debug("Error restarting at " + this.amName(event.am_id)
                    + ": " + event.output);
        return;
    }
    this.updateStatus("Restarted resources at " + this.amName(event.am_id));

    var maxPollTime = Date.now() + this.maxStatusPollSeconds * 1000;
    this.getStatus(event.am_id, maxPollTime);
    //    this.getSliceManifests();
};

function lookup_jacks_id_from_client_id(agg_urn, client_id, current_topology, obj_type)
{
    var objects = current_topology[obj_type];
    var jacksId = null;
    $.each(objects, function(ii) {
	    var obj = objects[ii];
	    if(obj.aggregate_id == agg_urn && obj.client_id == client_id) {
		jacksId = obj.id;
		return false; // Use instead of break in Jquery each loop
	    }
	});
    return jacksId;
      
}