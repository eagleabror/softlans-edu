import type { PasswordEmail } from "../../src/password-email.js";
/** In-memory test mailbox. Never loaded by production; contains secrets, so never log it. */
export class TestPasswordEmail implements PasswordEmail {
  messages: { to: string; resetUrl: string }[] = [];
  fail = false;
  async sendReset(message: { to: string; resetUrl: string }) {
    if (this.fail) throw new Error(`Provider failed: ${message.resetUrl}`);
    this.messages.push(message);
  }
  token(index = this.messages.length - 1) {
    return new URLSearchParams(new URL(this.messages[index]!.resetUrl).hash.slice(1)).get("token")!;
  }
}
