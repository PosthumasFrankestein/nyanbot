import low from 'lowdb';
import FileAsync from 'lowdb/adapters/FileAsync';
import logger from "./Logger.js";
import _ from "lodash";
import OGParser from "ogparser";
import {MessageEmbed} from "discord.js";
import {COMMAND_CHARACTER, VERSION} from "./Bot.js";

const getNewDatabase = (filename) => new Promise((res) => {
    low(new FileAsync(filename + ".json"))
        .then((d) => res(d));
});

const NYAA_UPDATES = 'nyaa_updates';
const NYAA_ALL = 'nyaa_all';
const JPOP_ALL = 'jpop_all';

const ALLOWED_CHANNEL_TYPES = [NYAA_UPDATES, NYAA_ALL, JPOP_ALL];
const MINIMAL_INTERVAL_TIMES = {
    [NYAA_UPDATES]: 30,
    [NYAA_ALL]: 30,
    [JPOP_ALL]: 30
};

class BotGuildInstance {
    guildID = null;
    db = null;
    nyaa = null;
    jpop = null;
    timeout = {};
    bot = null;
    responseChannels = {};

    constructor(guildID, bot, nyaaProvider, jpopSukiProvider) {
        this.guildID = guildID;
        this.bot = bot;
        this.nyaa = nyaaProvider;
        this.jpop = jpopSukiProvider;
        this.commands = {
            'id': this.channelID.bind(this),
            'allow': this.allowUser.bind(this),
            'new': this.addShow.bind(this),
            'channel': this.setChannel.bind(this),
            'refresh': this.refreshShows.bind(this),
            'refreshAll': this.searchAll.bind(this),
            'refreshJpop': this.searchJpop.bind(this),
            'timeout': this.setNewTimeout.bind(this),
            'list': this.listShows.bind(this),
            'remove': this.removeShow.bind(this),
            'help': this.showHelp.bind(this)
        };
        this.timeoutFunctions = {
            [NYAA_UPDATES]: this.refreshShows.bind(this),
            [NYAA_ALL]: this.searchAll.bind(this),
            [JPOP_ALL]: this.searchJpop.bind(this)
        };

        this.readyGuild();
    }

    async stopTimeout(timeoutType = null) {
        if (timeoutType === null) {
            timeoutType = ALLOWED_CHANNEL_TYPES;
        }

        if (!_.isArray(timeoutType)) {
            timeoutType = [timeoutType];
        }

        for (let i = 0; i < timeoutType.length; i++) {
            clearInterval(this.timeout[timeoutType]);
        }
    }

    async internalStartTimeout(timeoutType) {
        let timeoutVal = await this.db.get(`timeout.${timeoutType}`).value();
        if (_.isUndefined(timeoutVal)) {
            timeoutVal = MINIMAL_INTERVAL_TIMES[timeoutType];
        }
        timeoutVal = parseInt(timeoutVal);
        logger.info(`Starting interval for ${this.guildID} in ${timeoutVal} minutes for ${timeoutType}`);
        timeoutVal *= 60;
        timeoutVal *= 1000;
        this.timeout[timeoutType] = setInterval(() => {
            logger.info(`Updating list ${this.guildID}`);
            this.timeoutFunctions[timeoutType]();
        }, timeoutVal);
    }

    async startTimeout(timeoutType = null) {
        this.stopTimeout(timeoutType);
        if (timeoutType === null) {
            timeoutType = ALLOWED_CHANNEL_TYPES;
        }

        if (!_.isArray(timeoutType)) {
            timeoutType = [timeoutType];
        }

        for (let i = 0; i < timeoutType.length; i++) {
            await this.internalStartTimeout(timeoutType[i]);
        }
    }

    async readyGuild() {
        this.db = await getNewDatabase('db_' + this.guildID.toString());
        await this.db.defaults({
            server: [],
            og: [],
            search: [],
            rss: [],
            channels: [],
            timeouts: {},
            lastAllRss: null,
            lastJpopRss: null
        }).write();

        await this.startTimeout();
    }

    async getOG(url) {
        const og = await this.db.get('og').find({url: url}).value();
        if (!_.isUndefined(og)) {
            return og.data;
        }

        const response = await OGParser.parse(url);
        await this.db.get('og').push({url: url, data: response}).write();
        return response;
    }

    async searchJpop(msg = null) {
        const channel = await this.getChannel(msg, JPOP_ALL);
        if (channel === null) {
            logger.warn(`No valid channel target was found for server ${this.guildID} for type ${JPOP_ALL}`);
            return;
        }

        logger.info(`Updating any jpop results for ${this.guildID}`);
        let results = await this.jpop.getResults();
        if (!results.length) {
            return;
        }
        this.startTimeout(JPOP_ALL);

        let lastRssGuid = await this.db.get('lastJpopRss').value();
        if (!_.isUndefined(lastRssGuid) && lastRssGuid !== null) {
            results = results.reverse();
            for (let i = 0; i < results.length; i++) {
                if (results[i].guid === lastRssGuid) {
                    // all before this
                    results = results.slice(0, i);
                    break;
                }
            }
            results = results.reverse();
        }

        if (!results.length) {
            return;
        }

        logger.info(`Results found for any jpop ${results.length}`);
        const embedFunction = this.getJpopEmbed.bind(this);

        for (let item of results) {
            await this.postShow(embedFunction, item, channel);
        }

        await this.db.set('lastJpopRss', results[results.length-1].guid).write();
    }

    async searchAll(msg = null) {
        const channel = await this.getChannel(msg, NYAA_ALL);
        if (channel === null) {
            logger.warn(`No valid channel target was found for server ${this.guildID} for type ${NYAA_ALL}`);
            return;
        }

        logger.info(`Updating any nyaa results for ${this.guildID}`);
        let results = await this.nyaa.getResults("", {});
        if (!results.length) {
            return;
        }
        this.startTimeout(NYAA_ALL);

        let lastRssGuid = await this.db.get('lastAllRss').value();
        if (!_.isUndefined(lastRssGuid) && lastRssGuid !== null) {
            results = results.reverse();
            for (let i = 0; i < results.length; i++) {
                if (results[i].guid === lastRssGuid) {
                    // all before this
                    results = results.slice(0, i);
                    break;
                }
            }
            results = results.reverse();
        }

        if (!results.length) {
            return;
        }

        logger.info(`Results found for any nyaa ${results.length}`);
        const embedFunction = this.getMinorEmbed.bind(this);

        for (let item of results) {
            await this.postShow(embedFunction, item, channel);
        }

        await this.db.set('lastAllRss', results[results.length-1].guid).write();
    }

    async searchShow(id, query, channel = null, OG = null) {
        const results = await this.nyaa.getResults(query);
        if (!results.length) {
            return;
        }

        logger.info(`Results found for ${query}: ${results.length}`);
        const embedFunction = this.getRichEmbed.bind(this);

        for (let i of results) {
            const item = await this.db.get('rss').find({guid: i.guid}).value();
            if (!_.isUndefined(item)) {
                continue;
            }

            if (await this.postShow(embedFunction, i, channel, OG)) {
                await this.db.get('rss').push({...i, searchID: id}).write();
            }
        }
    }

    async refreshShows(msg = null) {
        const channel = await this.getChannel(msg);
        if (channel === null) {
            logger.warn(`No valid channel target was found for server ${this.guildID} for type ${NYAA_UPDATES}`);
            return;
        }

        this.startTimeout(NYAA_UPDATES);
        logger.info(`Updating shows for ${this.guildID}`);

        for (let i of await this.db.get('search').value()) {
            await this.searchShow(i.id, i.search, channel, await this.getOG(i.url));
        }
    }

    async getChannel(msg = null, channelType = NYAA_UPDATES) {
        const channel = await this.getGuildChannel(channelType);
        if (channel === null) {
            if (msg !== null) {
                await msg.channel.send("No channel was found");
            }
            return null;
        }
        else {
            return channel;
        }
    }

    async showHelp(msg) {
        const embed = new MessageEmbed();
        embed.setTitle(`Help for gayboi v${VERSION}`)
            .setDescription(`${COMMAND_CHARACTER}id - show id of the channel\n\n` +
                `${COMMAND_CHARACTER}allow - mention a user to allow it to use the bot\n\n` +
                `${COMMAND_CHARACTER}new - add a new show to be searched for - syntax:\n` +
                `${COMMAND_CHARACTER}new "ShowSearchString" "MAL_URL"\n\n` +
                `${COMMAND_CHARACTER}channel "channel_type" channelID - set a new channel to post to\n` +
                `Allowed channel types are: ${NYAA_UPDATES}, ${NYAA_ALL}, ${JPOP_ALL}\n\n` +
                `${COMMAND_CHARACTER}refresh - force a refresh now (restarts timer) - ${NYAA_UPDATES}\n\n` +
                `${COMMAND_CHARACTER}refreshAll - force a refresh now (restarts timer) - ${NYAA_ALL}\n\n` +
                `${COMMAND_CHARACTER}refreshJpop - force a refresh now (restarts timer) - ${JPOP_ALL}\n\n` +
                `${COMMAND_CHARACTER}timeout - set a new timeout (in minutes) for checks\n\n` +
                `${COMMAND_CHARACTER}list - list current search shows\n\n` +
                `${COMMAND_CHARACTER}remove - remove show (specify show id)\n\n` +
                `${COMMAND_CHARACTER}help - show this message`);

        await msg.channel.send(embed);
    }

    async getGuildChannel(channelType = NYAA_UPDATES) {
        let channel = this.responseChannels[channelType];
        if (_.isUndefined(channel)) {
            channel = await this.db.get('channels').find({type: channelType}).value();

            if (_.isUndefined(channel)) {
                return null;
            }

            channel = channel.id;
        }

        return await await this.bot.channels.fetch(channel);
    }

    async postShow(embedFunc, item, channel = null, og = null, channelType = NYAA_UPDATES) {
        if (channel === null) {
            channel = await this.getGuildChannel(channelType);

            if (!channel) {
                return false;
            }
        }

        return new Promise(async (resolve) => {
            const title = (og !== null ? og.title ?? item.title : item.title);
            const embed = await embedFunc(item, title);

            if (og !== null) {
                const img = og.image ?? null;
                if (img) {
                    embed.setThumbnail(img);
                }

                const url = og.url ?? null;
                if (url) {
                    embed.setURL(url);
                }
            }

            let retryCounter = 0;

            logger.info(`Posting new result for ${title} with guid ${item.guid} for server ${this.guildID}`);
            while (true) {
                try {
                    await channel.send(embed);
                    setTimeout(() => {
                        resolve(true);
                    }, 2000);
                    break;
                }
                catch (e) {
                    logger.warn(`An error has occured while posting: ${e.toString()}, retrying (${++retryCounter} in 5 seconds`);
                    await new Promise((res) => {
                        setTimeout(() => {
                            res();
                        }, 5000);
                    });
                    if (retryCounter > 10) {
                        resolve(false);
                    }
                }
            }
        });
    }

    async getJpopEmbed(item, possibleTitle = null) {
        const embed = new MessageEmbed();
        embed.setTitle(item.name)
            .setColor(14978504)
            .addField("Artist:", item.artist)
            .addField("Codec:", item.codec, true)
            .addField("Compression:", (!_.isUndefined(item.compression) ? item.compression : 'Unknown'), true)
            .addField("Link:", item.link)
            .setFooter("Original title: " + item.title);

        return embed;
    }

    async getMinorEmbed(item, possibleTitle = null) {
        const embed = new MessageEmbed();
        embed.setTitle(possibleTitle ?? item.title)
            .setColor(9299132)
            .addField("Statistics:", "S: " + item.seeders.toString() + ", L: " + item.leechers.toString() + ", " + item.size)
            .addField("Link:", item.link);

        return embed;
    }

    async getRichEmbed(item, possibleTitle = null) {
        const embed = new MessageEmbed();
        embed.setTitle(possibleTitle ?? item.showname ?? item.title)
            .setColor(14533256)
            .addField('Group:', item.group ?? 'Unknown group')
            .addField((!_.isUndefined(item.episodeSecondary) ? 'Episodes:' : 'Episode:'),
                (!_.isUndefined(item.episodeSecondary) ? item.episodeMain.toString() + "-" + item.episodeSecondary.toString() : (!_.isUndefined(item.episodeMain) ? item.episodeMain.toString() : 'Unknown')))
            .addField("Statistics:", "S: " + item.seeders.toString() + ", L: " + item.leechers.toString() + ", " + item.size)
            .addField("Release:", (!_.isUndefined(item.resolution) ? item.resolution : 'Unknown'), true)
            .addField("Link:", item.link, true)
            .setFooter("Original title: " + item.title);

        return embed;
    }

    async addToAllowed(userID) {
        await this.db.get('server').push(userID).write();
    }

    async setChannel(msg) {
        const regex = /"(.+?)" (\d+)/g;
        const found = regex.exec(msg.content);

        if (found === null) {
            msg.channel.send(`Invalid channel syntax.\n${COMMAND_CHARACTER}channel "CHANNEL_TYPE" channelID where CHANNEL_TYPE is one of ${ALLOWED_CHANNEL_TYPES.join(', ')}`);
            return;
        }

        let [f, channelType, channel] = found;
        if (ALLOWED_CHANNEL_TYPES.indexOf(channelType) === -1) {
            msg.channel.send(`Invalid channel type, must be one of ${ALLOWED_CHANNEL_TYPES.join(', ')}`);
            return;
        }

        await this.setChannelIDForType(channel, channelType);
        this.responseChannels[channelType] = channel;
        logger.info(`New response channel was set for server ${this.guildID} - ${this.responseChannels[channelType]} for type ${channelType}`);
        msg.channel.send(`New channel set for type ${channelType}`);
    }

    async setChannelIDForType(channelID, channelType) {
        const existing = await this.db.get('channels').find({type: channelType}).value();
        if (!_.isUndefined(existing)) {
            await this.db.get('channels').find({type: channelType}).assign({id: channelID}).write();
        }
        else {
            await this.db.get('channels').push({type: channelType, id: channelID}).write();
        }
    }

    async allowedToCommand(msg) {
        const serverData = await this.db.get('server').value();
        if (_.isEmpty(serverData)) {
            await this.addToAllowed(msg.author.id);
            return true;
        }

        return serverData.indexOf(msg.author.id) !== -1;
    }

    async onMessage(msg) {
        if (this.bot.user.id === msg.author.id) {
            return;
        }

        const guildID = msg.channel.guild.id;

        const content = msg.content;
        if (content.startsWith(COMMAND_CHARACTER)) {
            const space = content.indexOf(' ');
            const command = content.substring(COMMAND_CHARACTER.length, space === -1 ? content.length : space);
            if (!(command in this.commands)) {
                return;
            }


            if (!await this.allowedToCommand(msg)) {
                await msg.channel.send("rude bitch not allowed");
                return;
            }

            await this.commands[command](msg);
        }
    }

    async channelID(msg) {
        await msg.channel.send(`Channel ID is ${msg.channel.id}`);
    }

    async addShow(msg) {
        const regex = /"(.+?)" "(.+?)"(?: "(.+?)")?/g;
        const found = regex.exec(msg.content);
        if (found === null) {
            await msg.channel.send(`Invalid new syntax:\n${COMMAND_CHARACTER} new \"show search phrase\" \"MALURL\" \"attribute regex\" (optional last)`);
            return;
        }

        let [f, search, url, reg] = found;
        let count = await this.db.get('search').last().value();
        if (_.isUndefined(count)) {
            count = 0;
        }
        else {
            count = count.id;
        }
        await this.db.get('search').push({id: count + 1, search, url, regex: reg}).write();
        logger.info(`New show has been added to the searchlist - ${search} - ${url} for server ${this.guildID}`);
        await msg.channel.send("Saved!");
    }

    async removeShow(msg) {
        const regex = /\d+/g;
        const found = regex.exec(msg.content);
        let valid = true;
        if (found === null) {
            valid = false;
            return;
        }

        let searchID = null;
        let item = null;

        if (valid) {
            [searchID] = found;
            searchID = parseInt(searchID);

            if (_.isUndefined(item = await this.db.get('search').find({id: searchID}))) {
                valid = false;
            }
        }

        if (!valid) {
            await msg.channel.send("Invalid id");
            return;
        }

        await this.db.get('search').remove({id: searchID}).write();
        await this.db.get('rss').find({searchID: searchID}).assign({searchID: null}).write();
        logger.info(`A show has been removed from the searchlist - ${item.search} from server ${this.guildID}`);
        await msg.channel.send("Query removed");
    }

    async allowUser(msg) {
        const mention = msg.mentions.users.first();
        if (_.isUndefined(mention)) {
            await msg.channel.send("No user mention was found");
            return;
        }

        await this.addToAllowed(mention.id);
        await msg.channel.send("User was added to botlist");
        logger.info(`A new user has been added to the botlist for server ${this.guildID} - ${mention.id}`);
    }

    async setNewTimeout(msg) {
        const regex = /"(.+?)" (\d+)/g;
        const found = regex.exec(msg.content);

        if (found === null) {
            await msg.channel.send(`Invalid timeout syntax.\n${COMMAND_CHARACTER}timeout "CHANNEL_TYPE" timeoutLength where CHANNEL_TYPE is one of ${ALLOWED_CHANNEL_TYPES.join(', ')}`);
            return;
        }

        let [f, channelType, timeout] = found;
        if (ALLOWED_CHANNEL_TYPES.indexOf(channelType) === -1) {
            msg.channel.send(`Invalid channel type, must be one of ${ALLOWED_CHANNEL_TYPES.join(', ')}`);
            return;
        }

        timeout = parseInt(timeout);
        if (timeout < MINIMAL_INTERVAL_TIMES[channelType]) {
            await msg.channel.send(`Timeout for ${channelType} must be at least ${MINIMAL_INTERVAL_TIMES[channelType]} minutes or higher`);
            return;
        }

        await this.db.set('timeout.'+channelType, timeout).write();
        await this.startTimeout(channelType);
        await msg.channel.send("New timeout set");
        logger.info(`A new timeout has been set for server ${this.guildID} - ${timeout} (${channelType})`);
    }

    async listShows(msg) {
        const shows = await this.db.get('search').value();
        if (!shows.length) {
            await msg.channel.send("No shows are currently in the search list");
            return;
        }

        const items = _.chunk(shows, 15);
        for (let i = 0; i < items.length; i++) {
            let message = "";
            for (let y = 0; y < items[i].length; y++) {
                message += "ID: " + items[i][y].id.toString() + " - " + items[i][y].search + "\n";
            }
            await msg.channel.send(message);
        }
    }
}

export default BotGuildInstance;