import axios from "axios";
import Parser from "rss-parser";
import ptn from "parse-torrent-name";
import _ from "lodash";

class NyaaProvider {
    baseURL = 'https://nyaa.si/';
    parser = null;
    regex = null;
    episodeRegex = null;

    constructor() {
        this.parser = new Parser({
            customFields: {
                item: [['nyaa:seeders', 'seeders'], ['nyaa:leechers', 'leechers'], ['nyaa:downloads', 'downloads'], ['nyaa:size', 'size']]
            }
        });

        this.regex = /(\[(.+?)])(.+)(\[(.+?)])/;
        this.episodeRegex = /(\d+)(v\d+)?[-~]?(\d+)?/g;
    }

    async getResults(query, params = {f: 0, c: '1_2'}) {
        const result = await axios.get(this.baseURL, {
            params: {
                page: 'rss',
                q: query,
                ...params
            }
        });

        const parsed = await this.parser.parseString(result.data);
        if (!('items' in parsed) || !parsed.items.length) {
            return [];
        }

        let items = [];

        for (let i of parsed.items.reverse()) {
            let [group, resolution, episodeMain, episodeSecondary, showname] = this.parseTitle(i.title);

            items.push({
                ...i,
                ...{
                    group,
                    resolution,
                    episodeMain,
                    episodeSecondary,
                    showName: showname
                }
            });
        }

        return items;
    }

    parseTitle(title) {
        let okay = false,
            group,
            resolution,
            episodeMain,
            episodeSecondary,
            showname;

        const functions = [this.parseGeneric.bind(this), this.parseFromPtn.bind(this)];
        for (let i = 0; i < functions.length; i++) {
            [okay, group, resolution, episodeMain, episodeSecondary, showname] = functions[i](title);
            if (okay) {
                break;
            }
        }

        return [
            group,
            resolution,
            episodeMain,
            episodeSecondary,
            showname
        ];
    }

    parseGeneric(title) {
        const found = this.regex.exec(title);
        let f, left, group, showname, right, resolution;
        let episodeMain, episodeSecondary;

        if (found === null) {
            return [
                false,
                null,
                null,
                null,
                null,
                null
            ];
        }

        [f, left, group, showname, right, resolution] = found;

        [episodeMain, episodeSecondary] = this.getEpisodeMatch(showname);

        return [
            true,
            group,
            resolution,
            episodeMain,
            episodeSecondary,
            showname
        ];
    }

    parseFromPtn(title) {
        let results = ptn(title);
        const group = _.isUndefined(results.website) ? (_.isUndefined(results.group) ? 'Unknown' : results.group) : results.website;
        const resolution = _.isUndefined(results.resolution) ? 'Unknown' : results.resolution;
        let [episodeMain, episodeSecondary] = this.getEpisodeMatch(results.title);
        if (_.isUndefined(episodeMain)) {
            [episodeMain, episodeSecondary] = this.getEpisodeMatch(title);
        }
        let showname = _.isUndefined(results.title) ? title : results.title;

        return [
            true,
            group,
            resolution,
            episodeMain,
            episodeSecondary,
            showname
        ];
    }

    getEpisodeMatch(part) {
        let firstNonNameCharacter = [part.indexOf('(', 1), part.indexOf('[', 1)];
        while (true) {
            let index = firstNonNameCharacter.indexOf(-1);
            if (index === -1) {
                break;
            }

            firstNonNameCharacter.splice(index, 1);
        }

        if (firstNonNameCharacter.length) {
            let index = _.min(firstNonNameCharacter);
            if (!_.isUndefined(index)) {
                part = part.substring(0, index).trim();
            }
        }

        let lastFoundMatch = null;
        let episodeMain, episodeSecondary, version, f;
        let match = null;
        while ((match = this.episodeRegex.exec(part)) !== null) {
            lastFoundMatch = match;
        }

        if (lastFoundMatch !== null) {
            [f, episodeMain, version, episodeSecondary] = lastFoundMatch;
            episodeMain = parseInt(episodeMain);
            if (!_.isUndefined(episodeSecondary)) {
                episodeSecondary = parseInt(episodeSecondary);
            }
        }

        return [
            episodeMain,
            episodeSecondary
        ];
    }
}

export default NyaaProvider;