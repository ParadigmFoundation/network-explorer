// local and remote imports
import * as c from "ansi-colors";
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
        }, 3500);
        const handler = (msg) => {
            const parsed = JSON.parse(msg.toString());
            if (parsed.id === reqid) {
                ws.off("message", handler);
                clearInterval(timer);
                resolve(parsed.result.response.info);
            }
        };
        ws.on("message", handler);
    }).catch((err) => {
        warn(`failed query: ${err}`);
    });
}

export function sendWrapper(ws: WebSocket, data: string | Buffer): void {
    if (ws.readyState === ws.OPEN) {
        ws.send(data);
        return;
    } else {
        return;
    }
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
