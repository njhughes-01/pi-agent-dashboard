/**
 * Probe-only pi extension for probe-leaf-helper.sh: registers a scripted faux
 * model plus four dummy tools. The scripted turn calls Agent, agent_probe,
 * workflow_probe (the excluded families), probe_ok and the built-in read; the
 * probe then compares which calls ran. No credentials are involved.
 * See change: fork-release-and-local-install.
 */
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const dummy = (name: string) => ({
  name,
  label: name,
  description: name,
  parameters: Type.Object({}),
  async execute() {
    return { content: [{ type: "text", text: `${name} RAN` }], details: {} };
  },
});

export default function probeExtension(pi: any) {
  for (const name of ["Agent", "agent_probe", "workflow_probe", "probe_ok"]) pi.registerTool(dummy(name));
  const registration = fauxProvider({ api: "faux", provider: "faux", models: [{ id: "faux-1", input: ["text"] }], tokensPerSecond: 500 });
  const router = (context: any) => {
    registration.appendResponses([router as never]);
    const answered = (context.messages ?? []).some((m: any) => m.role === "assistant");
    if (answered) return fauxAssistantMessage([{ type: "text", text: "done" } as never]);
    const calls = ["Agent", "agent_probe", "workflow_probe", "probe_ok"].map((n) => fauxToolCall(n, {}));
    calls.push(fauxToolCall("read", { path: "package.json" }));
    return fauxAssistantMessage(calls, { stopReason: "toolUse" });
  };
  registration.setResponses([router as never]);
  pi.registerProvider("faux", {
    name: "Faux",
    baseUrl: "http://localhost:0",
    apiKey: "faux-no-key",
    api: "faux" as never,
    streamSimple: registration.provider.streamSimple as never,
    models: [{ id: "faux-1", name: "faux-1", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
  });
}
