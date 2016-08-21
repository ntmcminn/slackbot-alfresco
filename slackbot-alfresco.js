const cmis = require('cmis');
const botkit = require('botkit');
const https = require('https');
const fs = require('fs');
const q = require ('q');
const tmp = require ('tmp');
const url = require ('url');
const util = require('util');
const nconf = require('nconf');

const version = '1.0 Beta';

nconf.argv().env();
nconf.file({ file: 'config.json' });

nconf.defaults({
    'alfresco': {
    	'host': 'localhost',
        'port': 8080,
        'user': 'admin',
        'pass': 'admin',
        'site': 'slackstuff',
		"logoUrl": "https://www.alfresco.com/sites/www.alfresco.com/files/alfresco-logo.png",
        "search": {
            "max": "10"
        }
    },
    'slack': {
    	'token': 'token_goes_here'
    }
});

// internal stuff
var alfrescoCmisUrl = 'http://' + nconf.get('alfresco:host') + ':' + nconf.get('alfresco:port') + '/alfresco/cmisbrowser';
var alfrescoGetContentUrl = 'http://' + nconf.get('alfresco:host') + ':' + nconf.get('alfresco:port') + '/alfresco/api/-default-/public/cmis/versions/1.1/browser/root?objectId='

// create our slack bot controller, with debug enabled for now
var controller = botkit.slackbot({
	debug: true
});

// upload and link function, takes the stuff from the message,
// puts the file in Alfresco and posts a link to the chat.
var uploadAndLink = function (bot, message, callback) {

	console.log('I got a message:' + message);
	//console.log(util.inspect(message, false, null));
	
	var fileMessage = {
		slackFileUrl: message.file.url_private,
		properties: {
			name: message.file.name,
			description: "description"
		},
		uploadedBy: message.user,
		channel: message.channel,
		folderPath: [message.channel,message.user],
		bot: bot,
		linkPostCallback: function(uploadLink) {
			postLink(bot, message, [{description:'Uploaded file saved to Alfresco',name:message.file.name,link:uploadLink}]);
		}
	}

	//console.log(util.inspect(fileMessage, false, null));
	createTempFile(fileMessage, uploadToAlfresco);

}

var postLink = function(bot, message, attachmentObjects) {
	if(attachmentObjects){
		var attachments = formatAttachments(attachmentObjects);
		bot.reply(message, attachments);
	}else{
		bot.reply(message, 'An error occurred saving your file to Alfresco')
	}
}

var formatAttachments = function(attachmentObjects){
	var attachments = {attachments:[]};
	for (var i = 0, len = attachmentObjects.length; i < len; i++) {
		attachments.attachments[i] = {
			fallback: 'Alfresco document link',
			color: 'good',
			pretext: attachmentObjects[i].description,
			title: attachmentObjects[i].name,
			title_link: attachmentObjects[i].link,
			thumb_url: nconf.get("alfresco:logoUrl") 
		}
	}
	return attachments;
}

var createTempFile = function (fileMessage, callback) {
		
	tmp.file(function _tempFileCreated(err, path, fd, cleanupCallback) {
		if(err){
			// handle this?
		}else {
			fileMessage.path = path;
			getFile(fileMessage, callback);
		}
	});
	
}

var getCmisSession = function(){
	var session = cmis.createSession(alfrescoCmisUrl);
	return session;
}

var uploadToAlfresco = function(fileMessage) {
	console.log('uploading file at path ' + fileMessage.path + ' to Alfresco');

	session = getCmisSession();
	var cmisReq = session
		.setCredentials(nconf.get('alfresco:user'), nconf.get('alfresco:pass'))
		.loadRepositories();
	cmisReq
		.ok(function() {
			console.log('Connected to Alfresco repository');
			getSiteDoclib(session, function(dlId) {
				getChannelName(fileMessage.bot, fileMessage.channel, function(channelName) {
					getUserName(fileMessage.bot, fileMessage.uploadedBy, function(userName) {
						createPathIfNotExists(dlId, [channelName,userName], session, function(userFolderId){
							createDocument(userFolderId, session, fileMessage);
						});
					});
				});
			});
		})
		.notOk(function(err) {
			console.log('failed to connect to Alfresco and list repositories: ' + err);
			//console.log(util.inspect(err, false, null));
		})
		.error(function(err) {
			console.log('error parsing response');
			//console.log(util.inspect(err, false, null));
		});
}

var getSiteDoclib = function(session, callback){
	session.getObjectByPath('/Sites/' + nconf.get('alfresco:site') + '/documentLibrary')
		.ok(function(cmisdata) {
			console.log('Found site folder id: ' + dlId);
			var dlId = cmisdata.succinctProperties['cmis:objectId'];
			callback(dlId);
		})
		.notOk(function(err) {
			console.log('failed to connect to Alfresco and list repositories: ' + err);
			//console.log(util.inspect(err, false, null));
		});
}

var createDocument = function(folderId, session, fileMessage){
	console.log('uploading file to Alfresco as ' + fileMessage.properties.name);

	// is this a file?  If not, just use the provided data
	if(fileMessage.path){
		fs.readFile(fileMessage.path, function(err, fileContent) {
			createDocumentCmis(folderId, fileContent, fileMessage.properties, fileMessage.linkPostCallback);
		});
	}else if(fileMessage.data){
		createDocumentCmis(folderId, fileMessage.data, fileMessage.properties, fileMessage.linkPostCallback);
	}
}

var createDocumentCmis = function(folderId, data, properties, callback){
	session.createDocument(folderId, data, properties)
		// TODO:  set Slack description as Alfresco CMIS description
		.ok(function(docdata) {
			//console.log(util.inspect(docdata, false, null));
			// now post the link via the callback
			callback(alfrescoGetContentUrl + docdata.succinctProperties['cmis:objectId']);
		})
		.notOk(function(err) {
			console.log('failed to create and upload content: ' + err);
			//console.log(util.inspect(err, false, null));
			//callback(err);
		});
}

var buildCmisProperties = function(name, description){
	var properties = {
		'cmis:name': name,
		'cmis:description': description
	}
}

var createPathIfNotExists = function(parentId, nameList, session, callback){
	console.log('creating folder ' + nameList[0] + ' if it does not already exist');
	var folderId;
	session.getChildren(parentId)
		.ok(function(data) {
			console.log(data);
			for (var i = 0, len = data.objects.length; i < len; i++) {
  				//console.log(util.inspect(data.objects[i], false, null));
				if(data.objects[i].object.succinctProperties['cmis:objectTypeId'] == 'cmis:folder'){
					if(data.objects[i].object.succinctProperties['cmis:name'] == nameList[0]){
						folderId = data.objects[i].object.succinctProperties['cmis:objectId'];
						break;
					}
				}
			}
			if(!folderId){
				session.createFolder(parentId, nameList[0])
					.ok(function(data){
						folderId = data.succinctProperties['cmis:objectId'];
						nameList = nameList.slice(1, nameList.length);
						if(nameList.length > 0) {
							createPathIfNotExists(folderId, nameList, session, callback);
						}else{
							callback(folderId);
						}
					})
					.notOk(function(err){

					});
			}else{
				nameList = nameList.slice(1, nameList.length);
				if(nameList.length > 0) {
					createPathIfNotExists(folderId, nameList, session, callback);
				}else{
					callback(folderId);
				}
			}

		})
		.notOk(function(data) {
			console.log(util.inspect(data.objects[i], false, null));
		});
}

var getChannelName = function(bot, channelId, callback){
	bot.api.channels.info({token:nconf.get('slack:token'),channel:channelId},function(err,response) {
		//console.log("got channel response: " + util.inspect(response, false, null));
		var channelName = response.channel.name;
		callback(channelName);
	});
}

var getUserName = function(bot, userId, callback){
	bot.api.users.info({token:nconf.get('slack:token'),user:userId},function(err,response) {
		//console.log("got user response: " + util.inspect(response, false, null));
		var userName = response.user.name;
		callback(userName);
	});
}

var getFile = function(fileMessage, uploadToAlfrescoCallback) {

	console.log('temp file path=' + fileMessage.path);
	
	var urlObj = url.parse(fileMessage.slackFileUrl);
	
	var options = {
		host: urlObj.hostname,
		port: urlObj.port,
		method: 'GET',
		path: urlObj.path,
		headers:{
			'Authorization': 'Bearer ' + nconf.get('slack:token'),
			'Host': urlObj.hostname
		}
	}
	
	var request = https.get(options, function(response) {
		var headers = JSON.stringify(response.headers);
		console.log("status code=" + response.statusCode);
		switch(response.statusCode) {
			case 200:
				var file = fs.createWriteStream(fileMessage.path);
				
				/*file.on("end", function() {
					console.log("file write ended");
					file.end();
					file.close();
				});*/
				
				response.on('data', function(chunk){
					file.write(chunk);
				}).on('end', function() {
					file.end();
					uploadToAlfrescoCallback(fileMessage);
				});
				
				break;
			case 302:
				fileMessage.slackFileUrl = response.headers.location;
				getFile(fileMessage, uploadToAlfrescoCallback);
				break;
			case 307:
				fileMessage.slackFileUrl = response.headers.location;
				getFile(fileMessage, uploadToAlfrescoCallback);
				break;
			default:
				console.log("error: " + response.statusCode);
		}
	});
	
}

var archiveChatToAlfresco = function(bot, message, archiveRequest){

	var fileMessage = {
		properties: {
			name: archiveRequest.archiveName,
			description: "description"
		},
		folderpath: ['archives',generateDayFolder()],
		bot: bot,
		linkPostCallback: function(archiveLink) {
			postLink(bot, message, [{description:'Chat archive',name:archiveRequest.archiveName,link:archiveLink}]);
		}
	}
	
	session = getCmisSession();
	var cmisReq = session
		.setCredentials(nconf.get('alfresco:user'), nconf.get('alfresco:pass'))
		.loadRepositories();
	cmisReq
		.ok(function(data){
			bot.api.channels.history(archiveRequest,function(err,response) {
				console.log("got messages response: " + util.inspect(response, false, null));
				fileMessage.data = util.inspect(response.messages, false, null);
				if(response.messages.length > 0) {
					getSiteDoclib(session, function(dlId) {
						createPathIfNotExists(dlId, ['archives',generateDayFolder()], session, function(archiveFolderId){
							createDocument(archiveFolderId, session, fileMessage);
						});
					});
				}else {
					bot.reply(message, 'No messages met your search criteria.  Are you sure you asked me for something I can find?');
				}
				
			});
		})
		.notOk(function(err){

		});
}

var generateDayFolder = function(){
	var dateObj = new Date();
	return dateObj.getDate() + '-' + dateObj.getMonth() + '-' + dateObj.getFullYear();
}

var generateArchiveFileName = function(){
	var dateObj = new Date();
	var datePart = dateObj.getDate() + '-' + dateObj.getMonth() + '-' + dateObj.getFullYear();
	var timePart = dateObj.valueOf();
	return datePart + '-' + timePart + '-archive.txt';
}

var parseArchiveParameters = function(archiveRequest, responseText){

	//get the number
	var numberOfUnits = responseText.replace(/[^0-9]/g,'');
	var startTime = new Date();

	console.log("NUMBER OF UNITS: " + numberOfUnits);
	// get the units and calculate
	if(responseText.includes('hour')){
		startTime.setHours(startTime.getHours() - numberOfUnits);
		archiveRequest.oldest = startTime.valueOf();
	}else if(responseText.includes('minute')){
		startTime.setMinutes(startTime.getMinutes() - numberOfUnits);
		archiveRequest.oldest = startTime.valueOf();
	}else if(responseText.includes('day')) {
		startTime.setDate(startTime.getDate() - numberOfUnits);
		archiveRequest.oldest = startTime.valueOf();
	}else if(responseText.includes('message')) {
		// add 7 to account for the archive conversation itself.
		archiveRequest.count = numberOfUnits + 7;
	}else{
		// don't know what to archive here, so let's make sure nothing comes back
		archiveRequest.oldest = 0;
		archiveRequest.latest = 0;
	}
	
	//archiveRequest.oldest = 100000;

	// sort out the amount of stuff to archive
	return archiveRequest;
}

var searchAlfresco = function(bot, message, searchTerm){
	
	var session = getCmisSession();
	var docQuery = 'SELECT * FROM cmis:document where contains (\'' + searchTerm + '\') OR cmis:name LIKE \'%' + searchTerm + '%\'';
	var options = {
		maxItems: 10
	}

	var cmisReq = session
		.setCredentials(nconf.get('alfresco:user'), nconf.get('alfresco:pass'))
		.loadRepositories();
	cmisReq
		.ok(function(data){
			session.query(docQuery, false, options)
				.ok(function(searchData){
					// process the search results into attachmentObjects
					var attachmentObjects = [];
					for (var i = 0, len = searchData.results.length; i < len; i++) {
						attachmentObjects[i] = {
							description: 'Search result ' + (i+1) + ' of ' + len,
							name: searchData.results[i].succinctProperties['cmis:name'],
							link: alfrescoGetContentUrl + searchData.results[i].succinctProperties['cmis:objectId']
						}
					}
					if(searchData.results.length > 0) {
						postLink(bot, message, attachmentObjects);
					}else {
						bot.reply(message, 'No search results found');
					}
					console.log("search resutls: " + util.inspect(searchData, false, null));
				})
				.notOk(function(err){
					console.log("search resutls: " + err);
				})
				.error(function(err){
					console.log("search resutls: " + err);
				});
		});
}

// connect the slackbot to the message stream
controller.spawn({
	token: nconf.get('slack:token')
}).startRTM();

// let people know I'm here 
controller.hears('hello',['direct_mention'], function (bot,message) {
	//console.log(util.inspect(message, false, null));
	bot.reply(message, 'Alfresco FileBot here, my version is ' + version);
});

// get my config for those that are interested
controller.hears('config',['direct_mention'], function (bot,message) {
	bot.reply(message, 'Alfresco Filebot config: ');
});

controller.hears('list',['direct_mention'], function (bot,message) {
	bot.reply(message, 'yeah, that would be a cool feature, but I have not implemented it yet!');
	//bot.reply(message, 'Let me list that user\'s files for you!');
	// TODO: implement file listings for users
});

controller.hears('help',['direct_mention'], function (bot,message) {
	bot.reply(message, 'OK, you need some help!  I am a chatbot for Slack that integrates with Alfresco');
	bot.reply(message, 'I do the following things:');
	bot.reply(message, '1.  I take files you upload to this channel and save them to Alfresco');
	bot.reply(message, '2.  I can show you my configuration: @<my name> config');
	bot.reply(message, '3.  I can show you my version: @<my name> hello');
	bot.reply(message, '4.  I can search for files: @<my name> search');
	bot.reply(message, '5.  I can archive part of this chat to Alfresco: @<my name> archive');
});

controller.hears('search',['direct_mention'], function (bot,message) {

	var searchTerm;

	bot.startConversation(message, function(err, convo) {
		if (!err) {
			convo.ask('OK, we can do a search.  What keyword(s) would you like to search for?', function(response, convo) {
				searchTerm = response.text;
				convo.ask('You want me to search for `' + response.text + '` in Alfresco?', [
					{
						pattern: 'yes',
						callback: function(response, convo) {
							// since no further messages are queued after this,
							// the conversation will end naturally with status == 'completed'
							convo.next();
						}
					},
					{
						pattern: 'no',
						callback: function(response, convo) {
							// stop the conversation. this will cause it to end with status == 'stopped'
							convo.stop();
						}
					},
					{
						default: true,
						callback: function(response, convo) {
							convo.repeat();
							convo.next();
						}
					}
				]);
				convo.next();
			});

			convo.on('end', function(convo) {
				if (convo.status == 'completed') {
					bot.reply(message, 'OK! Here are the top results: (max ' + nconf.get('alfresco:search:max') + ')');
					searchAlfresco(bot, message, searchTerm);
				} else {
					// this happens if the conversation ended prematurely for some reason
					bot.reply(message, 'OK, nevermind!');
				}
			});
		}
	});
});

controller.hears('archive',['direct_mention'], function (bot,message) {

	// generate an archive name
	var defaultName = generateArchiveFileName();

	// sensible defaults?
	var archiveRequest = {
		token: nconf.get('slack:token'),
		channel: message.channel,
		oldest: 0,
		inclusive: 1,
		count: 1000,
		unreads: 1,
		archiveName: 'archive.txt'
	}

	bot.startConversation(message, function(err, convo) {
		if (!err) {
			convo.ask('OK, I can do that.  How much would you like to archive (x minutes, hours, days, messages)?', function(lengthResponse, convo) {
				archiveRequest = parseArchiveParameters(archiveRequest, lengthResponse.text);
				convo.ask('What should I call the archive (default: `' + defaultName +'`)?', function(nameResponse, convo){

					if(nameResponse && nameResponse.text != 'default') archiveRequest.archiveName = nameResponse.text;
					else archiveRequest.archiveName = defaultName;

					if(!archiveRequest.archiveName.endsWith('.txt')) archiveRequest.archiveName += '.txt';

					convo.ask('You want me to archive ' + lengthResponse.text + ' of this chat, and name it `' + archiveRequest.archiveName +'`?', [
						{
							pattern: 'yes',
							callback: function(response, convo) {
								// since no further messages are queued after this,
								// the conversation will end naturally with status == 'completed'
								convo.next();
							}
						},
						{
							pattern: 'no',
							callback: function(response, convo) {
								// stop the conversation. this will cause it to end with status == 'stopped'
								convo.stop();
							}
						},
						{
							default: true,
							callback: function(response, convo) {
								convo.repeat();
								convo.next();
							}
						}
					]);
					convo.next();
				});
				convo.next();
			});

			convo.on('end', function(convo) {
				if (convo.status == 'completed') {
					bot.reply(message, 'OK! I will create that archive for you');
					//console.log(util.inspect(archiveRequest, false, null));
					archiveChatToAlfresco(bot, message, archiveRequest);
				} else {
					// this happens if the conversation ended prematurely for some reason
					bot.reply(message, 'OK, nevermind!');
				}
			});
		}
	});
});

// listen for file uploads
controller.on('file_share', uploadAndLink);

// let people know I'm online!
controller.on('presence_change', function(bot,message) {
	//bot.reply(message, 'Alfresco FileBot is online!');
});

