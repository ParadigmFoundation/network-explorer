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
import { EventEmitter } from "events";

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
const clients: { [key: string]: ws } = {};
const lastBlockTimes: Array<number> = [];
let lastTime: number = null;

// emitter for synchronizing
const ee = new EventEmitter();

// setup WS server
const server = new Server({
    port: parseInt(PORT)
});

// setup web3 connection
// setup paradigm connection
const paradigm = new Paradigm();
const web3 = new newWeb3(WEB3_URL);

// setup connection to orderstream
const orderStreamWs = new ws(ORDERSTREAM_NODE_URL);
const orderStreamId = uuid();

orderStreamWs.onmessage = async (msg) => {
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
        const valListStr = await queryState(orderStreamWs, "validators")
        const valListArr = valListStr.slice(1, -1).split(",");
        validatorIds = valListArr;
        return valListArr.length;
    })();
    data.network.total_validator_stake = 0; // TODO (in ParadigmCore)

    // find and update `token` values
    data.token.total_supply = (await paradigm.digmToken.totalSupply()).toString();
    data.token.price = 0; // @todo consider

    // find and update `bandwidth` values
    data.bandwidth.total_limit = parseInt(await queryState(orderStreamWs, "round/limit"));
    data.bandwidth.total_orders = await queryState(orderStreamWs, "orderCounter");
    data.bandwidth.remaining_limit = await (async () => {
        const used = parseInt(await queryState(orderStreamWs, "round/limitUsed"));
        const remaining = data.bandwidth.total_limit - used;
        return remaining;
    })();
    data.bandwidth.number_posters = await (async () => {
        const posterListStr = await queryState(orderStreamWs, "posters")
        const posterListArr = posterListStr.slice(1, -1).split(",");
        return posterListArr.length;
    })();
    data.bandwidth.sec_to_next_period = await (async () => {
        const currentBlock = await web3.eth.getBlockNumber();
        const endingBlock = parseInt(await queryState(orderStreamWs, "round/endsAt"));
        const rawDiff = endingBlock - currentBlock;
        const time = (rawDiff * 15) + 15;

        // set these values while we have them
        data.bandwidth.current_eth_block = currentBlock;
        data.bandwidth.period_end_eth_block = endingBlock;
        return time > 0 ? time : 0;
    })();
    data.bandwidth.rebalance_period_number = await queryState(orderStreamWs, "round/number");

    // get validator info
    for (let i = 0; i < validatorIds.length; i++) {
        // setup validator
        const validator = {};
        const valId = validatorIds[i];

        // make necessary queries to local node's state
        const totalVotes = parseInt(await queryState(orderStreamWs, `validators/${valId}/totalVotes`));
        const firstBlock = parseInt(await queryState(orderStreamWs, `validators/${valId}/firstVote`));
        const lastVoted = parseInt(await queryState(orderStreamWs, `validators/${valId}/lastVoted`));
        const publicKey = await queryState(orderStreamWs, `validators/${valId}/publicKey`);
        const stake = await queryState(orderStreamWs, `validators/${valId}/balance`);
        const power = await queryState(orderStreamWs, `validators/${valId}/power`);

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
    
    // set validator array
    data.validators = validators;

    // update clients with new data
    if (height && time) {
        Object.keys(clients).forEach((id) => {
            const client = clients[id];
            if (client.readyState !== client.OPEN) {
                return;
            }
            client.send(JSON.stringify(data));
        })
    }
}

// subscribe to paradigmcore JSONRPC 
orderStreamWs.onopen = () => {
    orderStreamWs.send(JSON.stringify({
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
    const clientId = uuid();
    clients[clientId] = socket;
    socket.onclose = () => {
        console.log("deleting client on disconnect");
        delete clients[clientId];
    }
});



