import axios from "axios";
import Parser from "rss-parser";
import logger from "./Logger.js";

class JpopSukiProvider {
    baseURL = 'https://jpopsuki.eu/feeds.php';
    parser = null;
    regex = null;

    constructor() {
        this.parser = new Parser();

        this.regex = /(.+?) - (.+?) \[] - (.+?) \/ (.+?)? \/ (.+)/;
    }

    async getResults(params = {feed: 'torrents_notify_20316_ollohfzw7ayqvwmbqk5d8t2ykj0ze73f'}) {
        const result = await axios.get(this.baseURL, {
            params: {
                user: '155887',
                auth: 'ce93623920c6c3ecbffc03cd6e2b8b33',
                passkey: 'ollohfzw7ayqvwmbqk5d8t2ykj0ze73f',
                authkey: '0f3e681a6ffc4d77e48e3a68e5212aff',
                name: 'all',
                ...params
            }
        });

        const parsed = await this.parser.parseString(result.data);
        if (!('items' in parsed) || !parsed.items.length) {
            return [];
        }

        let items = [];

        for (let i of parsed.items.reverse()) {
            let [f, artist, name, codec, compression, rip] = this.regex.exec(i.title);
            items.push({
                ...i,
                ...{
                    artist,
                    name,
                    codec,
                    compression,
                    rip
                }
            });
        }

        return items;
    }
}

export default JpopSukiProvider;