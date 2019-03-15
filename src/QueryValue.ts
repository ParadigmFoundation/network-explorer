
import * as WebSocket from "ws";
import * as uuid from "uuid/v4"

/**
 * A self-updating value returned as a result of a query to an OrderStream node's
 * local state.
 * 
 * Supports configurable update intervals.
 */
export class QueryValue {
    /** The path of the query value in state */
    private path: string;
    
    /** ParadigmCore JSONRPC socket instance */
    private socket: WebSocket;

    /** The interval in which to update the value (in ms) */
    private interval: number;

    /** Timer instance (to support cancellation) */
    private timer: NodeJS.Timer;

    /** Instance status */
    private started: boolean;

    /** The actual value of the instance */
    private currentValue: any;

    /** An optional function to be called on each updating value. */
    private cb: (val: any) => any = val => { return val };

    /**
     * Create a new `QueryValue` instance.
     * 
     * @param path the path to query with each update
     * @param socket query connection JSONRPC instance
     * @param interval the interval in ms to update with
     */
    constructor(socket: WebSocket, path: string, interval: number, cb?) {
        this.path = path;
        this.socket = socket;
        this.interval = interval;
        if (cb) {
            this.cb = cb;
        }
        if ((this.started = this.start()) !== true) {
            throw new Error("Failed to start query value.");
        };
        // this.updateValue();
    }

    /**
     * Execute a state query and update the value.
     */
    private updateValue(): () => void {
        return async () => {
            try {
                const maybePromise = this.cb(await this.executeQuery());
                if (typeof maybePromise.then === 'function') {
                    this.currentValue = await maybePromise;
                } else {
                    this.currentValue = maybePromise;
                }
            } catch {
            }
        }
    }

    /**
     * View the current state.
     */
    public is(): any {
        return this.currentValue;
    }

    /**
     * Stop a value from updating.
     * 
     * Returns `true` if operation succeeded, false otherwise.
     */
    public stop(): boolean {
        if (!this.started) return false;
        clearInterval(this.timer);
        return !(this.started = false);
    }

    /**
     * Start auto-updating value.
     * 
     * Returns `true` if operation succeeded, false otherwise.
     */
    public start(): boolean {
        if (this.started) return false;
        this.timer = setInterval(this.updateValue(), this.interval);
        return (this.started = true);
    }

    /**
     * Perform a state query over the ParadigmCore JSONRPC API.
     */
    private executeQuery(): Promise<any> {
        return new Promise((resolve, reject) => {
            const reqid = uuid();
            this.socket.send(JSON.stringify({
                jsonrpc: "2.0",
                id: reqid,
                method: "state.query",
                params: { path: this.path }
            }));
            const timer = setTimeout(() => {
                this.socket.off("message", handler);
                console.log(`timeout: failed query: "${this.path}"`);
                resolve();
            }, 5000);
            const handler = (msg) => {
                const parsed = JSON.parse(msg.toString());
                if (parsed.id === reqid) {
                    this.socket.off("message", handler);
                    clearInterval(timer);
                    resolve(parsed.result.response.info);
                }
            };
            this.socket.on("message", handler);
        });
    }

    /**
     * Manually trigger an update to the state value.
     */
    public update(): void {
        this.updateValue()();
    }
}