"use strict";

const readline = require("node:readline");
const pty = require("node-pty");

function send(message) {
  try {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  } catch {
    // Parent process may already be gone.
  }
}

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readArgs() {
  try {
    const parsed = JSON.parse(process.env.PTY_ARGS_JSON ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

const shell = process.env.PTY_SHELL;
const cwd = process.env.PTY_CWD;

if (!shell || !cwd) {
  send({ type: "error", message: "PTY helper missing shell or cwd" });
  process.exit(1);
}

const childEnv = { ...process.env };
delete childEnv.PTY_SHELL;
delete childEnv.PTY_ARGS_JSON;
delete childEnv.PTY_CWD;
delete childEnv.PTY_COLS;
delete childEnv.PTY_ROWS;
delete childEnv.PTY_TERM_NAME;

const term = pty.spawn(shell, readArgs(), {
  name: process.env.PTY_TERM_NAME || "xterm-256color",
  cols: parseNumber(process.env.PTY_COLS, 80),
  rows: parseNumber(process.env.PTY_ROWS, 24),
  cwd,
  env: childEnv,
  useConpty: process.platform === "win32" ? true : undefined,
});

let closed = false;

function closeHost(exitCode = 0) {
  if (closed) return;
  closed = true;
  try {
    term.kill();
  } catch {
    // Already terminated.
  }
  process.exit(exitCode);
}

term.onData((data) => {
  send({ type: "output", data });
});

term.onExit(({ exitCode, signal }) => {
  send({
    type: "exit",
    code: typeof exitCode === "number" ? exitCode : null,
    signal: typeof signal === "number" ? signal : null,
  });
  closeHost(0);
});

send({ type: "ready" });

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    switch (message?.type) {
      case "input":
        if (typeof message.data === "string") {
          term.write(message.data);
        }
        break;
      case "resize":
        if (
          Number.isInteger(message.cols) &&
          Number.isInteger(message.rows) &&
          message.cols > 0 &&
          message.rows > 0
        ) {
          term.resize(message.cols, message.rows);
        }
        break;
      case "close":
        closeHost(0);
        break;
      default:
        break;
    }
  } catch (error) {
    send({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

process.stdin.on("end", () => {
  closeHost(0);
});

process.on("SIGTERM", () => {
  closeHost(0);
});

process.on("SIGINT", () => {
  closeHost(0);
});

process.on("uncaughtException", (error) => {
  send({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  closeHost(1);
});
