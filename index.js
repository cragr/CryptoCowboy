'use strict';

//	I'm not the best NodeJS programmer so this is just here to make sure I don't do anything stupid.
const memwatch = require('memwatch-next');
memwatch.on('leak', (info) => 
{
  console.error('Memory leak detected:\n', info);
  
  var leakMessage = "Memory Leak Detected";
	fs.writeFile('memoryLeakDetected.txt', leakMessage, function (err) 
	{
		if (err) throw err;
		console.log('Saved MemLeak!');
	});
  
});

var app = require('express')();
var http = require('http').Server(app);
var fs = require('fs');
var io = require('socket.io')(http);
var request = require("request");
var readLastLines = require('read-last-lines');

/* import RippleAPI and support libraries */
const RippleAPI = require('ripple-lib').RippleAPI;

// Creates an instance of the rippleAPI class
const api = new RippleAPI(
{
	server: 'wss://s1.ripple.com', // Public rippled server
	timeout: 30000,	//	Timeout before RippleAPI transactions failing
	feeCushion: 1.2	//	XRP fee flexibility
});
const assert = require('assert');


// Credentials of the account placing the order - Keep this information private!
const address = 'WALLET-ADDRESS-HERE';	//	Main Wallet
const secret = 'SECRET-KEY-HERE';

// Milliseconds to wait between checks for a new ledger.
const INTERVAL = 3000;

/* Number of ledgers to check for valid transaction before failing */
const ledgerOffset = 10;
const maxFee = "0.00001";
const myInstructions = {maxLedgerVersionOffset: ledgerOffset, maxFee: maxFee};

var programStartingTime = 0;

// Variables
var fixedPoint = 5000.00;	//	This number doesn't really matter because the value gets read from a file at the start of the program

var rangeLow = 0.0075;	//	The lowest possible range for trades. 0.75%
var rangeHigh = 0.05;	//	Highest possible range for trades 5%

var rangeIncrement = 0.0010;	//	How much to increase the range percentage by after every trade. This is used to adapt to volatility
var rangeIncrementTime = 0.0001;	//	How much to decrease the range percentage by after everytime the 'decreaseRange()' function gets called. This is used to nudge a certain number of transactions per day to execute.

var rangePercentage = 0.01;	//	Starting range percentage. This value doesnt matter because it's read from a file at start of program.
var lastTradeRangePercentage = 0.00;	//	This is used to reset orders if a trade has not occured in a long time.

var closeOrders = 1;	//	When this value is '1', the program closes all outstanding orders.

var range = 0.00;

var reserveMultiplier = 0.50;		
var transactionID = 0;
var XRP = 0;
var USD = 0;

var cash = 0.00;
var cashOld = 0.00;
var cashDifference = 0.00;

var reserve = 0.00;
var reserveXRP = 0.00;

var counterparty = 0;
var pricePerShare = 0.00;
var marketValue = 0;
var state = "Stop";
var excecuteDelay = 0;
var connection = "Not connected";
var autoTraderStatus = "Disabled";
var userCount = 0;

var buyVsSell = 0;

var startTime = 0;
var stopTime = 0;

var repeatPrevention = 0;

var totalTransactions = 0;

var dayTradeGains = 0;

var orderPriceBuy = 0.00;
var orderPriceSell = 0.00;


var orderSequence = null;
var orderCancellation = null;
	
var salesMultiplier = 1.00;	
			
var tradeValue = 0.00;			
		
/////
//writeTime();	//	Only call once
//writeFiles();
/////

readFiles();
setTimeout(decreaseRange, 60000);
getPricePerShare();

for (let j = 0; j < process.argv.length; j++) 
{  
	if(j == 2)
	{
		log("Autotrader is booting up.");
		
		api.connect().then(() => 
		{
			connection = "Connected";
			
		}).catch(console.error);
		
		autoTraderStatus = "Enabled";
		state = "Start";
		setTimeout(start, 10000);
	}
    console.log(j + ' -> ' + (process.argv[j]));
}


//	We define a route handler / that gets called when we hit our website home
app.get('/', function(req, res)
{
	res.sendFile(__dirname + '/webpage/index.html');
	
});

app.get('/favicon.ico', function(req, res)
{
	res.sendFile(__dirname + '/webpage/favicon.ico');
	
});

api.on('error', (errorCode, errorMessage) => 
{
  console.log(errorCode + ': ' + errorMessage);
});

api.on('connected', () => 
{
  console.log('connected');
});

api.on('disconnected', (code) => 
{
  // code - [close code](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent) sent by the server
  // will be 1000 if this was normal closure
  console.log('disconnected, code:', code);
});

//	When user connects
io.on('connection', function(socket)
{
	userCount++;
	io.emit('userCount', userCount);
	io.emit('beep', totalTransactions);
	
	console.log('A user connected');
	io.emit('autoTraderStatus', autoTraderStatus);
	updateVariables();
	
	refresh();
	
	readLastLines.read('log.txt', 30)
    .then((lines) => 
	{
		let splitLines = lines.split(/\r?\n/);
		for(var i = 0; i < splitLines.length; i++)
		{
			socket.emit('emit', splitLines[i]);
		}
	});
	
	//	When user sends message
	socket.on('inputReceived', function(message)
	{
		console.log('Message: ' + message);
		io.emit('emit', message);
		
		if(message == "Connect")
		{
			log("Connecting to Ripple API");
			
			api.connect().then(() => 
			{
				log('Connected.');
				connection = "Connected";
				io.emit('connectionStatus', connection);
				
			}).catch(console.error);
		}
		else if(message == "Disconnect")
		{
			log("Disconnecting from Ripple API");
			
			api.disconnect().then(() => 
			{
				log('API disconnected.');
				connection = "Not connected";
				io.emit('connectionStatus', connection);
			}).catch(console.error);
		}
		else if(message == "Exit")
		{
			log("Shutting down server.");
			process.exit();
		}
		else if(message == "Start")
		{
			autoTraderStatus = "Enabled";
			io.emit('autoTraderStatus', autoTraderStatus);
			log("Starting Auto Trader");
			state = "Start";
			start();
		}
		else if(message == "Stop")
		{
			autoTraderStatus = "Disabled";
			io.emit('autoTraderStatus', autoTraderStatus);
			log("Stoping Auto Trader, please wait...");
			
			state = "Stop";
		}
		else if(message == "Reset")
		{
			writeTime();
			dayTradeGains = 0.00;
			totalTransactions = 0;	
			reserve = 0.00;			
			reserveXRP = 0.00;		

			writeFiles();
			
			setTimeout(readFiles, 1000);
			

		}
		else if(message == "BumpRange")
		{
			log("Bumping range.");
			rangePercentage = rangePercentage + rangeIncrement;
		}
		else if(message == "DropRange")
		{
			log("Dropping range.");
			rangePercentage = rangePercentage - rangeIncrement;
		}
	});
  
	
	//	When user disconnects
	socket.on('disconnect', function()
	{
		console.log('User disconnected');
		userCount--;
		io.emit('userCount', userCount);
	});

});

function start()
{
	startTimer();
	updateVariables();
	
	refresh();
	
	writeFiles();
	
	console.log('fixedPoint');
	console.log(fixedPoint);
	console.log('dayTradeGains');
	console.log(dayTradeGains);
	console.log('totalTransactions');
	console.log(totalTransactions);
	
	console.log(' ');
	console.log(' ');
	
	console.log(pricePerShare);

	if(state == "Stop")
	{
		log("Terminating Auto Trader");
		return 0;
	}
	
	api.getOrders(address).then(orders =>
	{
		
		console.log("Showing orders: ");
		console.log(" ");
		console.log(orders);
		console.log(" ");
		console.log("Number of orders: ");
		console.log(" ");
		console.log(orders.length);
		console.log(" ");
		
		
		buyVsSell = 0;
		
		// Make sure 1 buy and 1 sell
		for(var i = 0; i < orders.length; i++)
		{
			if(orders[i].specification.direction == "buy")
			{
				buyVsSell++;
			}
			else if(orders[i].specification.direction == "sell")
			{
				buyVsSell--;
			}

		}
			
		if(repeatPrevention == 0)
		{
			if(buyVsSell > 0)
			{	
				//https://ripple.com/build/rippled-apis/#book-offers
				log("We sold shares!");
				totalTransactions++;
				io.emit('beep', totalTransactions);
	
				dayTradeGains += tradeValue;
				
				let percentageCashVSMax = cash / (marketValue * reserveMultiplier);
				
				if(percentageCashVSMax > 1.0)
				{
					percentageCashVSMax =  1.0;
				}
				
				let inversePercentageCashVsMax = 1.0 - percentageCashVSMax;
				
				if(marketValue > (fixedPoint * 0.95))
				{
					reserve += parseFloat(((parseFloat(tradeValue * (reserveMultiplier / 5.00)) * parseFloat(percentageCashVSMax)) / 10.00).toFixed(2));
						
					reserveXRP += parseFloat(((parseFloat(tradeValue * (reserveMultiplier / 5.00)) * parseFloat(inversePercentageCashVsMax)) / 10.00).toFixed(4));
				}
				
				let mes = "We gained $" + parseFloat(tradeValue.toFixed(2)).toString() + " on that trade.";
				log(mes);
				
				io.emit('dayTradeGains', dayTradeGains);
			}
			else if(buyVsSell < 0)
			{
				io.emit('dayTradeGains', dayTradeGains);

				log("We bought shares!");
				totalTransactions++;
				io.emit('beep', totalTransactions);

			}
			
			if((buyVsSell != 0) && (rangePercentage < rangeHigh))
			{
				rangePercentage = rangePercentage + rangeIncrement;
				lastTradeRangePercentage = rangePercentage;
			}
		}
		
		//	If we need to place orders
		if(orders.length == 0 && closeOrders == 0)
		{
			excecuteDelay = 2;
			
			updateVariables();
			
			if((marketValue * reserveMultiplier) < cash)
			{			
				if(reserveMultiplier < 5.00)
				{
					reserveMultiplier = parseFloat((parseFloat(reserveMultiplier) + 0.001).toFixed(3));
				}
				
				let fixedPointChange = ((range * reserveMultiplier) / 10.0);	//	Max change to fixedpoint is 50% of range
				fixedPoint = (fixedPoint + fixedPointChange);

				range = marketValue * rangePercentage;
				
				reserve += parseFloat((fixedPointChange * (reserveMultiplier / 5.00)).toFixed(2));	//	(At max)50% reinvested, 50% reserve
				
				log(" ");
				log("Our cash is now in a surplus.");
				
				let mes = "Re-investing " + parseFloat(fixedPointChange.toFixed(2)).toString() + " dollars.";
				log(mes);
				
				log("New fixed point: " + (fixedPoint.toFixed(2)).toString());

				log("New range: " + (range.toFixed(2)).toString());

				log("New Reserve Multiplier: " + reserveMultiplier.toString());

				log(" ");
			}
			
			writePriceLog();
			writeTimeout();
			
			buy();
			setTimeout(sell, 30000);
  
		}
		else if ((orders.length == 2 && buyVsSell == 0) && closeOrders == 0)
		{
			console.log("Orders already exist.");
			writeTimeout();
		}
		else if((orders.length != 2 || buyVsSell != 0) || closeOrders == 1)
		{
			closeOrders = 0;
			excecuteDelay = 1;
			repeatPrevention = 1;
			
			if(orders.length > 0)
			{
				orderSequence = orders[0].properties.sequence;
				orderCancellation = {orderSequence: orderSequence};
				
				log("Cancelling outstanding orders. Sequence #" + orderSequence.toString());
				
				api.prepareOrderCancellation(address, orderCancellation, myInstructions).then(prepared => 
				{						
					return api.sign(prepared.txJSON, secret);
				}).then(prepared => 
				{				
					return api.submit(prepared.signedTransaction);
				}).then(result => 
				{
					console.log(result);
				});
			}		
		}

	}).then(() =>
	{
		if(state == "Start" && excecuteDelay == 1)	//	cancel order
		{
			excecuteDelay = 0;
			setTimeout(getPricePerShare, 24000);
			setTimeout(start, 25000);
		}
		else if(state == "Start" && excecuteDelay == 2)	//	Place order
		{
			excecuteDelay = 0;
			setTimeout(getPricePerShare, 69000);
			setTimeout(start, 70000);
		}
		else if(state == "Start" && excecuteDelay == 0)	//	Do nothing
		{
			setTimeout(getPricePerShare, 24000);
			setTimeout(start, 25000);
		}
		else
		{
			log("Terminating Auto Trader");
		}
		
	}).catch(console.error);
};


// ----------------------

/*
(
	function myLoop (i) //	Example function loop
	{          
	   setTimeout(
	   function () 
	   {   
		  alert('hello');          //  your code here                
		  if(--i)
			  myLoop(i);      //  decrement i and call myLoop again if i > 0
	   }, 3000)
	}
)(10);
*/
/*

function cancelOrders(orders, i, delay) //	Example function loop
{          
   setTimeout
   (
	   function () 
	   {   
			//  Start your code here
			orderSequence = orders[(i-1)].properties.sequence;
			orderCancellation = {orderSequence: orderSequence};

			log("Cancelling outstanding orders. Sequence #" + orderSequence.toString());

			api.prepareOrderCancellation(address, orderCancellation, myInstructions).then(prepared => 
			{						
				return api.sign(prepared.txJSON, secret);
			}).then(prepared => 
			{				
				return api.submit(prepared.signedTransaction);
			}).then(result => 
			{
				console.log(result);
			});
			//  End your code here
			
			if(--i)
				cancelOrders(orders, i, delay);      //  decrement i and call myLoop again if i > 0
	   },
	   delay
   )
}
*/
function shutDown()
{
	process.exit();
}


function decreaseRange()
{
	if(rangePercentage > rangeLow)
	{
		//log("Current Range Percentage:");
		//log(rangePercentage);
		rangePercentage = rangePercentage - rangeIncrementTime;
		//log("New Range Percentage(Timeout): " + (rangePercentage * 100.00).toFixed(2) + "%");
		//log(rangePercentage);
		//closeOrders = 1;

		if(lastTradeRangePercentage >= (rangePercentage + 0.005))
		{
			log("We havent detected a trade in a while now... Resetting orders.");
			closeOrders = 1;
			lastTradeRangePercentage = rangePercentage;
		}
	}
	
	let maxCash = (fixedPoint * reserveMultiplier);
	let timeWarp = ((maxCash / 2.00) / cash);	//	Up to double speed (5min) when things are good (when TW = 0.5)
	
	let dropFP = (((fixedPoint - marketValue) / 100.00) / 288.00);	//	1% of delta FP per day when at max speed.
	
	//	Cash should never actually get low, in reality it does happen but we are trying to be resilient to that.
	dropFP = (dropFP * timeWarp);	//	Multiplier when cash is low
	dropFP = (dropFP * timeWarp);	//	Low cash means critical level and it might need saving.
	
	fixedPoint = parseFloat(parseFloat(fixedPoint - dropFP).toFixed(2));
	
	/*
	if(cash <= (fixedPoint * reserveMultiplier / 2.00))	//	If cash is less than half of expected size
	{
		timeoutTime = timeoutTime * timeWarp
	}
	*/
	
	//let timeoutTime = 450000.00;	//	Every 7.5 min
	//	Max speed is every 5 min
	let timeoutTime = 300000.00;	//	Every 5.0 min
	timeoutTime = (timeoutTime * timeWarp);
	timeoutTime = parseInt(timeoutTime);
	
	timeoutTime =  timeoutTime + 300000.00;	//	Add fixed time of 5 min
	
	setTimeout(decreaseRange, timeoutTime);
	//setTimeout(decreaseRange, 900000);	//	Every 15 min
	//setTimeout(decreaseRange, 1800000);	//	Every 30 min
	//setTimeout(decreaseRange, 1440000);	//	Every 24 min (10 times per 4 hours)
	//setTimeout(decreaseRange, 21600000);	//	Every 6 hours
}	
				
/*
function getPrice()
{
	pricePerShare = 
	setTimeout(start, 5000);
}
*/
function buy()
{
	let buyPoint = marketValue - range;	//	Point at which we buy
	let buyPrice = (buyPoint / XRP);	//	Price of shares when we buy
	
	let fixedPointSwayBuy = (fixedPoint / marketValue);	//	Larger when MV is low
	
	orderPriceBuy = buyPrice;

	let shares = Math.floor(range / buyPrice);	//	Shares to trade
	shares = shares * salesMultiplier * fixedPointSwayBuy;
	
	if(shares == 0)
	{
		shares = salesMultiplier;
	}
	
	let cost = Number((shares * buyPrice).toFixed(6));	//	Cost for transaction
	
	//XRP has 6 significant digits past the decimal point. In other words, XRP cannot be divided into positive values smaller than 0.000001 (1e-6). XRP has a maximum value of 100000000000 (1e11).

	//Non-XRP values have 16 decimal digits of precision, with a maximum value of 9999999999999999e80. The smallest positive non-XRP value is 1e-81

	let buyPriceClean = buyPrice.toFixed(4);	//	For text output only
	let costClean = cost.toFixed(4);	//	For text output only
	
	log(" ");
	log("Placing an order to buy " + shares.toFixed(4) + " shares of XRP at $" + buyPriceClean + " for $" + costClean);
	
	console.log('Creating a new order');
	let buyOrder = createBuyOrder(shares, cost);
	api.prepareOrder(address, buyOrder, myInstructions).then(prepared => 
	{
		console.log('Order Prepared');
		return api.getLedger().then(ledger => 
		{
			console.log('Current Ledger', ledger.ledgerVersion);
			return submitTransaction(ledger.ledgerVersion, prepared, secret);
		});
	}).then(() => 
	{

		
	}).catch(console.error);
}
function sell()
{
	//	1% sellPoint
	let sellPoint = marketValue + range;	//	Point at which we sell
	let sellPrice = (sellPoint / XRP);	//	Price of shares when we sell
	orderPriceSell = sellPrice;
	
	let fixedPointSwaySell = (marketValue / fixedPoint);		//	Larger when MV is High
	
	let shares = Math.floor(range / sellPrice);	//	Shares to trade
	shares = shares * salesMultiplier * fixedPointSwaySell;
	
	if(shares == 0)
	{
		shares = salesMultiplier;
	}
	
	let cost = Number((shares * sellPrice).toFixed(6));	//	Cost for transaction
	
	tradeValue = parseFloat(cost) * rangePercentage;
	
	let sellPriceClean = sellPrice.toFixed(4);	//	For text output only
	let costClean = cost.toFixed(4);	//	For text output only

	log("Placing an order to sell " + shares.toFixed(4) + " shares of XRP at $" + sellPriceClean + " for $" + costClean);

	//let orderSuccess = api.prepareOrder(address, createSellOrder(shares, cost), myInstructions).then(prepared => 
	api.prepareOrder(address, createSellOrder(shares, cost), myInstructions).then(prepared => 
	{
		console.log('Order Prepared');
		return api.getLedger().then(ledger => 
		{
			repeatPrevention = 0;
			console.log('Current Ledger', ledger.ledgerVersion);
			return submitTransaction(ledger.ledgerVersion, prepared, secret);
		});
	}).catch(console.error);
}

function getPricePerShare()
{
	/*
	var options = 
	{
		host: 'https://data.ripple.com/v2/exchange_rates/XRP/USD+rMwjYedjc7qqtKYVLiAccJSmCwih4LnE2q',
		path: '/'
	}
	*/
	//https://data.ripple.com/v2/account/rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq/orders
	//let url = "https://www.bitstamp.net/api/v2/ticker/xrpusd/";
		
	//let url = "https://data.ripple.com/v2/exchange_rates/XRP/USD+rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq"	//	USDS wallet this was in use
	let url = "https://data.ripple.com/v2/exchanges/XRP/USD+rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq?descending=true&limit=1"	//	Gatehub, works

	console.log("Getting price");
	request
	({
		url: url,
		json: true
	}, function (error, response, body) 
	{
		console.log("...");
		if (!error && response.statusCode === 200) 
		{
			//pricePerShare = parseFloat(body.rate);
			pricePerShare = parseFloat(body.exchanges[0].rate);
			console.log('Reading price: ', pricePerShare);
			io.emit('pricePerShare', pricePerShare);
		}
		else
		{
			log("Error getting price");
			log(response);

		}
		console.log(body);
	})
}

//Buy XRP
function createBuyOrder(shares, cost)
{
	let stringShare = shares.toString();
	let stringCost = cost.toString();
	
	let buyOrder = 
	{
	  "direction": "buy",
	  
	  "quantity": 
	  {
		"currency": "XRP",
		"value": stringShare
	  },
	  
	  "totalPrice": 
	  {
		"currency": "USD",
		"counterparty": "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq",
		"value": stringCost
	  },
	  
	  "passive": true,
	  
	  "fillOrKill": false
	};
	
	return buyOrder;
}

//Sell XRP
function createSellOrder(shares, cost)
{
	let stringShare = shares.toString();
	let stringCost = cost.toString();
	
	
	let sellOrder = 
	{
	  "direction": "sell",
	  
	  "quantity": 
	  {
		"currency": "XRP",
		"value": stringShare
	  },
	  
	  "totalPrice": 
	  {
		"currency": "USD",
		"counterparty": "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq",
		"value": stringCost
	  },
	  
	  "passive": true,
	  
	  "fillOrKill": false
	};
	
	return sellOrder;
}

function log(message)
{
	let messageWithTime = getDateTime() + ": " + message.toString() + "\n";
	
	if(message == " " || message == "\n")
	{
		messageWithTime = message + "\n";
	}
	
	console.log(messageWithTime);
	io.emit('emit', message);
	
	fs.appendFile('log.txt', messageWithTime, function (err) 
	{
		//if (err) throw err;
		//console.log('Saved priceLogChart!');
	});
}

function verifyTransaction(hash, options) 
{
  console.log('Verifing Transaction');
  return api.getTransaction(hash, options).then(data => 
  {
    console.log('Final Result: ', data.outcome.result);
    console.log('Validated in Ledger: ', data.outcome.ledgerVersion);
    console.log('Sequence: ', data.sequence);
    return data.outcome.result === 'tesSUCCESS';
  }).catch(error => 
  {
    /* If transaction not in latest validated ledger,
       try again until max ledger hit */
    if (error instanceof api.errors.PendingLedgerVersionError) 
	{
      return new Promise((resolve, reject) => 
	  {
        setTimeout(() => verifyTransaction(hash, options)
        .then(resolve, reject), INTERVAL);
      });
    }
    return error;
  });
}

/* Function to prepare, sign, and submit a transaction to the XRP Ledger. */
function submitTransaction(lastClosedLedgerVersion, prepared, secret) 
{
	const signedData = api.sign(prepared.txJSON, secret);
	return api.submit(signedData.signedTransaction).then(data => 
	{
		console.log('Tentative Result: ', data.resultCode);
		console.log('Tentative Message: ', data.resultMessage);
		/* If transaction was not successfully submitted throw error */
		assert.strictEqual(data.resultCode, 'tesSUCCESS');
		/* 'tesSUCCESS' means the transaction is being considered for the next ledger, and requires validation. */

		/* If successfully submitted, begin validation workflow */
		const options = 
		{
			minLedgerVersion: lastClosedLedgerVersion,
			maxLedgerVersion: prepared.instructions.maxLedgerVersion
		};
		return new Promise((resolve, reject) => 
		{
			setTimeout(() => verifyTransaction(signedData.id, options).then(resolve, reject), INTERVAL);
		});
	});
}

function startTimer()
{
	startTime = new Date();
	startTime = Math.floor(startTime / 1000);
}

function stopTimer()
{
	stopTime = new Date();
	stopTime = Math.floor(stopTime / 1000);
}

function refresh()
{
	io.emit('pricePerShare', pricePerShare);
	io.emit('USD', cash);
	io.emit('XRP', XRP);
	io.emit('fixedPoint', fixedPoint);
	io.emit('range', range);
	io.emit('salesMultiplier', salesMultiplier);
	io.emit('reserve', reserve);
	io.emit('reserveXRP', reserveXRP);
	io.emit('dayTradeGains', dayTradeGains);
	io.emit('connectionStatus', connection);
	io.emit('reserveMultiplier', reserveMultiplier);
	io.emit('orderPriceBuy', orderPriceBuy);
	io.emit('orderPriceSell', orderPriceSell);
	
	hours();
}

	
function hours()
{
	let programCurrentTime = new Date();
	programCurrentTime = Math.floor(programCurrentTime / 1000);
	
	let programElapsedTime = programCurrentTime - programStartingTime; 
	programElapsedTime = (programElapsedTime / 3600);
	io.emit('hours', programElapsedTime);
}

function readFiles()
{
	fs.readFile('date.txt', function(err, data) 
	{
		programStartingTime = parseInt(data);
		programStartingTime = Math.floor(programStartingTime / 1000);
		console.log(programStartingTime);
	});
	
	fs.readFile('dayTradeGains.txt', function(err, data) 
	{
		dayTradeGains = parseFloat(data);
		console.log(dayTradeGains);
	});
	
	fs.readFile('totalTransactions.txt', function(err, data) 
	{
		totalTransactions = parseInt(data);
		console.log(totalTransactions);
	});
	
	fs.readFile('fixedPoint.txt', function(err, data) 
	{
		fixedPoint = parseFloat(data);
		console.log(fixedPoint);
	});
	
	fs.readFile('reserve.txt', function(err, data) 
	{
		
		reserve = parseFloat(data);
		//console.log("Line 804: Reserve:");
		//console.log(reserve);
		//console.log(typeof(reserve));
	});
	
	fs.readFile('rangePercentage.txt', function(err, data) 
	{
		rangePercentage = parseFloat(data);
		console.log(rangePercentage);
	});
	
	fs.readFile('reserveMultiplier.txt', function(err, data) 
	{
		reserveMultiplier = parseFloat(parseFloat(data).toFixed(3));
		console.log(reserveMultiplier);
	});
	
	fs.readFile('reserveXRP.txt', function(err, data) 
	{
		reserveXRP = parseFloat(parseFloat(data).toFixed(4));
		console.log(reserveXRP);
	});
	
	io.emit('beep', totalTransactions);
}

// Only use once
function writeTime()
{
	let getTime = new Date();
	getTime = getTime.getTime();
	fs.writeFile('date.txt', getTime, function (err) 
	{
		if (err) throw err;
		console.log('Saved!');
	});
}

function writeFiles()
{
	fs.writeFile('dayTradeGains.txt', dayTradeGains, function (err) 
	{
		if (err) throw err;
		console.log('Saved gains!');
	});
	
	fs.writeFile('totalTransactions.txt', totalTransactions, function (err) 
	{
		if (err) throw err;
		console.log('Saved transactions count!');
	});
	
	fs.writeFile('fixedPoint.txt', fixedPoint, function (err) 
	{
		if (err) throw err;
		console.log('Saved fixedPoint!');
	});
	
	fs.writeFile('reserve.txt', reserve, function (err) 
	{
		if (err) throw err;
		console.log('Saved reserve!');
		
		//console.log("Line 857: Reserve:");
		//console.log(reserve);
		//console.log(typeof(reserve));
	});
	
	fs.writeFile('rangePercentage.txt', rangePercentage, function (err) 
	{
		if (err) throw err;
		console.log('Saved rangePercentage!');
	});
	
	fs.writeFile('reserveMultiplier.txt', reserveMultiplier, function (err) 
	{
		if (err) throw err;
		console.log('Saved reserveMultiplier!');
	});
	
	fs.writeFile('reserveXRP.txt', reserveXRP, function (err) 
	{
		if (err) throw err;
		console.log('Saved XRP Reserve!');
	});
	
}


function writePriceLog()
{
	let getTime = new Date();
	getTime = getTime.getTime();
	getTime = parseInt(getTime);
	getTime = Math.floor(getTime / 1000);
	getTime = getTime - programStartingTime;
	
	let priceLogLine = (getTime.toString() + ", " + pricePerShare.toString() + ", " + USD.toString() + ", " + marketValue.toString() + ", " + XRP.toString() + ", \n");
	fs.appendFile('priceLog.csv', priceLogLine, function (err) 
	{
		if (err) throw err;
		console.log('Saved priceLogLine!');
	});
	//console.log("Line 891: Reserve:");
	//console.log(reserve);
	//console.log(typeof(reserve));
	let netWorthValue = (parseFloat(USD) + parseFloat(marketValue));
	netWorthValue = parseFloat(netWorthValue.toFixed(2));

	let priceLogChart = (getTime.toString() + ", " + pricePerShare.toString() + ", " + netWorthValue.toString() + ", \n");
	fs.appendFile('priceLogChart.csv', priceLogChart, function (err) 
	{
		if (err) throw err;
		console.log('Saved priceLogChart!');
	});
}

function writeTimeout()
{
	let getTime = new Date();
	getTime = getTime.getTime();
	fs.writeFile('timeOut.txt', getTime, function (err) 
	{
		if (err) throw err;
		console.log('Saved timeout!');
	});
}

//	We make the http server listen on port 8080
http.listen(8080, function()
{
	console.log('listening on *:8080');
});

function updateVariables()
{
	//getPricePerShare();
	getBalance();
	
	console.log("XRP");
	console.log(typeof(XRP));
	console.log(XRP);
	
	console.log("ppS");
	console.log(typeof(pricePerShare));
	console.log(pricePerShare);
	
	marketValue = (XRP * pricePerShare);
	
	console.log("Updating MV");
	console.log(typeof(marketValue));
	console.log(marketValue);
	
	range = marketValue * rangePercentage;
	
	let lowerValue = 0.00;
	if(cash >= marketValue)
	{
		lowerValue = marketValue;
	}
	else
	{
		lowerValue = cash;
	}
	
	salesMultiplier = (((lowerValue - 1.00) / range) / 20.00);	//	5% of either cash or MV, whichever is lower
}

function getBalance()
{
	api.getBalances(address).then(balances => 
	{
		
		console.log('Checking balance...');
		console.log(balances);
		
		for(var i = 0; i < balances.length; i++)
		{
			if(balances[i].currency == "XRP")
			{
				let resultMessage = "XRP: ";
				
				XRP = balances[i].value;
				
				reserveXRP = parseFloat(reserveXRP);
				
				XRP = (XRP - reserveXRP);
				
				resultMessage += XRP;
				console.log(resultMessage);
				console.log(" ");
				io.emit('XRP', XRP);
			}
			else if(balances[i].currency == "USD" && balances[i].counterparty == "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq")
			{
				let resultMessage = "USD: $";
				USD = balances[i].value;
				
				cash = parseFloat(USD);
				
				if(cashOld == 0.00)
				{
					cashOld = cash;
				}
				
				cashDifference = cash - cashOld;
				
				//fixedPoint = fixedPoint - cashDifference;
				//range = fixedPoint  * rangePercentage;
				
				reserve = parseFloat(reserve);
				
				
				cash = (cash - reserve);	

				resultMessage += USD;
				counterparty = balances[i].counterparty;
				console.log(resultMessage);
				//console.log("CounterParty: " + counterparty);
				console.log(" ");
				io.emit('USD', cash);
				
				if(cash < (range * 2.00 * salesMultiplier) || cash <= 1.00)
				{
					log("Out of cash, shutting down server.");
					
					log("Disconnecting from Ripple API");
			
					api.disconnect().then(() => 
					{
						log('API disconnected.');
						connection = "Not connected";
						io.emit('connectionStatus', connection);
					}).catch(console.error);
			
					setTimeout(shutDown, 1000);
				}
			}
		}
	}).catch(console.error);
}

function getDateTime(unit) 
{
    var date = new Date();

    var hour = date.getHours();
    hour = (hour < 10 ? "0" : "") + hour;

    var min  = date.getMinutes();
    min = (min < 10 ? "0" : "") + min;

    var sec  = date.getSeconds();
    sec = (sec < 10 ? "0" : "") + sec;

    var year = date.getFullYear();

    var month = date.getMonth() + 1;
    month = (month < 10 ? "0" : "") + month;

    var day  = date.getDate();
    day = (day < 10 ? "0" : "") + day;

	if(unit == "hour")
	{
		return hour.toString();
	}
	else if (unit == "min")
	{
		return min.toString();
	}
	else if (unit == "sec")
	{
		return sec.toString();
	}
	else if (unit == "year")
	{
		return year.toString();
	}
	else if (unit == "month")
	{
		return month.toString();
	}
	else if (unit == "day")
	{
		return day.toString();
	}
	else
	{
		return ("[ " + year.toString() + "-" + month.toString() + "-" + day.toString() + " ][ " + hour.toString() + ":" + min.toString() + ":" + sec.toString() + " ]");
	}
}


//https://www.npmjs.com/package/read-last-lines