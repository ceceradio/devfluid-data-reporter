var config = require('./config.js');
var exec = require('child_process').exec,
    child;
var rest = require('restler');
var service = require ("windows-service");
var fs = require('fs');
var sqlite3;
var db;
var express;
var app;


var INTERVAL_LENGTH = 5000;
var initialSample = true;
var lastReceived = 0;
var lastSent = 0;
var standby_lastRx = 0;
var standby_lastTx = 0;
var dataRates = [];
var COUNT_THRESHOLD = 30;
var DAYS_TO_STORE = 2
var MS_PER_DAY =  1000 * 60 * 60 * 24;
//var thresholdMultiplier = 1;

if (process.argv[2] == "--add") {
    service.add ("devFluid Reporter", {programArgs: ["--run"]});
} else if (process.argv[2] == "--remove") {
    service.remove ("devFluid Reporter");
} else if (process.argv[2] == "--run") {
    var logStream = fs.createWriteStream (process.argv[1] + ".log");

    service.run (logStream, function () {
        service.stop (0);
    });
	sqlite3 = require("sqlite3");
	
	db = new sqlite3.Database(config.dbFile);
	db.serialize(function() {
		db.run(
			"CREATE TABLE IF NOT EXISTS data_events ("+
			"id INTEGER PRIMARY KEY, "+
			"device TEXT, "+
			"localTimestamp INTEGER, "+
			"received INTEGER, "+
			"sent INTEGER ) "
		);
	});
	
	if (isSqliteEnabled()) {
		var express = require('express')
		var app = express()
		// Add headers
		app.use(function (req, res, next) {
			// Website you wish to allow to connect
			res.setHeader('Access-Control-Allow-Origin', '*');

			// Request methods you wish to allow
			res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

			// Request headers you wish to allow
			res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

			// Pass to next layer of middleware
			next();
		});
		app.get('/', function (req, res) {
			
			db.serialize(function() {  
				db.all("SELECT * FROM data_events ORDER BY localTimestamp DESC LIMIT 1000", function(err, rows) {
					if (err) {
						res.send(err, 500);
						return;
					}
					res.json(rows);
				});
			});
		})

		app.listen(config.dbServerPort, 'localhost')
	}
	
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
			
			if (dataRates.length >= COUNT_THRESHOLD) {
				sendData();
			}
		});
	}, INTERVAL_LENGTH);
} else {
    // Show usage...
}
function isSqliteEnabled() {
	if (typeof config.saveMode == "string" && config.saveMode == "sqlite") {
		return true;
	}
	else if (config.saveMode instanceof Array) {
		if (config.saveMode.indexOf("sqlite")>-1)
			return true;
	}
	return false;
}
function sendData() {
	var tmpData = dataRates;
	dataRates = [];
	if (typeof config.saveMode == "string") {
		switch(config.saveMode) {
			case "api":
				sendData_api(tmpData);
				break;
			case "sqlite":
				sendData_sqlite(tmpData);
				break;
		}
	}
	else if (config.saveMode instanceof Array) {
		if (config.saveMode.indexOf("api")>-1)
			sendData_api(tmpData);
		if (config.saveMode.indexOf("sqlite")>-1)
			sendData_sqlite(tmpData);
	}
}
function sendData_sqlite(data) {
	db.serialize(function() {  
		var stmt = db.prepare("INSERT INTO data_events (device, localTimestamp, received, sent) VALUES (?,?,?,?)");
		var insertObj = [0,1,2,3];
		for (var i = 0; i < data.length; i++) {
			insertObj[0]=config.deviceName;
			insertObj[1]=data[i].localTimestamp;
			insertObj[2]=data[i].received;
			insertObj[3]=data[i].sent;
			stmt.run(insertObj);
		}
		stmt.finalize();
		var cullingTime = Date.now() - MS_PER_DAY * DAYS_TO_STORE;
		db.run("DELETE FROM data_events WHERE localTimestamp < " + cullingTime);
	});
}
var apiResendableData = [];
function sendData_api(tmpData) {
	tmpData = apiResendableData.concat(tmpData);
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
			apiResendableData = tmpData;
		}
	)
	.on('success',
		function(data,response) {
			apiResendableData = [];
		}
	);
}