// Legacy command alias. The reproducible benchmark never reuses Inbox classifications.
if (!process.argv.some((arg) => ["--split", "--resume", "--compare"].includes(arg))) process.argv.push("--split", "tuning");
void import("./run-ai-benchmark");
