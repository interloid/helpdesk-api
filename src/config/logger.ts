import { pino } from "pino";
import { env, Environment } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "helpdesk-api" },
  // Defensive: nothing logs headers or bodies today, but ad-hoc req.log.info({...}) calls might.
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.secret",
      "*.authorization",
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
    ],
    censor: "[REDACTED]",
  },
  ...(env.NODE_ENV === Environment.Development
    ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } } }
    : {
        // Level as a label ("info") instead of a number, for log aggregators. Not allowed with transports.
        formatters: { level: (label: string) => ({ level: label }) },
      }),
});
