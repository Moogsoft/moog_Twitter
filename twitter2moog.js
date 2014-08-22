#!/usr/share/moogsoft/connectors/node/bin/node
// -----------------------------------------------------------
// twitter2Moog
// 
// Uses the twitter API to turn relevsnt tweets
// into Moog comapatible events. 
//
// (c) Moogsoft Ltd. 2014
// 
// This script is contributed and as such is 
// supported only on a best effort basis.
//
// -----------------------------------------------------------

// Required built in modules

var net = require('net');
//var twitter = require('/usr/share/moogsoft/connectors/node/node_modules/ntwitter');
var twitter = require('./node_modules/ntwitter');

// Process any command line arguemnts

var appName="Twitter";
var scriptName=process.argv[1];
var cmdLineOpts=getOpts(process.argv.slice(2));

// Use the command line args or the defaults.

var defaultConfigFile="./twitter2moog.conf";
var defaultUtilsFile="./twitter2moog.utils";
var defaultLogLevel="info";
var defaultRetries=3;
var retryCount=0;
var moogRetryCount=0;

var configFile=cmdLineOpts.config ? cmdLineOpts.config : defaultConfigFile;
var utilsFile=cmdLineOpts.utils ? cmdLineOpts.utils : defaultUtilsFile;
var logLevel=cmdLineOpts.loglevel ? cmdLineOpts.loglevel : defaultLogLevel ;


// Source in the specific modules. 

var t2mConfig = require(configFile);
var utils = require(utilsFile);

// Set some logging defaults.

var logger=new utils.Logger;
logger.setLogLevel(logLevel);
logger.warning("======== "+ appName + " 2 Incident.Moog Connector =========");

//  Globals for the connections

var twitterConnection;
var moogConnection;


//
// Set some actions when signals are recieved.
//

process.on('SIGINT', function() {
  exit_app("SIGINT recieved, exiting",3);
});

process.on('SIGTERM', function() {
  exit_app("SIGTERM recieved, exiting",3);
});



//
// Configuration checks
// 

// Check that we have enough config to proceed. 


if ( typeof t2mConfig.twitterConf === 'undefined' || typeof t2mConfig.moogServer === 'undefined' ) {
	exit_app("Could not find required configuration for Twitter and Incident.MOOG in " + configFile ,2);
}

// Twitter config

var twitterStreamType=t2mConfig.twitterConf.streamType ? t2mConfig.twitterConf.streamType : "statuses/filter";
var twitterStreamFilter=t2mConfig.twitterConf.streamFilter || exit_app("A stream filter must be configured in " + configFile,2);
var maxRetryCount=t2mConfig.twitterConf.retries || defaultRetries;

// Twitter API credentials

if ( typeof t2mConfig.twitterConf.credentials === 'undefined' ) {
	exit_app("Counld not find any Twitter API credentials in " + configFile,2);
}

var twitterConsumerKey=t2mConfig.twitterConf.credentials.consumer_key || exit_app("No Twitter consumer key found in " + configFile,2);
var twitterConsumerSecret=t2mConfig.twitterConf.credentials.consumer_secret || exit_app("No Twitter consumer secret found in " + configFile,2);
var twitterAccessTokenKey=t2mConfig.twitterConf.credentials.access_token_key || exit_app("No Twitter access token key found in " + configFile,2);
var twitterAccessTokenSecret=t2mConfig.twitterConf.credentials.access_token_secret || exit_app("No Twitter access token secret found in " + configFile,2);

// Moog configuration

var moogServer=t2mConfig.moogServer.host || exit_app("Config: No Moog server host found",2);
var moogPort=t2mConfig.moogServer.port || exit_app("Config: No Moog server port found",2);
var moogMaxRetryCount=t2mConfig.moogServer.retries || defaultRetries;


logger.warning("Configuration checks passed...");
logger.warning("----------------------------------------------------");
logger.warning("Moog server " + moogServer + ":" + moogPort);
logger.warning("Moog server connection retry count: " + moogMaxRetryCount);
logger.warning("Twitter API connection retry count: " + maxRetryCount);
logger.warning("LogLevel set to " + logLevel);

// Show what stream filters we are looking for.

var numFilters=0;
for ( var sf in twitterStreamFilter ) {
	if ( typeof twitterStreamFilter[sf] !== 'function' ) {
		logger.warning("Filtering Tweets on : " + "[ " + sf + " ]  : "  + twitterStreamFilter[sf].join(", "));
		numFilters++;
	}
}
if ( numFilters === 0 ) {
	exit_app("A set of filter cirteria need to be supplied in " + configFile,2);
}

logger.warning("----------------------------------------------------");

//
// Establish the connections to the  and Moog server
//


connectToMoog();


// Functions


function connectToMoog() {

	moogRetryCount++;
	if ( moogRetryCount > moogMaxRetryCount ) {
		exit_app("Could not connect to the Moog Server - retry count exceeded",1);
	}
	logger.warning("Connecting to the Moog Server (attempt " + moogRetryCount + " of " + moogMaxRetryCount + ")");
		
	moogConnection = net.connect(moogPort,moogServer, function() {
		logger.info("Connected to the Moog Server " + moogServer +":"+moogPort);
		listenForTweets();
	});

	moogConnection.on('error', function(err) {
		if (err.message.indexOf('REFUSED')) {
			logger.warning("Connection to the Moog Server " + moogServer + ":" + moogPort + " refused - retrying");
			setTimeout( function() { connectToMoog() }, 5000 );
		}
		else {
			logger.warning("Connection to the Moog Server failed - retrying");
			setTimeout( function() { connectToMoog() }, 5000 );
		}
	});

	moogConnection.on('end', function() { 
		logger.warning("Connection to the Moog Server closed - retrying");
		setTimeout( function() { connectToMoog() }, 5000 );
	});
}


function listenForTweets() {
	
	retryCount++;
	if ( retryCount > maxRetryCount ) {
		exit_app("Could not connect to the Twitter API - retry count exceeded",1);
	}
	logger.warning("Connecting to the Twitter API (attempt " + retryCount + " of " + maxRetryCount+")");

	twitterConnection = new twitter({
    			consumer_key: twitterConsumerKey,
    			consumer_secret: twitterConsumerSecret,
    			access_token_key: twitterAccessTokenKey,
    			access_token_secret: twitterAccessTokenSecret
	});

	// Let's verify we are ok 

	twitterConnection.verifyCredentials(function (err, data) {
		if ( err )  {

			exit_app("Cound not verify connection to Twitter API, exiting",2);
		}
		else {
			logger.warning("Connection to the Twitter API verified");
		}
			
  	})
			
	// Get a stream of tweets based on the filters defined. 

	twitterConnection.stream(twitterStreamType,twitterStreamFilter , function(tweetStream) 
	{

		tweetStream.on('data',function(t) {
			processTweet(t);
		});
		tweetStream.on('end',function(res) {
			logger.warning("Twitter API connection closed (end) retrying - attempt " + retryCount + " of " + maxRetryCount);
			listenForTweets();
		});
		tweetStream.on('error',function(source,error) {
			logger.warning("Twitter API connection error : http error " + error ) ;
		});
	});
}

function processTweet(t) {

	var tweet=t;

	if ( typeof tweet.text === 'undefined' || 
		( typeof tweet.user === 'undefined' || typeof tweet.user.followers_count === 'undefined' ) )  {

			logger.warning("Received a tweet without enough data to construct an event");	
			return;
	}

	// We want a unique id for this tweet for the signature. 

	var tweetText=tweet.text;
	var tweetFollowers=tweet.user.followers_count;
	logger.debug("Tweet recieved: " + tweetText);

	// We will use the recieved/processed time rather than the tweet created time.

	var tweetTime = Math.round(Date.now() / 1000)

	// We want a unique id for this tweet for the signature. 
	var tweetId=tweet.id || tweet.text.length + tweetFollowers ;

	// Create an event, populate it and send it to the LAM.

	var tweetEvent=new utils.MoogEvent;

	tweetEvent.signature="@TWITTER->" + tweetId;
	tweetEvent.source="twitter";
	tweetEvent.external_id=tweetId;
	tweetEvent.description=tweetText;
	tweetEvent.first_occurred=tweetTime;
	tweetEvent.agent_time=tweetTime;
	tweetEvent.severity=getTweetSeverity(tweetFollowers);

	// Send the event to the LAM.
	moogConnection.write(JSON.stringify(tweetEvent) + "\n");

}

function getTweetSeverity(numFoll) {

	// Simple follower based severity

	if ( numFoll <= 10 ) { return 1; }
	if ( numFoll > 10 && numFoll <= 50) { return 2; }
	if ( numFoll > 50 && numFoll <= 100) { return 3; }
	if ( numFoll > 100 && numFoll <= 200) { return 4; }
	if ( numFoll > 200 ) { return 5; }
}
				
function exit_app(m,c) {

	try {
		// Try and close any open connections. 
		moogConnection.destroy();
		twitterConnection.destroy();
	}
	catch(e) { }
	logger.critical(m);
	logger.critical("=============== "+ appName + " 2 Incident.Moog Exited ====================");
	process.exit(c);
}
		
function getOpts(opts) {

        // The options beginning with a "-" are 
        // flag, the ones that aren't are values.

        // create an object with flags and values. 
        var options={};
        for ( var optIdx = 0; optIdx < opts.length ; optIdx++ ) {

                var flagRe=/^(?:-{1,2})(\w+)$/gi;
                var valueRe=/^[^\-]/;

                var option = opts[optIdx];
                var isFlag=flagRe.exec(option);

                if ( isFlag !== null && isFlag.length > 1 ) {

                        var optionName=isFlag[1].toLowerCase();

			if ( optionName === 'h' || optionName === 'help' ) {

				var helpText="";
				helpText += "\n============= "+appName+" 2 Incident.Moog Connector =========\n";
				helpText += "Usage: " + scriptName + "\n\n";
				helpText += "[ --config <file> ]\t:\tconfig file name (defaults to " + defaultConfigFile + ")\n";
				helpText += "[ --utils <file> ]\t:\tutils file name (defaults to " + defaultUtilsFile + "\n";
				helpText += "[ --loglevel (info|warn|debug|all) ]\t:\tlog message level (defaults to info)\n";
				helpText +="\n";
				console.log(helpText);
				process.exit(0);
			}
                        // We've got a flag, check the next arg to 
                        // see if it's a value (i.e. not a flag.
                        var valueIdx=optIdx + 1;
                        if ( valueIdx < opts.length ) {
                                var value = opts[valueIdx];
                                var isValue=valueRe.test(value);
                                if ( isValue === true ) {

                                        // We've got a value, set it, and increment the index.  
                                        // to skip over this value on the next loop.
                                        options[optionName]=value;
                                        optIdx++;
                                }
                                else {
                                        // We got antother flag, so just set this.
                                        options[optionName]=true;
                                }
                        }
                        else {

                                options[optionName]=true;
                        }
                }
                                
        }
        return(options);
}
