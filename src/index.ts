/**
 * @date 14 March 2019
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
import { queryState } from "./functions";
import { CoreData } from "./CoreData";

// avoid compiler errors (grr @web3.js)
let newWeb3: any = Web3;

// destructure vars
const {
    ORDERSTREAM_NODE_URL, 
    PORT,
    AVERAGE_OVER,
    WEB3_URL
} = process.env;

// basic setup
// const paradigm = new Paradigm()
const clients: {
    [key: string]: {
        client: ws,
        id: string
    }
} = {};

// setup WS server
const server = new Server({
    port: parseInt(PORT)
});

// setup web3 connection
// setup paradigm connection
const web3 = new newWeb3(WEB3_URL);
const paradigm = new Paradigm();

// data tracker
let netData: CoreData;

// setup connection to orderstream
const osSubscription = new ws(ORDERSTREAM_NODE_URL);
const osQuery = new ws(ORDERSTREAM_NODE_URL);
const orderStreamId = uuid();

osSubscription.onmessage = async (msg) => {
    // will store this block's diff
    let diff;

    // pull/parse some values
    const parsed = JSON.parse(msg.data.toString())
    const { height, time } = parsed.result

    // skip if not a bock
    if (_.isNaN(parseInt(time))) return;

    // update block data
    netData.updateBlockData(height, time);

    // skip broadcast if no clients 
    if (Object.keys(clients).length === 0) { return };

    // update clients with new data
    if (height && time) {
        Object.keys(clients).forEach((serverId) => {
            const { client, id } = clients[serverId];
            if (client.readyState !== client.OPEN) {
                return;
            }
            client.send(JSON.stringify({id, data: netData.toJSON()}));
        })
    }
}

osSubscription.onerror = (msg) => {
    console.log(`!!! Caught Subscription Error: ${msg.error}`);
}

osQuery.onerror = (msg) => {
    console.log(`!!! Caught Query Error: ${msg.error}`);
}

osQuery.onopen = () => {
    console.log(`Query connection now open.`);
    netData = new CoreData(osQuery, paradigm, parseInt(AVERAGE_OVER));
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



