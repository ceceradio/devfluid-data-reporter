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
var dataRates = [];
var COUNT_THRESHOLD = 30;

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
	child = exec('netstat -e',function(error, stdout, stderr) {
			var numbers = stdout.match(/\d+/g);
			// first is received bytes, second is sent bytes
			if (initialSample) { 
				lastReceived = numbers[0];
				lastSent = numbers[1];
				initialSample = false;
				return;
			}
			if (numbers[0] >= 0 && numbers[1] >= 0) {
				dataRates.push({
					localTimestamp: Date.now(),
					received: numbers[0] - lastReceived,
					sent: numbers[1] - lastSent
				});
				console.log("Rates:\r\nRx: "+((numbers[0] - lastReceived)/(INTERVAL_LENGTH/1000))+"B/s\t\tTx: "+((numbers[1] - lastSent)/(INTERVAL_LENGTH/1000))+"B/s");
				lastReceived = numbers[0];
				lastSent = numbers[1];
			}
			
			if (dataRates.length >= COUNT_THRESHOLD) {
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
	rest.post(config.api_endpoint,
		{ data: postData }).on('complete', 
		function(data, response) {
			console.log(data);
		}
	);
}