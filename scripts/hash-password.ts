/**
 * npm run auth:hash
 *
 * Prints an scrypt hash for AUTH_PASSWORD_HASH. The password is read from standard input — typed at a hidden
 * prompt, or piped — never from a command-line argument (which would land in shell history and process lists).
 * Only the hash is printed. Put it in Vercel's environment variables (or .env.local for local use), never in Git.
 *
 *   npm run --silent auth:hash                      # prompts, input hidden
 *   printf '%s' "$PW" | npm run --silent auth:hash  # from a variable or a password manager CLI
 */
import { hashPassword } from "../src/lib/auth/password";

async function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(prompt);
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let pw = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          return resolve(pw);
        }
        if (c === "\u0003") {
          stdin.setRawMode?.(false);
          return reject(new Error("cancelled"));
        }
        if (c === "\u007f" || c === "\b") pw = pw.slice(0, -1);
        else pw += c;
      }
    };
    stdin.on("data", onData);
  });
}

async function readPiped(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function main() {
  const pw = process.stdin.isTTY ? await readHidden("Password (input hidden): ") : await readPiped();
  if (pw.length < 8 || pw.length > 256) {
    process.stderr.write("The password must be 8–256 characters.\n");
    process.exit(1);
  }
  process.stdout.write((await hashPassword(pw)) + "\n");
}

main().catch(() => {
  process.stderr.write("Couldn't create the hash.\n");
  process.exit(1);
});
