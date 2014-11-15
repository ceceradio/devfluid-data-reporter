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
	child = exec('netstat -e',function(error, stdout, stderr) {
			var numbers = stdout.match(/\d+/g);
			
			//console.log("\r\nData:\r\nRx: "+numbers[0]+" Bytes\t\tTx: "+numbers[1]+" Bytes");
			
			// check to see if we are 'waking' from standby. numbers will go 'back up'
			// we should resample at this point
			if (standby_lastRx > 0 && standby_lastTx > 0 && numbers[0] > standby_lastRx && numbers[1] > standby_lastTx) {
				standby_lastRx = 0;
				standby_lastTx = 0;
				initialSample = true;
			}
			
			// if our byte counter is greater than last time & we don't need to resample
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
			// if our byte counter is less,  we are probably in standby
			else {
				// if we are just resampling, don't log the previous numbers as our standby state
				if (!initialSample) {
					standby_lastRx = lastReceived;
					standby_lastTx = lastSent;
				}
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