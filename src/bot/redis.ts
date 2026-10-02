import { Redis } from "ioredis";
import { REDIS_URL } from "./config.js";

// Shared connection: Grammy session storage and the conversation summaries
export const redis = new Redis(REDIS_URL!);
