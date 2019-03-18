/**
 * @date 15 March 2019
 * @author Henry Harder
 * 
 * Very sloppy. Cleanup coming soon.
 * 
 * REQUIRED ENV VARS:
 * - PORT: a tcp port to bind the ws server to
 * - AVERAGE_OVER: a number of blocks to average the block-time interval over
 * - ORDERSTREAM_NODE_URL: the full url of a ParadigmCore JSONRPC server
**/

// load config 
require("dotenv").config();

// imports
import * as ws from "ws";
import * as uuid from "uuid/v4";
import * as _ from "lodash";
import * as Paradigm from "paradigm-connect";
import { Server } from "ws";

// local functions
import { queryState, sendWrapper, log, warn, error } from "./functions";
import { DataManager } from "./DataManager";
import { fields as defs } from "./paths";

// destructure config
const { ORDERSTREAM_NODE_URL, PORT, AVERAGE_OVER, VALIDATOR_INTERVAL } = process.env;

// local interface definition (requires import type)
interface IClientMap {
    [id: string]: {
        client: ws,
        id: string
    }
}

// data tracker will store and update network data
let dm: DataManager;

// const paradigm = new Paradigm()
const clients: IClientMap = {};

// setup WS server
const server = new Server({ port: parseInt(PORT) });

// setup web3 connection
const paradigm = new Paradigm();

// generate connection id
const orderStreamId = uuid();

// setup connections to orderstream node
const osSubscription = new ws(ORDERSTREAM_NODE_URL);
const osQuery = new ws(ORDERSTREAM_NODE_URL);

osSubscription.onmessage = async (msg) => {
    // pull/parse some values
    const parsed = JSON.parse(msg.data.toString())
    const { height, time } = parsed.result

    // skip if not a bock
    if (_.isNaN(parseInt(time))) return;

    // update block data
    dm.updateBlockData(height, time);

    // skip broadcast if no clients 
    if (Object.keys(clients).length === 0) {
        log(`new block found but skipping broadcast with 0 clients connected`);
        return;
    };

    // update clients with new data
    if (height && time) {
        let counter = 0;
        const data = dm.getLatest();
        Object.keys(clients).forEach((serverId) => {
            const { client, id } = clients[serverId];
            if (client.readyState === client.OPEN) {
                const message = JSON.stringify({ id, data });
                sendWrapper(client, message);
                counter++;
                return;
            } else {
                return;
            }
        });
        log(`finished sending updated network data to ${counter} clients`);
    }
}

osSubscription.onerror = (msg) => {
    error(`caught error in subscription connection: ${msg.error}`);
}

osQuery.onerror = (msg) => {
    error(`caught error in query connection: ${msg.error}`);
}

osQuery.onopen = () => {
    log(`query connection now open to with OrderStream node`);
    dm = new DataManager(
        defs,
        ORDERSTREAM_NODE_URL,
        parseInt(AVERAGE_OVER),
        parseInt(VALIDATOR_INTERVAL));
}

// subscribe to paradigmcore JSONRPC 
osSubscription.onopen = () => {
    const subscriptionMessage = JSON.stringify({
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
    });
    sendWrapper(osSubscription, subscriptionMessage);
}

// handle client connection and requests
server.on("connection", (socket, request) => {
    const subId = uuid();
    const serverId = uuid();
    clients[serverId] = {
        client: socket,
        id: subId
    }
    log(`adding new client with id '${serverId}'`);
    sendWrapper(socket, JSON.stringify({ message: subId }));
    socket.onclose = () => {
        log(`client disconnected with id '${serverId}'`);
        delete clients[serverId];
    }
    socket.onmessage = async (msg) => {
        let parsed: IWsRequest;
        let res: IWsResponse = { id: null, code: 1 };
        try {
            parsed = JSON.parse(msg.data.toString());
        } catch (err){
            res.data = `bad request: failed to parse`;
            sendWrapper(socket, JSON.stringify(res));
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
        sendWrapper(socket, JSON.stringify(res));
        log(`handled request from client '${serverId}' with code '${res.code}'`);
    }
    socket.onerror = (e) => {
        warn(`error encountered in connection with '${serverId}': ${e.message}`);
    }
});



