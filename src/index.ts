/**
 * @date 1 March 2019
 * @author Henry Harder
 * 
 * Very sloppy. Cleanup coming soon.
 * 
 * REQUIRED ENV VARS:
 * - PORT: a tcp port to bind the ws server to
 * - AVERAGE_OVER: a number of blocks to average the block-time interval over
 * - ORDERSTREAM_NODE_URL: the full url of a ParadigmCore JSONRPC server
 * - WEB3_URL: an Ethereum JSONRPC provider URL
**/

// load config 
require("dotenv").config();

// imports
import * as ws from "ws";
import * as uuid from "uuid/v4";
import * as _ from "lodash";
import * as Paradigm from "paradigm-connect";
import Web3 = require('web3');
import { Server } from "ws";

// local functions
import { addBlockTime, calculateAverageBlockTime, queryState } from "./functions";

// avoid compiler errors (grr @web3.js)
let newWeb3: any = Web3;

// destructure vars
const {
    ORDERSTREAM_NODE_URL, 
    PORT,
    AVERAGE_OVER,
    WEB3_URL
} = process.env;

// stores network data object
const data: INetworkData = {
    token: {},
    bandwidth: {},
    network: {},
    transactions: [],
    validators: []
}

// basic setup
// const paradigm = new Paradigm()
const clients: {
    [key: string]: {
        client: ws,
        id: string
    }
} = {};

const lastBlockTimes: Array<number> = [];
let lastTime: number = null;

// setup WS server
const server = new Server({
    port: parseInt(PORT)
});

// setup web3 connection
// setup paradigm connection
const web3 = new newWeb3(WEB3_URL);
const paradigm = new Paradigm();

// setup connection to orderstream
const osSubscription = new ws(ORDERSTREAM_NODE_URL);
const osQuery = new ws(ORDERSTREAM_NODE_URL);
const orderStreamId = uuid();

osSubscription.onmessage = async (msg) => {
    // skip if no clients 
    if (Object.keys(clients).length === 0) { return };

    // will store this block's diff
    let diff;

    // pull/parse some values
    const parsed = JSON.parse(msg.data.toString())
    const { height, time } = parsed.result
    const timeNum = parseInt(time);

    // skip if not a bock
    if (_.isNaN(timeNum)) return;

    // calculate average block time
    if (lastBlockTimes.length === 0 && !lastTime) {
        lastTime = timeNum; 
        addBlockTime(lastBlockTimes, 0, parseInt(AVERAGE_OVER));
    } else {
        diff = timeNum - lastTime;
        addBlockTime(lastBlockTimes, diff, parseInt(AVERAGE_OVER));
        lastTime = timeNum;

    }

    // will store validator info
    let validatorIds: string[];
    const validators: any[] = [];

    // find and update `network` values 
    data.network.block_height = height;
    data.network.last_block_time = time;
    data.network.avg_block_interval = calculateAverageBlockTime(lastBlockTimes);
    data.network.number_validators = await (async () => {
        const valListStr = await queryState(osQuery, "validators")
        if (!valListStr) return "?";
        const valListArr = valListStr.slice(1, -1).split(",");
        validatorIds = valListArr;
        return valListArr.length;
    })();
    data.network.total_validator_stake = 0; // TODO (in ParadigmCore)
    data.network.total_poster_stake = (await paradigm.posterRegistry.tokensContributed()).toString();
    
    // find and update `token` values
    data.token.total_supply = (await paradigm.digmToken.totalSupply()).toString();
    data.token.price = 0; // @todo consider

    // find and update `bandwidth` values
    data.bandwidth.total_limit = parseInt(await queryState(osQuery, "round/limit"));
    data.bandwidth.total_orders = await queryState(osQuery, "orderCounter");
    data.bandwidth.remaining_limit = await (async () => {
        const used = parseInt(await queryState(osQuery, "round/limitUsed"));
        if (!used) return null;
        const remaining = data.bandwidth.total_limit - used;
        return remaining;
    })();
    data.bandwidth.number_posters = await (async () => {
        const posterListStr = await queryState(osQuery, "posters");
        if (!posterListStr) return null;
        const posterListArr = posterListStr.slice(1, -1).split(",");
        return posterListArr.length;
    })();
    data.bandwidth.sec_to_next_period = await (async () => {
        const currentBlock = await web3.eth.getBlockNumber();
        const endingBlock = parseInt(await queryState(osQuery, "round/endsAt"));
        if (!endingBlock) return null;
        const rawDiff = endingBlock - currentBlock;
        const time = (rawDiff * 15) + 15;

        // set these values while we have them
        data.bandwidth.current_eth_block = currentBlock;
        data.bandwidth.period_end_eth_block = endingBlock;
        return time > 0 ? time : 0;
    })();
    data.bandwidth.rebalance_period_number = await queryState(osQuery, "round/number");

    // safety
    if (!validatorIds) {
        console.log("skipping validator info");
    } else {
        data.validators = [];

        // get validator info
        for (let i = 0; i < validatorIds.length; i++) {
            // setup validator
            const validator = {};
            const valId = validatorIds[i];

            // make necessary queries to local node's state
            const totalVotes = parseInt(await queryState(osQuery, `validators/${valId}/totalVotes`));
            const firstBlock = parseInt(await queryState(osQuery, `validators/${valId}/firstVote`));
            const lastVoted = parseInt(await queryState(osQuery, `validators/${valId}/lastVoted`));
            const publicKey = await queryState(osQuery, `validators/${valId}/publicKey`);
            const stake = await queryState(osQuery, `validators/${valId}/balance`);
            const power = await queryState(osQuery, `validators/${valId}/power`);

            // calculate uptime percent for this validator, this block
            const uptimePercent = Math.floor(100 * (totalVotes / ((data.network.block_height - firstBlock))));
            
            // assign values (raw and computed) to validator object
            validator["public_key"] = publicKey;
            validator["stake"] = stake;
            validator["uptime_percent"] = uptimePercent;
            validator["first_block"] = firstBlock;
            validator["last_voted"] = lastVoted;
            validator["power"] = power;
            
            // @todo update
            validator["reward"] = 0; // temporary

            // append this validator to validator array
            validators.push(validator);
        }
    }
    
    // set validator array
    data.validators = validators;

    // update clients with new data
    if (height && time) {
        Object.keys(clients).forEach((serverId) => {
            const { client, id } = clients[serverId];
            if (client.readyState !== client.OPEN) {
                return;
            }
            client.send(JSON.stringify({id, data}));
        })
    }
}

osSubscription.onerror = (msg) => {
    console.log(`!!! Caught Subscription Error: ${msg.error}`);
}

osQuery.onerror = (msg) => {
    console.log(`!!! Caught Query Error: ${msg.error}`);
}

// subscribe to paradigmcore JSONRPC 
osSubscription.onopen = () => {
    osSubscription.send(JSON.stringify({
        jsonrpc: "2.0",
        id: orderStreamId,
        method: "subscription.start",
        params: {
            eventName: "block",
            filters: [
                "height",
                "time"
            ]
        }
    }));
}

// handle client connection
server.on("connection", (socket, request) => {
    const subId = uuid();
    const serverId = uuid();
    clients[serverId] = {
        client: socket,
        id: subId
    }
    socket.send(JSON.stringify({ message: subId }));
    socket.onclose = () => {
        console.log("deleting client on disconnect");
        delete clients[serverId];
    }
    socket.onmessage = async (msg) => {
        let parsed: IWsRequest;
        let res: IWsResponse = { id: null, code: 1 };
        try {
            parsed = JSON.parse(msg.data.toString());
        } catch {
            res.data = `bad request: failed to parse`;
            socket.send(JSON.stringify(res));
            return;
        }
        const { id, method, param } = parsed;
        if (!id || !method || !param) {
            res.data = `missing required parameters`;
        } else if (!/(balance|limit)/.test(method)){
            res.data = `invalid method: '${method}'`;
        } else if (!/^0x[a-fA-F0-9]{40}$/.test(param)) {
            res.data = `invalid poster address`;
        } else {
            let resp;
            if (method === "balance") {
                const raw = await paradigm.digmToken.balanceOf(param);
                resp = raw.toString();
            } else if (method === "limit") {
                const path = `posters/${param.toLowerCase()}/limit`;
                resp = await queryState(osQuery, path);
            }
            if (resp) {
                res.data = resp;
                res.code = 0;
                res.id = id;
            } else {
                res.data = "node reported failed query, might have no balance";
            }
        }
        socket.send(JSON.stringify(res));
    }
    socket.onerror = (e) => {
        console.log(`error w/ connection '${serverId}': ${e.message}`);
    }
});



