// local and remote imports
import * as c from "ansi-colors";
import * as uuid from "uuid/v4";
import * as WebSocket from "ws";
import { orderHashUtils, Order } from "0x.js";

export function getHash(order: Order): string {
    try {
        return orderHashUtils.getOrderHashHex(order);
    } catch (error) {
        throw new Error("Unable to generate order hash.");
    }
}

export function calculateAverageBlockTime(diffs: number[]): number {
    let average, length, sum = 0;
    length = diffs.length;
    diffs.forEach(diff =>  sum += diff);
    average = Math.round(sum / length);
    return average;
}

export function addBlockTime(blockTimes: number[], blockTime: number, limit: number) {
    if (blockTimes.length < limit) {
        blockTimes.push(blockTime);
    } else if (blockTimes.length === limit) {
        blockTimes.shift();
        blockTimes.push(blockTime);
    } else {
        blockTimes.push(blockTime);
        while (blockTimes.length > limit) {
            blockTimes.shift();
        }
    }
}

export function queryState(ws: WebSocket, path: string, timeout: number = 3500): Promise<any> {
    return new Promise((resolve, reject) => {
        const reqid = uuid();
        const timer = setTimeout(() => {
            ws.off("message", handler);
            clearInterval(timer);
            reject(`timeout: failed query: "${path}"`);
        }, timeout);
        const handler = (msg) => {
            const parsed = JSON.parse(msg.toString());
            if (parsed.id === reqid) {
                ws.off("message", handler);
                clearInterval(timer);
                resolve(parsed.result.response.info);
            }
        };
        ws.on("message", handler);
        ws.send(JSON.stringify({
            jsonrpc: "2.0",
            id: reqid,
            method: "state.query",
            params: { path }
        }));
    }).catch((err) => {
        warn(`failed query: ${err}`);
    });
}

export function executeBatchQuery(ws, batch, timeout:number = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
        let responses = [];
        const reqid = uuid();
        const timer = setTimeout(() => {
            ws.off("message", handler);
            clearInterval(timer);
            reject(`timeout: failed batch query`);
        }, timeout);
        const handler = (msg) => {
            const parsed = JSON.parse(msg.toString());
            if (!Array.isArray(parsed)) {
                return;
            } else {
                parsed.forEach((v, i) => {
                    responses.push(v.result.response.info);
                });
                clearInterval(timer);
                resolve(responses);
            }
        };
        ws.on("message", handler);
        ws.send(JSON.stringify(batch));
    }).catch((err) => {
        warn(`\nfailed batch query: ${err}\n`);
    });  
}

export function createBatchQueryRequest(paths: string[]): any[] {
    let requests = [];
    paths.forEach((path) => {
        const request = {
            jsonrpc: "2.0",
            id: uuid(),
            method: "state.query",
            params: { path }
        };
        requests.push(request);
    });
    return requests;
}

export function sendWrapper(ws: WebSocket, data: string | Buffer): void {
    if (ws.readyState === ws.OPEN) {
        ws.send(data);
        return;
    } else {
        return;
    }
}

export async function parseOrder(paradigm, rawOrder: any): Promise<IOrder> {
    const order: any = {};
    const pOrder = new paradigm.Order(rawOrder);
    order.maker_address = pOrder.makerValues.makerAddress;
    order.order_id = getHash(pOrder.makerValues);
    order.order_type = "0x";
    order.poster_address = await pOrder.recoverPoster();
    return order as IOrder;
}

/**
 * Creates a pretty timestamp string.
 */
export function ts(): string {
    let dt = new Date().toISOString().split("T");
    return c.bold.black(`${dt[0]} ${dt[1].split("Z")[0]}`);
}

export function log(msg: string): void {
    console.log(`${ts()} ${c.bold.green("info:")} ${msg}`);
}

export function warn(msg: string): void {
    console.warn(`${ts()} ${c.bold.yellow("warning:")} ${msg}`);
}

export function error(msg: string): void {
    console.error(`${ts()} ${c.bold.red("error:")} ${msg}`);
}
