slackbot-alfresco
====================

Slack is awesome, Alfresco is awesome, and the combination of the two is extremely awesome.
This project implements a simple chatbot for Slack that connects to your Alfresco instance and provides some
handy functionality:

* Automatically copy files uploaded into a Slack chat to an Alfresco site.
* Archives parts of Slack chats to an Alfresco site.
* Allows simple searching of Alfresco from within Slack, with links directly to results.

Setup
--------------------

Setting up this project is pretty simple, but you'll need a few things first:

* A running Alfresco instance for which you know the host, port, user and password
* A Slack account
* A recent version of node and a few modules

First, let's get your bot set up in Slack.  Click here, and set up a new bot:

https://my.slack.com/services/new/bot

When you set up your new bot, it will provide you with a token to use.  Copy this down somewhere, you'll
need in in a minute.

Now you'll need to get your Alfresco connection set up.  Log in and create a site for Slack to use.  Make
a note of the shortname (url name) of this site.

Next, pull down a copy of this project, and rename config-example.json to config.json.  Edit that file and paste your 
Slack token into the slack.token value.  While you are at it, go ahead and set up the Alfresco values in this file,
providing the hostname, port, username and password for your instance, along with the site name to use.

Running
--------------------

Once you have all that done, you're ready to roll!  To start this thing up you'll need a recent version of node, 
and the following modules installed:

cmis, botkit, https, fs, tmp, url, util, nconf

Now just run node:

node slackbot-alfresco.js

If all goes well, you should see the bot start up and connect to Slack.  Add the bot you created earlier to a
channel and test it out:

__@yourbotname hello__

And the bot should echo back its version.  Did it work?  Great!

Try uploading a file to Slack.  You should see the bot pick up that file, push it to Alfresco and post a link to
your chat.  The file will be put into Alfresco in your site's document library.  By default, this bot creates folders
for the channel, and under that a folder for the user that uploaded the file.

But that's not all!  Try archiving a portion of your chat!

__@yourbotname archive__

This will initiate a conversation with the bot where it asks you how much of the chat you want to archive.  Right now only 
message count is working, I'm having trouble with date ranges in the Slack API.  Try asking the bot to archive 10 messages.
Those messages will be archived to the site you have configured, in a folder named for the date.

Let's try a search.

__@yourbotname search__

This again initiates a conversation with the bot.  This time, the bot will ask you what you want to search for.  Give
it a term and it should return up to 10 matching results.

I'd love to hear suggestions on what other features people want!