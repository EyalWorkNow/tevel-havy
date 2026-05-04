import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";

console.log("Starting script execution...");

async function main() {
    console.log("Main function started");
    const reportPath = path.join(process.cwd(), "benchmark_results.md");
    fs.writeFileSync(reportPath, "# Running Benchmark...");
    console.log("Temp file created at " + reportPath);
    
    // Test fetch
    try {
        console.log("Testing fetch to Google...");
        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=AIzaSyD1Kgq98AyQM8CajElPGZKBn7AOehXVeIk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] })
        });
        console.log("Fetch Status:", res.status);
    } catch (e: any) {
        console.error("Fetch failed:", e.message);
    }
}

main().catch(console.error);
