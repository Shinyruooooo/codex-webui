import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LiveSessionStore, parseRollout } from "../live-session-service.js";

const line = (type: string, payload: any, timestamp = "2026-08-11T06:26:25.000Z") => JSON.stringify({ timestamp, type, payload }) + "\n";

describe("Desktop-style live session reader", () => {
  test("reconstructs an active CLI command and its available output", () => {
    const input = [
      line("event_msg", { type: "task_started", turn_id: "turn-1", started_at: 10 }),
      line("event_msg", { type: "user_message", message: "Start the task." }),
      line("response_item", { type: "message", id: "msg-1", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "Running now." }] }),
      line("response_item", { type: "custom_tool_call", id: "tool-1", call_id: "call-1", name: "exec", input: 'const r = await tools.exec_command({cmd:"for i in 1 2; do echo $i; done",workdir:"/tmp"}); text(r);' }),
      line("response_item", { type: "custom_tool_call_output", call_id: "call-1", output: "Script running with cell ID 5\nWall time 11.1 seconds\nOutput:\n1\n" }),
      line("event_msg", { type: "user_message", message: "Also check the stylesheet." }),
      line("event_msg", {
        type: "patch_apply_end",
        call_id: "exec-1",
        turn_id: "turn-1",
        stdout: "Success. Updated the following files:\nM /tmp/app.css\n",
        stderr: "",
        success: true,
        status: "completed",
        changes: {
          "/tmp/app.css": { type: "update", unified_diff: "@@ -1 +1 @@\n-old\n+new\n", move_path: null },
          "/tmp/new.ts": { type: "add", content: "export const ready = true;\n" },
        },
      }),
    ].join("");
    const state = parseRollout(input);
    expect(state.active).toBe(true);
    expect(state.turn.status).toBe("inProgress");
    expect(state.turn.items.find((item: any) => item.type === "agentMessage")).toMatchObject({ text: "Running now.", phase: "commentary" });
    expect(state.turn.items.find((item: any) => item.type === "commandExecution")).toMatchObject({ command: "for i in 1 2; do echo $i; done", status: "inProgress", aggregatedOutput: "1\n" });
    expect(state.turn.items.filter((item: any) => item.type === "userMessage")).toEqual([
      expect.objectContaining({ content: [{ type: "text", text: "Also check the stylesheet." }] }),
    ]);
    expect(state.turn.items.find((item: any) => item.type === "fileChange")).toMatchObject({
      status: "completed",
      changes: [{
        path: "/tmp/app.css",
        kind: { type: "update", move_path: null },
        diff: "@@ -1 +1 @@\n-old\n+new\n",
      }, {
        path: "/tmp/new.ts",
        kind: { type: "add", move_path: null },
        diff: "@@ -0,0 +1,1 @@\n+export const ready = true;\n",
      }],
    });
  });

  test("increments without rereading history and stops exposing a completed turn", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-live-session-"));
    const path = join(directory, "rollout.jsonl");
    const store = new LiveSessionStore();
    try {
      writeFileSync(path, line("event_msg", { type: "task_started", turn_id: "turn-2", started_at: 20 }) + line("response_item", { type: "custom_tool_call", id: "tool-2", call_id: "call-2", name: "exec", input: 'const r=await tools.exec_command({cmd:"bun test"}); text(r);' }));
      expect(store.read(path).turn.items[0]).toMatchObject({ command: "bun test", status: "inProgress" });
      appendFileSync(path, line("response_item", { type: "custom_tool_call_output", call_id: "call-2", output: [{ type: "input_text", text: "Script completed\nWall time 1.0 seconds\nOutput:\n" }, { type: "input_text", text: '{"exit_code":0,"output":"2 pass\\n"}' }] }));
      expect(store.read(path).turn.items[0]).toMatchObject({ status: "completed", aggregatedOutput: "2 pass\n", exitCode: 0 });
      appendFileSync(path, line("event_msg", { type: "task_complete", turn_id: "turn-2", completed_at: 22 }));
      expect(store.read(path)).toMatchObject({ active: false, turn: null });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test("retains normalized CLI token usage across turns and incremental reads", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-live-session-"));
    const path = join(directory, "rollout.jsonl");
    const store = new LiveSessionStore();
    const firstUsage = {
      total_token_usage: { input_tokens: 120, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 10, total_tokens: 150 },
      last_token_usage: { input_tokens: 40, cached_input_tokens: 5, output_tokens: 15, reasoning_output_tokens: 4, total_tokens: 55 },
      model_context_window: 4096,
    };
    const latestUsage = {
      total_token_usage: { input_tokens: 180, cached_input_tokens: 25, output_tokens: 45, reasoning_output_tokens: 12, total_tokens: 225 },
      last_token_usage: { input_tokens: 60, cached_input_tokens: "invalid", output_tokens: 15, reasoning_output_tokens: 4, total_tokens: 75 },
      model_context_window: 8192,
    };
    try {
      writeFileSync(path, line("event_msg", { type: "token_count", info: firstUsage }));
      appendFileSync(path, line("event_msg", { type: "task_started", turn_id: "turn-token", started_at: 40 }));
      const beforeAppend = store.read(path);
      expect(beforeAppend.tokenUsage).toEqual({
        total: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 30, reasoningOutputTokens: 10, totalTokens: 150 },
        last: { inputTokens: 40, cachedInputTokens: 5, outputTokens: 15, reasoningOutputTokens: 4, totalTokens: 55 },
        modelContextWindow: 4096,
      });
      beforeAppend.tokenUsage.total.inputTokens = 9999;

      appendFileSync(path,
        line("event_msg", { type: "token_count", info: latestUsage })
        + line("event_msg", { type: "token_count", info: null })
        + line("event_msg", { type: "task_complete", turn_id: "turn-token", completed_at: 41 }),
      );
      const completed = store.read(path);
      expect(completed).toMatchObject({ active: false, turn: null });
      expect(completed.tokenUsage).toEqual({
        total: { inputTokens: 180, cachedInputTokens: 25, outputTokens: 45, reasoningOutputTokens: 12, totalTokens: 225 },
        last: { inputTokens: 60, cachedInputTokens: null, outputTokens: 15, reasoningOutputTokens: 4, totalTokens: 75 },
        modelContextWindow: 8192,
      });
      completed.tokenUsage.last.totalTokens = 0;
      expect(store.read(path).tokenUsage.last.totalTokens).toBe(75);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test("appends CLI steering and file edits once during incremental reads", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-live-session-"));
    const path = join(directory, "rollout.jsonl");
    const store = new LiveSessionStore();
    try {
      writeFileSync(path,
        line("event_msg", { type: "task_started", turn_id: "turn-3", started_at: 30 })
        + line("event_msg", { type: "user_message", message: "Initial prompt" }),
      );
      expect(store.read(path).turn.items).toHaveLength(0);

      appendFileSync(path,
        line("event_msg", { type: "user_message", message: "Steer the active task" }, "2026-08-11T06:26:26.000Z")
        + line("event_msg", {
          type: "patch_apply_end",
          turn_id: "turn-3",
          success: true,
          status: "completed",
          changes: { "/tmp/live.ts": { type: "update", unified_diff: "@@ -1 +1 @@\n-a\n+b\n", move_path: null } },
        }, "2026-08-11T06:26:27.000Z"),
      );
      const updated = store.read(path).turn;
      expect(updated.items).toHaveLength(2);
      expect(updated.items[0]).toMatchObject({
        id: "host-user-turn-3-2",
        type: "userMessage",
        content: [{ type: "text", text: "Steer the active task" }],
      });
      expect(updated.items[1]).toMatchObject({
        id: "host-patch-turn-3-1",
        type: "fileChange",
        changes: [{ path: "/tmp/live.ts", diff: "@@ -1 +1 @@\n-a\n+b\n" }],
      });
      expect(store.read(path).turn.items).toHaveLength(2);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
