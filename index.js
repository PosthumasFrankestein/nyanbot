import DiscordBot from "./Bot";
import logger from "./Logger";

const PRODUCTION_TOKEN = '';
const DEV_TOKEN = '';

const mode = process.env.NODE_ENV;

new DiscordBot(mode === 'development' ? DEV_TOKEN : PRODUCTION_TOKEN);
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection ' + reason.toString());
    console.log(reason);
});
