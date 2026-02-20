import { useState, useEffect, useRef } from "react";

const MONO = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";
const SANS = "'IBM Plex Sans', 'SF Pro Text', system-ui, sans-serif";

// Color palette - dark IDE theme
const C = {
  bg: "#0d1117",
  bgPanel: "#161b22",
  bgActive: "#1c2333",
  bgHover: "#21262d",
  border: "#30363d",
  borderActive: "#58a6ff",
  text: "#c9d1d9",
  textDim: "#8b949e",
  textBright: "#f0f6fc",
  accent: "#58a6ff",
  green: "#3fb950",
  red: "#f85149",
  orange: "#d29922",
  purple: "#bc8cff",
  cyan: "#39d353",
  yellow: "#e3b341",
  lineHighlight: "#1f2937",
  lineActive: "#2d1b00",
  diffAdd: "#0d2818",
  diffRemove: "#3d1114",
};

// Simulated source code
const SOURCE_CODE = [
  { n: 40, t: "    @PostMapping(\"/api/pedidos\")" },
  { n: 41, t: "    public PedidoResponse criarPedido(@RequestBody PedidoDTO dto) {" },
  { n: 42, t: "        log.info(\"Criando pedido para cliente: {}\", dto.getClienteId());" },
  { n: 43, t: "        Cliente cliente = clienteRepo" },
  { n: 44, t: "            .findById(dto.getClienteId())" },
  { n: 45, t: "            .orElse(null);" },
  { n: 46, t: "" },
  { n: 47, t: "        String nome = cliente.getNome();  // NPE here" },
  { n: 48, t: "        BigDecimal total = calcularTotal(dto.getItens());" },
  { n: 49, t: "        Pedido pedido = new Pedido(cliente, total);" },
  { n: 50, t: "        return pedidoRepo.save(pedido).toResponse();" },
  { n: 51, t: "    }" },
];

// Event timeline
const EVENTS = [
  { t: 0, ts: "14:32:01", type: "agent", icon: "🤖", text: "debug/launch PedidoService (Maven, -g)", tokens: 12 },
  { t: 800, ts: "14:32:03", type: "agent", icon: "🤖", text: "debug/catch NullPointerException", tokens: 8 },
  { t: 1200, ts: "14:32:03", type: "agent", icon: "🤖", text: "debug/catch IllegalArgumentException", tokens: 8 },
  { t: 1600, ts: "14:32:04", type: "agent", icon: "🤖", text: "debug/continue", tokens: 5 },
  { t: 2000, ts: "14:32:04", type: "system", icon: "▶", text: "Aplicação rodando em http://localhost:8080", tokens: 0 },
  { t: 3500, ts: "14:33:15", type: "exception", icon: "⚡", text: "NullPointerException em PedidoService.java:47", tokens: 0 },
  { t: 4200, ts: "14:33:15", type: "agent", icon: "🤖", text: "debug/stacktrace → 5 frames", tokens: 15 },
  { t: 4800, ts: "14:33:15", type: "agent", icon: "🤖", text: "debug/locals → dto, cliente=null", tokens: 18 },
  { t: 5500, ts: "14:33:16", type: "agent", icon: "🤖", text: "debug/inspect dto.getClienteId() → 999", tokens: 12 },
  { t: 6200, ts: "14:33:16", type: "agent", icon: "🤖", text: "debug/evaluate clienteRepo.findById(999) → Optional.empty", tokens: 16 },
  { t: 7000, ts: "14:33:16", type: "diagnosis", icon: "🐛", text: "Bug confirmado: cliente 999 não existe no banco", tokens: 0 },
  { t: 7800, ts: "14:33:17", type: "agent", icon: "🤖", text: "Analisando padrão do bug...", tokens: 22 },
  { t: 8800, ts: "14:33:18", type: "fix", icon: "📋", text: "Fix proposto: .orElse(null) → .orElseThrow()", tokens: 18 },
  { t: 9500, ts: "14:33:18", type: "complete", icon: "✅", text: "Sessão completa — 3.2s, 134 tokens", tokens: 0 },
];

// Variable states at different points
const VAR_STATES = {
  waiting: [],
  exception: [
    { name: "dto", type: "PedidoDTO", value: "{clienteId=999, itens=[3]}", alert: false },
    { name: "cliente", type: "Cliente", value: "null", alert: true },
    { name: "nome", type: "String", value: "(exception thrown)", alert: true },
  ],
  investigating: [
    { name: "dto", type: "PedidoDTO", value: "{clienteId=999, itens=[3]}", alert: false },
    { name: "dto.clienteId", type: "Long", value: "999", alert: false },
    { name: "cliente", type: "Cliente", value: "null", alert: true },
    { name: "clienteRepo.findById(999)", type: "Optional<Cliente>", value: "Optional.empty", alert: true },
  ],
};

const STACK_FRAMES = [
  { method: "criarPedido", line: 47, file: "PedidoService.java", active: true },
  { method: "invoke0", line: -1, file: "(native method)", active: false },
  { method: "invoke", line: 77, file: "Method.java", active: false },
  { method: "handleRequest", line: 142, file: "RequestHandler.java", active: false },
  { method: "doDispatch", line: 1067, file: "DispatcherServlet.java", active: false },
];

const THREADS = [
  { name: "http-nio-8080-exec-1", state: "stopped", active: true },
  { name: "http-nio-8080-exec-2", state: "running", active: false },
  { name: "main", state: "waiting", active: false },
  { name: "GC Thread", state: "daemon", active: false },
];

// Badge component
function Badge({ children, color = C.accent, bg = "transparent" }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 6px",
      borderRadius: 3,
      fontSize: 10,
      fontWeight: 600,
      fontFamily: SANS,
      color,
      background: bg || `${color}18`,
      border: `1px solid ${color}40`,
      letterSpacing: "0.02em",
    }}>
      {children}
    </span>
  );
}

// Source code panel
function SourcePanel({ activeLine, phase }) {
  const showDiff = phase === "fix";
  
  const diffLines = [
    { n: 42, t: "        log.info(\"Criando pedido: {}\", dto.getClienteId());", type: "ctx" },
    { n: 43, t: "        Cliente cliente = clienteRepo", type: "del" },
    { n: 44, t: "            .findById(dto.getClienteId())", type: "del" },
    { n: 45, t: "            .orElse(null);", type: "del" },
    { n: 43, t: "        Cliente cliente = clienteRepo", type: "add" },
    { n: 44, t: "            .findById(dto.getClienteId())", type: "add" },
    { n: 45, t: "            .orElseThrow(() ->", type: "add" },
    { n: 46, t: "                new ClienteNotFoundException(", type: "add" },
    { n: 47, t: "                    dto.getClienteId()));", type: "add" },
    { n: 48, t: "", type: "ctx" },
    { n: 49, t: "        String nome = cliente.getNome();", type: "ctx" },
  ];

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={{
        padding: "6px 12px",
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: C.accent, fontSize: 12 }}>◉</span>
          <span style={{ color: C.textBright, fontSize: 12, fontFamily: MONO, fontWeight: 600 }}>
            PedidoService.java
          </span>
          {showDiff && <Badge color={C.orange}>DIFF</Badge>}
        </div>
        {activeLine > 0 && (
          <span style={{ color: C.textDim, fontSize: 11, fontFamily: MONO }}>
            line {activeLine}
          </span>
        )}
      </div>
      <div style={{
        flex: 1,
        overflow: "auto",
        padding: "4px 0",
        fontFamily: MONO,
        fontSize: 12.5,
        lineHeight: "20px",
      }}>
        {showDiff ? (
          diffLines.map((line, i) => (
            <div key={i} style={{
              padding: "0 12px 0 0",
              display: "flex",
              background: line.type === "add" ? C.diffAdd : line.type === "del" ? C.diffRemove : "transparent",
              minWidth: "fit-content",
            }}>
              <span style={{
                width: 48,
                textAlign: "right",
                paddingRight: 12,
                color: C.textDim,
                userSelect: "none",
                flexShrink: 0,
                opacity: 0.5,
              }}>
                {line.type === "del" ? "-" : line.type === "add" ? "+" : " "}
              </span>
              <span style={{
                width: 36,
                textAlign: "right",
                paddingRight: 12,
                color: C.textDim,
                userSelect: "none",
                flexShrink: 0,
              }}>
                {line.n}
              </span>
              <code style={{
                color: line.type === "del" ? C.red : line.type === "add" ? C.green : C.text,
              }}>
                {line.t || "\u00A0"}
              </code>
            </div>
          ))
        ) : (
          SOURCE_CODE.map((line) => {
            const isActive = line.n === activeLine;
            const isException = line.n === 47 && phase === "exception";
            return (
              <div key={line.n} style={{
                padding: "0 12px 0 0",
                display: "flex",
                background: isException ? "#3d111488" : isActive ? C.lineActive : "transparent",
                borderLeft: isActive ? `2px solid ${C.orange}` : "2px solid transparent",
                minWidth: "fit-content",
              }}>
                <span style={{
                  width: 12,
                  textAlign: "center",
                  color: isActive ? C.orange : "transparent",
                  userSelect: "none",
                  flexShrink: 0,
                  fontSize: 10,
                  lineHeight: "20px",
                }}>
                  {isActive ? "▸" : ""}
                </span>
                <span style={{
                  width: 36,
                  textAlign: "right",
                  paddingRight: 12,
                  color: isActive ? C.orange : C.textDim,
                  userSelect: "none",
                  flexShrink: 0,
                }}>
                  {line.n}
                </span>
                <code style={{ color: isActive ? C.textBright : C.text }}>
                  {line.t || "\u00A0"}
                </code>
                {isException && (
                  <span style={{ color: C.red, marginLeft: 8, fontSize: 11 }}>⚡ NPE</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Variables panel
function VariablesPanel({ variables }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", borderLeft: `1px solid ${C.border}`, width: 300, flexShrink: 0 }}>
      <div style={{ padding: "6px 12px", borderBottom: `1px solid ${C.border}` }}>
        <span style={{ color: C.textDim, fontSize: 11, fontFamily: SANS, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Variables
        </span>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
        {variables.length === 0 ? (
          <div style={{ color: C.textDim, fontSize: 12, fontFamily: MONO, padding: "8px 4px", fontStyle: "italic" }}>
            aguardando breakpoint...
          </div>
        ) : (
          variables.map((v, i) => (
            <div key={i} style={{
              padding: "4px 6px",
              borderRadius: 4,
              marginBottom: 2,
              background: v.alert ? `${C.red}10` : "transparent",
              borderLeft: v.alert ? `2px solid ${C.red}` : "2px solid transparent",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{
                  color: v.alert ? C.red : C.purple,
                  fontSize: 12,
                  fontFamily: MONO,
                  fontWeight: 600,
                }}>
                  {v.name}
                </span>
                <span style={{ color: C.textDim, fontSize: 10, fontFamily: MONO }}>{v.type}</span>
              </div>
              <div style={{
                color: v.alert ? C.red : C.cyan,
                fontSize: 11.5,
                fontFamily: MONO,
                marginTop: 1,
                wordBreak: "break-all",
              }}>
                {v.value} {v.alert && "⚠️"}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// AI Agent panel
function AgentPanel({ phase, hypothesis }) {
  const states = {
    starting: { label: "Iniciando", color: C.accent, detail: "Configurando sessão de debug..." },
    waiting: { label: "Aguardando", color: C.orange, detail: "Esperando exceção ser lançada..." },
    exception: { label: "Exceção capturada!", color: C.red, detail: "Investigando NullPointerException" },
    investigating: { label: "Investigando", color: C.yellow, detail: "Analisando variáveis e estado" },
    diagnosis: { label: "Bug encontrado", color: C.red, detail: "Causa raiz identificada" },
    fix: { label: "Fix proposto", color: C.green, detail: ".orElse(null) → .orElseThrow()" },
    complete: { label: "Completo", color: C.green, detail: "Sessão finalizada com sucesso" },
  };
  const s = states[phase] || states.starting;

  return (
    <div style={{
      borderLeft: `1px solid ${C.border}`,
      width: 280,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
    }}>
      <div style={{ padding: "6px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: C.textDim, fontSize: 11, fontFamily: SANS, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          AI Agent
        </span>
        <Badge color={s.color}>{s.label}</Badge>
      </div>
      <div style={{ padding: 12, flex: 1, overflow: "auto" }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          padding: "8px 10px",
          background: `${s.color}10`,
          borderRadius: 6,
          border: `1px solid ${s.color}30`,
        }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: s.color,
            animation: phase !== "complete" ? "pulse 2s infinite" : "none",
          }} />
          <span style={{ color: s.color, fontSize: 12, fontFamily: SANS }}>{s.detail}</span>
        </div>

        {hypothesis && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: C.textDim, fontSize: 10, fontFamily: SANS, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>
              Análise
            </div>
            <div style={{
              color: C.text,
              fontSize: 12,
              fontFamily: SANS,
              lineHeight: 1.5,
              padding: "8px 10px",
              background: C.bgActive,
              borderRadius: 6,
              borderLeft: `2px solid ${C.purple}`,
            }}>
              {hypothesis}
            </div>
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <div style={{ color: C.textDim, fontSize: 10, fontFamily: SANS, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>
            Breakpoints
          </div>
          <div style={{ fontSize: 11.5, fontFamily: MONO, color: C.text }}>
            <div style={{ padding: "3px 0", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: C.red }}>◆</span> catch NullPointerException
            </div>
            <div style={{ padding: "3px 0", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: C.orange }}>◆</span> catch IllegalArgument...
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Event log panel
function EventLog({ events }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events.length]);

  const typeColors = {
    agent: C.accent,
    system: C.green,
    exception: C.red,
    diagnosis: C.red,
    fix: C.orange,
    complete: C.green,
  };

  return (
    <div style={{
      borderTop: `1px solid ${C.border}`,
      display: "flex",
      flexDirection: "column",
      minHeight: 120,
      maxHeight: 180,
    }}>
      <div style={{
        padding: "6px 12px",
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span style={{ color: C.textDim, fontSize: 11, fontFamily: SANS, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Event Log
        </span>
        <span style={{ color: C.textDim, fontSize: 10, fontFamily: MONO }}>
          {events.length} events
        </span>
      </div>
      <div ref={ref} style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
        {events.map((ev, i) => (
          <div key={i} style={{
            padding: "3px 12px",
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            fontSize: 12,
            fontFamily: MONO,
            lineHeight: "18px",
            background: i === events.length - 1 ? `${typeColors[ev.type]}08` : "transparent",
          }}>
            <span style={{ color: C.textDim, flexShrink: 0, fontSize: 11 }}>{ev.ts}</span>
            <span style={{ flexShrink: 0, fontSize: 12 }}>{ev.icon}</span>
            <span style={{ color: typeColors[ev.type] || C.text, flex: 1, minWidth: 0 }}>{ev.text}</span>
            {ev.tokens > 0 && (
              <span style={{ color: C.textDim, flexShrink: 0, fontSize: 10 }}>{ev.tokens}tok</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Token counter
function TokenCounter({ tokens, phase }) {
  const cost = (tokens * 0.000003).toFixed(4);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, fontFamily: MONO }}>
      <span style={{ color: C.textDim }}>Tokens:</span>
      <span style={{ color: C.cyan, fontWeight: 600 }}>{tokens}</span>
      <span style={{ color: C.textDim }}>~${cost}</span>
      {tokens > 50 && (
        <span style={{ color: C.green, fontSize: 10 }}>▼ ~95% vs log parsing</span>
      )}
    </div>
  );
}

// Call stack + threads (side panels)
function SideInfo({ phase }) {
  if (phase === "starting" || phase === "waiting") return null;
  return (
    <div style={{
      display: "flex",
      gap: 0,
      borderTop: `1px solid ${C.border}`,
    }}>
      <div style={{ flex: 1, padding: "6px 12px", borderRight: `1px solid ${C.border}` }}>
        <div style={{ color: C.textDim, fontSize: 10, fontFamily: SANS, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>
          Call Stack
        </div>
        {STACK_FRAMES.map((f, i) => (
          <div key={i} style={{
            fontSize: 11,
            fontFamily: MONO,
            padding: "2px 0",
            color: f.active ? C.orange : C.textDim,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}>
            {f.active && <span style={{ fontSize: 8 }}>▸</span>}
            <span>{f.method}</span>
            {f.line > 0 && <span style={{ opacity: 0.5 }}>:{f.line}</span>}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, padding: "6px 12px" }}>
        <div style={{ color: C.textDim, fontSize: 10, fontFamily: SANS, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>
          Threads
        </div>
        {THREADS.map((t, i) => (
          <div key={i} style={{
            fontSize: 11,
            fontFamily: MONO,
            padding: "2px 0",
            color: t.active ? C.orange : C.textDim,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: t.state === "stopped" ? C.red : t.state === "running" ? C.green : C.textDim,
              flexShrink: 0,
            }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Status bar
function StatusBar({ phase, controller, tokens }) {
  return (
    <div style={{
      borderTop: `1px solid ${C.border}`,
      padding: "5px 12px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      background: C.bgPanel,
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", gap: 16, fontSize: 11, fontFamily: MONO }}>
        {["F5 Continue", "F9 Breakpoint", "F10 Step Over", "F11 Into", "F12 Out"].map(k => (
          <span key={k} style={{ color: C.textDim }}>
            <span style={{ color: C.accent, fontWeight: 600 }}>{k.split(" ")[0]}</span>{" "}{k.split(" ").slice(1).join(" ")}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11 }}>
        <Badge color={controller === "ai" ? C.accent : C.orange} bg={`${controller === "ai" ? C.accent : C.orange}20`}>
          {controller === "ai" ? "🤖 IA no controle" : "🧑 Controle manual"}
        </Badge>
      </div>
    </div>
  );
}

// Summary panel
function SessionSummary({ tokens }) {
  return (
    <div style={{
      position: "absolute",
      inset: 0,
      background: `${C.bg}ee`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 100,
    }}>
      <div style={{
        background: C.bgPanel,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 32,
        maxWidth: 480,
        width: "100%",
        boxShadow: `0 24px 48px ${C.bg}`,
      }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🐛</div>
          <h2 style={{ color: C.textBright, fontSize: 18, fontFamily: SANS, fontWeight: 700, margin: 0 }}>
            Debug Session Complete
          </h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
          {[
            { label: "Duração", value: "3.2s", color: C.accent },
            { label: "Tokens", value: tokens.toString(), color: C.cyan },
            { label: "Custo", value: `$${(tokens * 0.000003).toFixed(4)}`, color: C.green },
          ].map(m => (
            <div key={m.label} style={{ textAlign: "center", padding: 12, background: C.bgActive, borderRadius: 8 }}>
              <div style={{ color: m.color, fontSize: 20, fontFamily: MONO, fontWeight: 700 }}>{m.value}</div>
              <div style={{ color: C.textDim, fontSize: 11, fontFamily: SANS, marginTop: 4 }}>{m.label}</div>
            </div>
          ))}
        </div>

        <div style={{
          padding: 16,
          background: `${C.green}08`,
          border: `1px solid ${C.green}30`,
          borderRadius: 8,
          marginBottom: 24,
        }}>
          <div style={{ color: C.textDim, fontSize: 10, fontFamily: SANS, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>
            vs Approach Tradicional
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ fontSize: 12, fontFamily: SANS, color: C.text }}>
              <span style={{ color: C.red }}>println debug:</span> ~5 ciclos rebuild
            </div>
            <div style={{ fontSize: 12, fontFamily: SANS, color: C.text }}>
              <span style={{ color: C.red }}>Log no chat:</span> ~2000+ tokens
            </div>
            <div style={{ fontSize: 12, fontFamily: SANS, color: C.green, fontWeight: 600 }}>
              Economia tokens: ~95%
            </div>
            <div style={{ fontSize: 12, fontFamily: SANS, color: C.green, fontWeight: 600 }}>
              Economia tempo: ~90%
            </div>
          </div>
        </div>

        <div style={{
          padding: 16,
          background: C.bgActive,
          borderRadius: 8,
          marginBottom: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ color: C.red, fontSize: 14 }}>🐛</span>
            <span style={{ color: C.textBright, fontSize: 13, fontFamily: SANS, fontWeight: 600 }}>
              NPE-001: NullPointerException
            </span>
          </div>
          <div style={{ color: C.text, fontSize: 12, fontFamily: SANS, lineHeight: 1.5 }}>
            PedidoService.java:47 — <code style={{ color: C.orange, fontFamily: MONO, fontSize: 11 }}>.orElse(null)</code> permite null quando clienteId não existe no banco
          </div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <Badge color={C.green} bg={`${C.green}20`}>Fix proposto</Badge>
            <span style={{ color: C.textDim, fontSize: 11, fontFamily: MONO }}>.orElseThrow(ClienteNotFoundException::new)</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {[
            { label: "Aplicar Fix", primary: true },
            { label: "Salvar Relatório", primary: false },
            { label: "Nova Sessão", primary: false },
          ].map(b => (
            <button key={b.label} style={{
              flex: 1,
              padding: "8px 12px",
              border: `1px solid ${b.primary ? C.green : C.border}`,
              borderRadius: 6,
              background: b.primary ? `${C.green}20` : "transparent",
              color: b.primary ? C.green : C.textDim,
              fontSize: 12,
              fontFamily: SANS,
              fontWeight: 600,
              cursor: "pointer",
            }}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Main app
export default function GlassboxUI() {
  const [visibleEvents, setVisibleEvents] = useState([]);
  const [phase, setPhase] = useState("starting");
  const [activeLine, setActiveLine] = useState(0);
  const [variables, setVariables] = useState([]);
  const [hypothesis, setHypothesis] = useState(null);
  const [tokens, setTokens] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const timeoutsRef = useRef([]);

  const resetState = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setVisibleEvents([]);
    setPhase("starting");
    setActiveLine(0);
    setVariables([]);
    setHypothesis(null);
    setTokens(0);
    setShowSummary(false);
    setIsRunning(false);
  };

  const runSimulation = () => {
    resetState();
    setIsRunning(true);

    const scheduleTimeout = (fn, delay) => {
      const id = setTimeout(fn, delay);
      timeoutsRef.current.push(id);
      return id;
    };

    EVENTS.forEach((ev, i) => {
      scheduleTimeout(() => {
        setVisibleEvents(prev => [...prev, ev]);
        setTokens(prev => prev + ev.tokens);

        if (i <= 3) { setPhase("waiting"); setActiveLine(0); setVariables(VAR_STATES.waiting); }
        if (i === 4) { setPhase("waiting"); }
        if (i === 5) { setPhase("exception"); setActiveLine(47); setVariables(VAR_STATES.exception); }
        if (i === 7) { setVariables(VAR_STATES.exception); }
        if (i === 8) { setPhase("investigating"); setVariables(VAR_STATES.investigating); setHypothesis("cliente é null porque findById(999) retornou Optional.empty e .orElse(null) converteu para null explícito"); }
        if (i === 9) { setVariables(VAR_STATES.investigating); }
        if (i === 10) { setPhase("diagnosis"); setHypothesis("Causa raiz confirmada: clienteId=999 não existe no banco. O padrão .orElse(null) é perigoso — deveria usar .orElseThrow() com exceção específica."); }
        if (i === 12) { setPhase("fix"); }
        if (i === 13) {
          setPhase("complete");
          scheduleTimeout(() => setShowSummary(true), 1000);
        }
      }, ev.t);
    });
  };

  useEffect(() => {
    return () => timeoutsRef.current.forEach(clearTimeout);
  }, []);

  return (
    <div style={{
      height: "100vh",
      width: "100vw",
      background: C.bg,
      color: C.text,
      display: "flex",
      flexDirection: "column",
      fontFamily: SANS,
      position: "relative",
      overflow: "hidden",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        * { box-sizing: border-box; }
      `}</style>

      {/* Title bar */}
      <div style={{
        padding: "8px 16px",
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        background: C.bgPanel,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 700, fontFamily: MONO, color: C.accent, letterSpacing: "-0.02em" }}>
            ⟐ Glassbox
          </span>
          <span style={{ color: C.textDim, fontSize: 12, fontFamily: MONO }}>
            com.example.PedidoService
          </span>
          {phase !== "starting" && !isRunning && null}
          {isRunning && phase !== "complete" && (
            <Badge color={C.green} bg={`${C.green}18`}>● LIVE</Badge>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <TokenCounter tokens={tokens} phase={phase} />
          <button
            onClick={isRunning ? resetState : runSimulation}
            style={{
              padding: "5px 14px",
              border: `1px solid ${isRunning ? C.red : C.green}`,
              borderRadius: 6,
              background: isRunning ? `${C.red}15` : `${C.green}15`,
              color: isRunning ? C.red : C.green,
              fontSize: 12,
              fontFamily: SANS,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {isRunning ? "⏹ Stop" : "▶ Simular Sessão"}
          </button>
        </div>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <SourcePanel activeLine={activeLine} phase={phase} />
        <VariablesPanel variables={variables} />
        <AgentPanel phase={phase} hypothesis={hypothesis} />
      </div>

      {/* Bottom panels */}
      <SideInfo phase={phase} />
      <EventLog events={visibleEvents} />
      <StatusBar phase={phase} controller="ai" tokens={tokens} />

      {/* Summary overlay */}
      {showSummary && <SessionSummary tokens={tokens} />}
    </div>
  );
}
