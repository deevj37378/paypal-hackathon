"use client";

import { CopyField } from "@/app/dashboard/agents-panel";

/** Copy-paste setup for MCP clients. Keys travel in a header, never in the URL. */
export function ConnectInstructions({ mcpUrl, apiKey }: { mcpUrl: string; apiKey?: string }) {
  const key = apiKey ?? "alw_sk_YOUR_KEY";
  const desktop = JSON.stringify(
    {
      mcpServers: {
        allowance: {
          command: "npx",
          args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${ALLOWANCE_AUTH}"],
          env: { ALLOWANCE_AUTH: `Bearer ${key}` },
        },
      },
    },
    null,
    2,
  );
  const claudeCode = `claude mcp add --transport http allowance ${mcpUrl} --header "Authorization: Bearer ${key}"`;
  return (
    <div className="space-y-4 text-sm">
      <section className="space-y-2">
        <h3 className="font-medium">Claude Desktop</h3>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>
            Open Claude Desktop → <strong>Settings → Developer → Edit Config</strong> (claude_desktop_config.json).
          </li>
          <li>Add this, save, and fully quit and reopen Claude Desktop (needs Node.js for npx):</li>
        </ol>
        <CopyField value={desktop} label="Claude Desktop config" />
        <p className="text-muted-foreground">
          Then ask: <em>&ldquo;Restock my coffee and get the book I mentioned: The Pragmatic Programmer.&rdquo;</em>
        </p>
      </section>
      <section className="space-y-2">
        <h3 className="font-medium">Claude Code</h3>
        <CopyField value={claudeCode} label="Claude Code command" />
      </section>
      <section className="space-y-1">
        <h3 className="font-medium">Any MCP client</h3>
        <p className="text-muted-foreground">
          Streamable HTTP at <code className="font-mono">{mcpUrl}</code> with header{" "}
          <code className="font-mono">Authorization: Bearer {apiKey ? "<your key>" : key}</code>. Claude.ai web
          connectors need OAuth, which Allowance doesn&apos;t offer yet, so use Claude Desktop or Claude Code.
        </p>
      </section>
    </div>
  );
}
