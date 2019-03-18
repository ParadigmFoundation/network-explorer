import * as redis from "redis";
import { error } from "./functions";
import { rejects } from "assert";

export class RedisWrapper {
    private db: redis.RedisClient;
    constructor() {
        this.db = redis.createClient();
        this.db.on("error", this.errorHandler());
    }
    private errorHandler(): (err) => void {
        return err => {
            error(`error encountered with redis connection: ${err}`);
        }
    }
    public get(key: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.db.get(key, (err, reply) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(reply);
                }
            });
        });
    }
    public set(key: string, value: string): Promise<void> {
        if (value === undefined || !value) {
            value = "";
        }
        return new Promise((resolve, reject) => {
            this.db.set(key, value, (err, reply) => {
                if (err || reply !== "OK") {
                    reject(err);
                } else {
                    resolve();
                }
            });
        })
    }
    public purgeAll(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.sendCommand("FLUSHALL", (err, reply) => {
                if (err || reply !== "OK") {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}