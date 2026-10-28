// Legacy command alias for the frozen holdout; never imports into the application DB.
if (!process.argv.some((arg) => ["--split", "--resume", "--compare"].includes(arg))) process.argv.push("--split", "holdout");
void import("./run-ai-benchmark");
