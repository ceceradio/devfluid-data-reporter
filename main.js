var exec = require('child_process').exec,
    child;
var rest = require('restler');
var service = require ("windows-service");
var fs = require('fs');
var config = require('./config.js');

var INTERVAL_LENGTH = 5000;
var initialSample = true;
var lastReceived = 0;
var lastSent = 0;
var standby_lastRx = 0;
var standby_lastTx = 0;
var dataRates = [];
var COUNT_THRESHOLD = 30;
var thresholdMultiplier = 1;

if (process.argv[2] == "--add") {
    service.add ("devFluid Reporter", {programArgs: ["--run"]});
} else if (process.argv[2] == "--remove") {
    service.remove ("devFluid Reporter");
} else if (process.argv[2] == "--run") {
    var logStream = fs.createWriteStream (process.argv[1] + ".log");

    service.run (logStream, function () {
        service.stop (0);
    });

    // Run service program code...
	setInterval(function() {
	child = exec('wmic path Win32_PerfRawData_Tcpip_NetworkInterface get BytesReceivedPersec,BytesSentPersec,BytesTotalPersec,Name',function(error, stdout, stderr) {
			var numbers = null;
			var arrayOfLines = stdout.match(/[^\r\n]+/g);
			
			for(var i = 0; i < arrayOfLines.length; i++) {	
				if (arrayOfLines[i].indexOf(config.adapterName) > -1) {
					numbers = arrayOfLines[i].match(/\d+/g);
					break;
				}
			}
			if (numbers == null) {
				console.log('Could not find line');
				return; 
			}
			console.log("\r\nData:\r\nRx: "+numbers[0]+" Bytes\t\tTx: "+numbers[1]+" Bytes");
			
			// if our byte counter is greater than last time
			// then we can send data
			if (numbers[0] >= lastReceived && numbers[1] >= lastSent && !initialSample) {
				dataRates.push({
					localTimestamp: Date.now(),
					received: numbers[0] - lastReceived,
					sent: numbers[1] - lastSent
				});
				//console.log("Rates:\r\nRx: "+((numbers[0] - lastReceived)/(INTERVAL_LENGTH/1000))+"B/s\t\tTx: "+((numbers[1] - lastSent)/(INTERVAL_LENGTH/1000))+"B/s");
				lastReceived = numbers[0];
				lastSent = numbers[1];
			}
			else if (numbers[0] == 0 || numbers[1] == 0) {
				// network is off, don't do anything
			}
			else {
				lastReceived = numbers[0];
				lastSent = numbers[1];
				initialSample = false;
			}
			
			if (dataRates.length >= COUNT_THRESHOLD * thresholdMultiplier) {
				sendData();
			}
		});
	}, INTERVAL_LENGTH);
} else {
    // Show usage...
}
function sendData() {
	var tmpData = dataRates;
	dataRates = [];
	var postData = {
		device: config.deviceName,
		dataRates: JSON.stringify(tmpData),
		access_token: config.access_token
	};
	console.log(postData);
	rest.post(config.api_endpoint,
		{ data: postData })
	.on('complete', 
		function(data, response) {
			console.log(data);
		}
	)
	.on('error',
		function(err, response) {
			thresholdMultiplier++;
			dataRates = tmpData.concat(dataRates);
		}
	)
	.on('success',
		function(data,response) {
			thresholdMultiplier=1;
		}
	);
}