"use client";

import Link from "next/link";
import { CopyField } from "@/app/dashboard/agents-panel";

const MAC_OPEN =
  "mkdir -p ~/Library/Application\\ Support/Claude && touch ~/Library/Application\\ Support/Claude/claude_desktop_config.json && open -e ~/Library/Application\\ Support/Claude/claude_desktop_config.json";
const WIN_OPEN = 'notepad "%APPDATA%\\Claude\\claude_desktop_config.json"';

/** Copy-paste setup for MCP clients, written for someone who has never edited a config file. Keys travel in a header, never in the URL. */
export function ConnectInstructions({ mcpUrl, apiKey }: { mcpUrl: string; apiKey?: string }) {
  const key = apiKey ?? "alw_sk_YOUR_KEY";
  const entry = {
    command: "npx",
    args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${ALLOWANCE_AUTH}"],
    env: { ALLOWANCE_AUTH: `Bearer ${key}` },
  };
  const desktop = JSON.stringify({ mcpServers: { allowance: entry } }, null, 2);
  const entryOnly = `"allowance": ${JSON.stringify(entry, null, 2)}`;
  const claudeCode = `claude mcp add --transport http allowance ${mcpUrl} --header "Authorization: Bearer ${key}"`;
  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-1 rounded-lg border bg-muted/30 p-3">
        <p>
          <strong>No setup needed to try it:</strong>{" "}
          <Link href="/agent" className="underline underline-offset-2">
            Try the agent
          </Link>{" "}
          uses the same four tools Claude gets.
        </p>
        <p className="text-muted-foreground">
          Keys belong to this demo account and stop working when it expires (24 hours after you started the demo).
        </p>
      </div>

      <section className="space-y-2">
        <h3 className="font-medium">1. Claude Code (fastest: one command)</h3>
        <CopyField value={claudeCode} label="Claude Code command" />
        <p className="text-muted-foreground">
          Then run <code className="font-mono">claude</code> and ask: <em>&ldquo;What&apos;s my Allowance budget?&rdquo;</em>
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">2. Claude Desktop</h3>
        <ol className="list-[lower-alpha] space-y-4 pl-5">
          <li>{apiKey ? "Your new key is already filled in below." : "Create a key above; the config below fills it in."}</li>
          <li className="space-y-2">
            <p>Open Claude&apos;s config file:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>
                <strong className="text-foreground">Mac:</strong> click <strong>Claude</strong> in the menu bar at the very top of the
                screen (next to the Apple logo) → <strong>Settings…</strong> (⌘,) → scroll the left sidebar down to{" "}
                <strong>Developer</strong> → <strong>Edit Config</strong> → open <code className="font-mono">claude_desktop_config.json</code>{" "}
                in TextEdit.
              </li>
              <li>
                <strong className="text-foreground">Windows:</strong> the <strong>☰</strong> menu at the top-left of Claude →{" "}
                <strong>File → Settings…</strong> → <strong>Developer</strong> → <strong>Edit Config</strong> → open it with Notepad.
              </li>
            </ul>
            <p className="text-muted-foreground">Can&apos;t find Developer? Open the file directly:</p>
            <p className="text-xs text-muted-foreground">Mac (paste into Terminal):</p>
            <CopyField value={MAC_OPEN} label="Mac command to open the Claude config file" />
            <p className="text-xs text-muted-foreground">Windows (press Win+R, paste, press Enter):</p>
            <CopyField value={WIN_OPEN} label="Windows command to open the Claude config file" />
          </li>
          <li className="space-y-2">
            <p>Paste the Allowance settings. Check what&apos;s in the file first:</p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">If the file is empty or only has {"{}"}:</strong> replace everything with this:
            </p>
            <CopyField value={desktop} label="Claude Desktop config (whole file)" />
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
              <p>
                <strong>If the file already has text, don&apos;t delete it.</strong> Copy just the Allowance entry:
              </p>
              <CopyField value={entryOnly} label="Just the Allowance entry" />
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  If the file already has <code className="font-mono">&quot;mcpServers&quot;: {"{ … }"}</code>, paste the entry inside
                  it, after the last server, with a comma before it.
                </li>
                <li>
                  Otherwise add <code className="font-mono">&quot;mcpServers&quot;: {"{ <entry> }"}</code> just before the file&apos;s
                  final <code className="font-mono">{"}"}</code>, with a comma after the previous setting.
                </li>
              </ul>
            </div>
          </li>
          <li>
            Save, then <strong>fully quit</strong> Claude (⌘Q on Mac; on Windows right-click the Claude icon in the system tray →
            Quit) and reopen it.
          </li>
          <li>
            Check: in a new chat, ask <em>&ldquo;What&apos;s my Allowance budget?&rdquo;</em> and click <strong>Allow</strong> when Claude
            asks to use Allowance. Then try{" "}
            <em>&ldquo;Restock my coffee and get the book I mentioned: The Pragmatic Programmer.&rdquo;</em>
          </li>
        </ol>
        <div className="space-y-1 rounded-lg border p-3">
          <p className="font-medium">Troubleshooting</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              <strong className="text-foreground">&ldquo;Server disconnected&rdquo; or npx not found:</strong> install Node.js LTS
              from{" "}
              <a href="https://nodejs.org" className="underline underline-offset-2" target="_blank" rel="noreferrer">
                nodejs.org
              </a>
              , then restart Claude. On a Mac, if it still fails, replace <code className="font-mono">&quot;npx&quot;</code> with the
              output of <code className="font-mono">which npx</code> in Terminal (e.g. <code className="font-mono">/usr/local/bin/npx</code>).
            </li>
            <li>
              <strong className="text-foreground">Claude won&apos;t start, or reports a config error:</strong> a missing or extra comma.
              Paste the file into{" "}
              <a href="https://jsonlint.com" className="underline underline-offset-2" target="_blank" rel="noreferrer">
                jsonlint.com
              </a>{" "}
              to find it.
            </li>
            <li>
              <strong className="text-foreground">&ldquo;Invalid API key&rdquo;:</strong> the demo account expired. Create a new key
              and replace the old one.
            </li>
          </ul>
        </div>
      </section>

      <section className="space-y-1">
        <h3 className="font-medium">3. Any MCP client</h3>
        <p className="text-muted-foreground">
          Streamable HTTP at <code className="font-mono">{mcpUrl}</code> with header{" "}
          <code className="font-mono">Authorization: Bearer {apiKey ? "<your key>" : key}</code>. Claude.ai web
          connectors need OAuth, which Allowance doesn&apos;t offer yet, so use Claude Desktop or Claude Code.
        </p>
      </section>
    </div>
  );
}
