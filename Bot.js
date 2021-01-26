import {Client} from 'discord.js';
import NyaaProvider from "./NyaaProvider";
import logger from "./Logger";
import BotGuildInstance from "./BotGuildInstance";
import JpopSukiProvider from "./JpopSukiProvider";

export const COMMAND_CHARACTER = '+';
export const VERSION = '1.0.1';

class Bot {
    bot = null;
    token=null;
    // token = 'Nzg4OTYwNTEzNzk4NTcwMDI2.X9rGvA.5zDGeLfdLuCyb8tJHX5f6F9RQD4';
    nyaa = null;
    jpop = null;
    subBots = {};

    constructor(token) {
        this.token = "NzIwNDY4MjA0MjQ1NDgzNTYz.XuGaTQ.2HvXFX7O7-SQOV3tKtrOO6rWCWI";
        this.bot = new Client();
        this.nyaa = new NyaaProvider();
        this.jpop = new JpopSukiProvider();
        this.init();
    }

    async init() {
        this.bot.on('ready', this.onReady.bind(this));
        this.bot.login(this.token);
    }

    async onReady() {
        logger.info(`Bot is now ready, working as ${this.bot.user.tag}`);

        for (let guild of this.bot.guilds.cache) {
            logger.info("Preparing cache for " + guild[0].toString());
            this.subBots[guild[0]] = new BotGuildInstance(guild[0], this.bot, this.nyaa, this.jpop);
        }

        this.bot.user.setActivity('hardcore rawre porn', {type: 'WATCHING'});
        this.bot.on('message', this.onMessage.bind(this));
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
            if (!(command in this.subBots[guildID].commands)) {
                return;
            }

            if (!await this.subBots[guildID].allowedToCommand(msg)) {
                await msg.channel.send("rude bitch not allowed");
                return;
            }

            await this.subBots[guildID].commands[command](msg);
        }
    }
}

export default Bot;
