import { appendFileSync } from "node:fs";
import { isIP } from "node:net";

try {
  // Runs before any provisioning secret is injected. IPv4 is forced by curl;
  // only a validated IP can reach GitHub's log/summary command channels.
  const { execFileSync } = await import("node:child_process");
  const ip = execFileSync("curl", ["-4", "--fail", "--silent", "--show-error",
    "--max-time", "20", "https://api.ipify.org"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (isIP(ip) !== 4) throw new Error();
  const message = `Atlas IP Access List: ${ip}/32. Aynan shu runner IP manzilini vaqtinchalik (6 soat) qo‘shing; iPhone IP manzilini emas. Ish tugashi bilan yozuvni o‘chiring.`;
  console.info(message);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Vaqtinchalik Atlas ruxsati\n\n${message}\n\n0.0.0.0/0 yoki GitHub IP diapazonlarini ochmang. Shu run ochiq tursin; boshqa run boshqa IP olishi mumkin.\n`);
} catch {
  console.error("Runner IPv4 manzilini aniqlab bo‘lmadi. Provisioning to‘xtatildi.");
  process.exitCode = 1;
}
