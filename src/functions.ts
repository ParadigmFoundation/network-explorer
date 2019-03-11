import * as uuid from "uuid/v4";
import * as WebSocket from "ws";

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

export function queryState(ws: WebSocket, path): Promise<any> {
    return new Promise((resolve, reject) => {
        const reqid = uuid();
        ws.send(JSON.stringify({
            jsonrpc: "2.0",
            id: reqid,
            method: "state.query",
            params: { path }
        }));
        const timer = setTimeout(() => {
            ws.off("message", handler);
            reject(`timeout: failed query: "${path}"`);
        }, 3000);
        const handler = (msg) => {
            const parsed = JSON.parse(msg.toString());
            if (parsed.id === reqid) {
                ws.off("message", handler);
                clearInterval(timer);
                resolve(parsed.result.response.info);
            }
        };
        ws.on("message", handler);
    }).catch(console.log);
}